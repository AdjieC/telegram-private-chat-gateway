/**
 * 人机验证模块（纯本地题库 + Turnstile）。
 * 副作用依赖（tgCall/存储/转发钩子）经 createVerificationModule(deps) 注入。
 */
import { VERIFY_COPY } from './verify-copy.js';
import { USER_COPY } from './user-copy.js';
import { escapeHtml } from './admin-ui-format.js';
import { generateVerifyCode } from './utils.js';

// 验证请求速率限制窗口（秒）。文案中的「分钟数」由本常量换算，避免与提示语漂移。
const VERIFY_RATE_WINDOW_SECONDS = 300;

// --- 本地题库 (15条) ---
export const LOCAL_QUESTIONS = [
  {"question": "冰融化后会变成什么？", "correct_answer": "水", "incorrect_answers": ["石头", "木头", "火"]},
  {"question": "正常人有几只眼睛？", "correct_answer": "2", "incorrect_answers": ["1", "3", "4"]},
  {"question": "以下哪个属于水果？", "correct_answer": "香蕉", "incorrect_answers": ["白菜", "猪肉", "大米"]},
  {"question": "1 加 2 等于几？", "correct_answer": "3", "incorrect_answers": ["2", "4", "5"]},
  {"question": "5 减 2 等于几？", "correct_answer": "3", "incorrect_answers": ["1", "2", "4"]},
  {"question": "2 乘以 3 等于几？", "correct_answer": "6", "incorrect_answers": ["4", "5", "7"]},
  {"question": "10 加 5 等于几？", "correct_answer": "15", "incorrect_answers": ["10", "12", "20"]},
  {"question": "8 减 4 等于几？", "correct_answer": "4", "incorrect_answers": ["2", "3", "5"]},
  {"question": "在天上飞的交通工具是什么？", "correct_answer": "飞机", "incorrect_answers": ["汽车", "轮船", "自行车"]},
  {"question": "星期一的后面是星期几？", "correct_answer": "星期二", "incorrect_answers": ["星期日", "星期五", "星期三"]},
  {"question": "鱼通常生活在哪里？", "correct_answer": "水里", "incorrect_answers": ["树上", "土里", "火里"]},
  {"question": "我们用什么器官来听声音？", "correct_answer": "耳朵", "incorrect_answers": ["眼睛", "鼻子", "嘴巴"]},
  {"question": "晴朗的天空通常是什么颜色的？", "correct_answer": "蓝色", "incorrect_answers": ["绿色", "红色", "紫色"]},
  {"question": "太阳从哪个方向升起？", "correct_answer": "东方", "incorrect_answers": ["西方", "南方", "北方"]},
  {"question": "小狗发出的叫声通常是？", "correct_answer": "汪汪", "incorrect_answers": ["喵喵", "咩咩", "呱呱"]}
];

/**
 * @param {object} deps
 */
export function createVerificationModule(deps) {
  const {
    config,
    tgCall,
    safeGetJSON,
    ephemeralStore,
    checkRateLimit,
    bumpDailyStat,
    resolveUserFromForTopic,
    forwardToTopic,
    saveUserProfileSnapshot,
    shuffleArray,
    secureRandomInt,
    secureRandomId,
    logger,
  } = deps;

  /**
   * 调用 Cloudflare Turnstile API 验证 token
   */
  async function verifyTurnstileToken(token, secretKey, remoteIp) {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (remoteIp) {
      formData.append('remoteip', remoteIp);
    }

    // 给 siteverify 请求加超时，避免网络悬挂拖住回调等待
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        signal: controller.signal,
      });
      const result = await resp.json();
      return { success: result.success === true, error: result['error-codes']?.join(', ') };
    } catch (e) {
      if (e?.name === 'AbortError') {
        logger.warn('turnstile_verify_timeout');
        return { success: false, error: 'timeout' };
      }
      logger.error('turnstile_verify_error', e);
      return { success: false, error: e.message };
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendVerificationChallenge(userId, env, pendingMsgId, from = null) {
    if (from) await saveUserProfileSnapshot(env, userId, from);
    // 追踪已写入的 KV 键，用于异常时回滚
    const writtenKeys = [];
    try {
      await _sendVerificationChallengeInner(userId, env, pendingMsgId, writtenKeys);
    } catch (e) {
      logger.error('verification_challenge_failed', e, { userId });
      // 回滚已写入的部分状态，避免用户卡在无效验证状态
      for (const key of writtenKeys) {
        try { await env.TOPIC_MAP.delete(key); } catch { /* 忽略回滚错误 */ }
      }
      throw e; // 重新抛出，让调用方通知用户
    }
  }

  async function _sendVerificationChallengeInner(userId, env, pendingMsgId, writtenKeys) {
    // 检查是否已有进行中的验证
    const existingChallenge = await env.TOPIC_MAP.get(`user_challenge:${userId}`);
    if (existingChallenge) {
      // 有正在进行的验证：仅将新消息加入待发送队列，避免重复下发题目/触发验证限速
      const chalKey = `chal:${existingChallenge}`;
      const state = await safeGetJSON(env, chalKey, null);

      // KV 可能存在不一致/过期：自愈清理后重新下发
      if (!state || state.userId !== userId) {
        await env.TOPIC_MAP.delete(`user_challenge:${userId}`);
      } else {
        if (pendingMsgId) {
          let pendingIds = [];
          if (Array.isArray(state.pending_ids)) {
            pendingIds = state.pending_ids.slice();
          } else if (state.pending) {
            pendingIds = [state.pending];
          }

          if (!pendingIds.includes(pendingMsgId)) {
            pendingIds.push(pendingMsgId);
            if (pendingIds.length > config.PENDING_MAX_MESSAGES) {
              pendingIds = pendingIds.slice(pendingIds.length - config.PENDING_MAX_MESSAGES);
            }
            state.pending_ids = pendingIds;
            delete state.pending;
            await env.TOPIC_MAP.put(chalKey, JSON.stringify(state), { expirationTtl: config.VERIFY_EXPIRE_SECONDS });
          }
        }
        logger.debug('verification_duplicate_skipped', { userId, verifyId: existingChallenge, hasPending: !!pendingMsgId });
        return;
      }
    }

    // 验证请求速率限制：仅在需要创建新挑战时检查
    const verifyLimit = await checkRateLimit(userId, env, 'verify', config.RATE_LIMIT_VERIFY, VERIFY_RATE_WINDOW_SECONDS);
    if (!verifyLimit.allowed) {
      await tgCall(env, "sendMessage", {
        chat_id: userId,
        text: VERIFY_COPY.verifyRateLimited(VERIFY_RATE_WINDOW_SECONDS / 60)
      });
      return;
    }

    // PR #12: 检查是否配置了 Turnstile
    const hasTurnstile = !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.VERIFICATION_PAGE_URL);

    if (hasTurnstile) {
      await sendTurnstileChallenge(userId, env, pendingMsgId, writtenKeys);
    } else {
      await sendLocalQuizChallenge(userId, env, pendingMsgId, writtenKeys);
    }
  }

  /**
   * Turnstile 验证路径 — 发送验证按钮链接
   */
  async function sendTurnstileChallenge(userId, env, pendingMsgId, writtenKeys) {
    const verifyCode = generateVerifyCode();
    const verifyUrl = `${env.VERIFICATION_PAGE_URL}/verify?code=${verifyCode}&uid=${userId}`;

    // 存储验证 code
    await env.TOPIC_MAP.put(`turnstile_code:${verifyCode}`, String(userId), { expirationTtl: config.TURNSTILE_VERIFY_TTL });
    writtenKeys.push(`turnstile_code:${verifyCode}`);

    // 存储待转发消息
    if (pendingMsgId) {
      const pendingKey = `pending_turnstile:${userId}`;
      let pendingIds = [];
      try {
        const raw = await env.TOPIC_MAP.get(pendingKey);
        if (raw) pendingIds = JSON.parse(raw);
      } catch { /* 忽略 */ }
      if (!Array.isArray(pendingIds)) pendingIds = [];
      if (!pendingIds.includes(pendingMsgId)) {
        pendingIds.push(pendingMsgId);
        if (pendingIds.length > config.PENDING_MAX_MESSAGES) {
          pendingIds = pendingIds.slice(pendingIds.length - config.PENDING_MAX_MESSAGES);
        }
        await env.TOPIC_MAP.put(pendingKey, JSON.stringify(pendingIds), { expirationTtl: config.TURNSTILE_VERIFY_TTL });
        writtenKeys.push(pendingKey);
      }
    }

    // 标记用户正在验证中
    await env.TOPIC_MAP.put(`user_challenge:${userId}`, `turnstile:${verifyCode}`, { expirationTtl: config.TURNSTILE_VERIFY_TTL });
    writtenKeys.push(`user_challenge:${userId}`);

    logger.info('turnstile_verification_sent', { userId, verifyCode });

    // 发送验证按钮
    const verifyMsg = await tgCall(env, "sendMessage", {
      chat_id: userId,
      text: VERIFY_COPY.turnstileChallenge,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: VERIFY_COPY.buttonTurnstile, url: verifyUrl }
        ]]
      }
    });

    // 发送失败时抛出异常，触发外层回滚（清理已写入的 turnstile_code、pending_turnstile、user_challenge）
    if (!verifyMsg.ok) {
      throw new Error(`Turnstile 验证消息发送失败: ${verifyMsg.description || '未知错误'}`);
    }

    // 存储验证消息 ID（验证成功后删除）
    if (verifyMsg.result?.message_id) {
      await env.TOPIC_MAP.put(`turnstile_msg:${verifyCode}`, String(verifyMsg.result.message_id), { expirationTtl: config.TURNSTILE_VERIFY_TTL });
      writtenKeys.push(`turnstile_msg:${verifyCode}`);
    }
  }

  /**
   * 本地题库验证路径 — 发送选择题
   */
  async function sendLocalQuizChallenge(userId, env, pendingMsgId, writtenKeys) {
    const q = LOCAL_QUESTIONS[secureRandomInt(0, LOCAL_QUESTIONS.length)];
    const challenge = {
      question: q.question,
      correct: q.correct_answer,
      options: shuffleArray([...q.incorrect_answers, q.correct_answer])
    };

    const verifyId = secureRandomId(config.VERIFY_ID_LENGTH);
    const answerIndex = challenge.options.indexOf(challenge.correct);

    const state = {
      answerIndex: answerIndex,
      options: challenge.options,
      pending_ids: pendingMsgId ? [pendingMsgId] : [],
      userId: userId
    };

    await env.TOPIC_MAP.put(`chal:${verifyId}`, JSON.stringify(state), { expirationTtl: config.VERIFY_EXPIRE_SECONDS });
    writtenKeys.push(`chal:${verifyId}`);
    await env.TOPIC_MAP.put(`user_challenge:${userId}`, verifyId, { expirationTtl: config.VERIFY_EXPIRE_SECONDS });
    writtenKeys.push(`user_challenge:${userId}`);

    logger.info('verification_sent', {
      userId,
      verifyId,
      pendingCount: state.pending_ids.length
    });

    const buttons = challenge.options.map((opt, idx) => ({
      text: opt,
      callback_data: `verify:${verifyId}:${idx}`
    }));

    const keyboard = [];
    for (let i = 0; i < buttons.length; i += config.BUTTON_COLUMNS) {
      keyboard.push(buttons.slice(i, i + config.BUTTON_COLUMNS));
    }

    // 发送验证题目
    const quizMsg = await tgCall(env, "sendMessage", {
      chat_id: userId,
      text: VERIFY_COPY.quizChallenge(escapeHtml(challenge.question)),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard }
    });

    // 发送失败时抛出异常，触发外层回滚（清理已写入的 chal、user_challenge）
    if (!quizMsg.ok) {
      throw new Error(`本地题库验证消息发送失败: ${quizMsg.description || '未知错误'}`);
    }
  }

  async function handleCallbackQuery(query, env, ctx) {
    try {
      const data = query.data;
      if (!data.startsWith("verify:")) return;

      const parts = data.split(":");
      if (parts.length !== 3) return;

      const verifyId = parts[1];
      const selectedIndex = parseInt(parts[2]);
      const userId = query.from.id;

      const stateStr = await env.TOPIC_MAP.get(`chal:${verifyId}`);
      if (!stateStr) {
        await tgCall(env, "answerCallbackQuery", {
          callback_query_id: query.id,
          text: VERIFY_COPY.expired,
          show_alert: true
        });
        return;
      }

      let state;
      try {
        state = JSON.parse(stateStr);
      } catch(e) {
        await tgCall(env, "answerCallbackQuery", {
          callback_query_id: query.id,
          text: VERIFY_COPY.dataError,
          show_alert: true
        });
        return;
      }

      // 验证用户ID匹配
      if (state.userId && state.userId !== userId) {
        await tgCall(env, "answerCallbackQuery", {
          callback_query_id: query.id,
          text: VERIFY_COPY.invalidUser,
          show_alert: true
        });
        return;
      }

      // 验证索引有效性
      if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.options.length) {
        await tgCall(env, "answerCallbackQuery", {
          callback_query_id: query.id,
          text: VERIFY_COPY.invalidOption,
          show_alert: true
        });
        return;
      }

      if (selectedIndex === state.answerIndex) {
        await tgCall(env, "answerCallbackQuery", {
          callback_query_id: query.id,
          text: VERIFY_COPY.successToast
        });

        logger.info('verification_passed', {
          userId,
          verifyId,
          // 只记索引不记选项文本：避免正确答案落入日志，收紧日志脱敏边界
          selectedIndex,
        });
        await bumpDailyStat(env, 'verifies', 1);

        // 30天有效期
        await ephemeralStore(env).setVerification(userId, {
          ttl: config.VERIFIED_EXPIRE_SECONDS,
          verifiedAt: Date.now(),
        });
        await env.TOPIC_MAP.delete(`needs_verify:${userId}`);

        // 清理所有相关挑战
        await env.TOPIC_MAP.delete(`chal:${verifyId}`);
        await env.TOPIC_MAP.delete(`user_challenge:${userId}`);

        const hasPending = (Array.isArray(state.pending_ids) && state.pending_ids.length > 0) || !!state.pending;
        await tgCall(env, "editMessageText", {
          chat_id: userId,
          message_id: query.message.message_id,
          text: hasPending ? VERIFY_COPY.successBodyWithPending : VERIFY_COPY.successBody,
          parse_mode: "HTML",
          // 清空答题按钮，避免验证通过后残留可点击的选项（再点只会提示「已过期」）
          reply_markup: { inline_keyboard: [] }
        });

        if (hasPending) {
          await forwardPendingMessages(state, userId, query, env, ctx);
        }
      } else {
        logger.info('verification_failed', {
          userId,
          verifyId,
          selectedIndex,
          correctIndex: state.answerIndex
        });

        await tgCall(env, "answerCallbackQuery", {
          callback_query_id: query.id,
          text: VERIFY_COPY.wrongAnswer,
          show_alert: true
        });
        // 在题目消息上追加提示，避免用户不知道还能继续选
        // 幂等判断：以提示常量本身为唯一来源，避免文案改动后重复追加
        try {
          const prev = String(query.message?.text || '');
          const hint = VERIFY_COPY.wrongAnswerHint.trim();
          if (prev && !prev.includes(hint) && query.message?.message_id) {
            const buttons = (state.options || []).map((opt, idx) => ({
              text: opt,
              callback_data: `verify:${verifyId}:${idx}`
            }));
            const keyboard = [];
            for (let i = 0; i < buttons.length; i += config.BUTTON_COLUMNS) {
              keyboard.push(buttons.slice(i, i + config.BUTTON_COLUMNS));
            }
            await tgCall(env, 'editMessageText', {
              chat_id: userId,
              message_id: query.message.message_id,
              text: `${prev}${VERIFY_COPY.wrongAnswerHint}`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: keyboard },
            });
          }
        } catch { /* 编辑失败不影响 toast */ }
      }
    } catch (e) {
      logger.error('callback_query_error', e, {
        userId: query.from?.id,
        callbackData: query.data
      });
      await tgCall(env, "answerCallbackQuery", {
        callback_query_id: query.id,
        text: VERIFY_COPY.systemError,
        show_alert: true
      });
    }
  }

  /**
   * 并行转发待处理消息 — 去重 + 并发限制 3 + 通知用户
   * 供验证通过后的本地题库回放与 Turnstile 回调共用，避免两套转发逻辑漂移。
   * @param {number|string} userId - 用户 ID
   * @param {Array<number|string>} pendingIds - 待转发消息 ID 列表
   * @param {object} env - 环境变量
   * @param {object} ctx - Worker context
   * @param {object} [opts]
   * @param {object|null} [opts.from] - 优先使用的用户资料（缺失时自动回退快照/D1/getChat）
   * @returns {Promise<{forwardedCount: number, skippedCount: number}>}
   */
  async function forwardPendingMessageIds(userId, pendingIds, env, ctx, { from = null } = {}) {
    // 限制一次性转发量，避免用户恶意堆积导致执行超时（保留最新 N 条）
    const limited = (Array.isArray(pendingIds) ? pendingIds : [])
      .filter(Boolean)
      .slice(-config.PENDING_MAX_MESSAGES);

    // 并行转发待处理消息（并发限制为 3，平衡速度与 API 限流）
    const CONCURRENT_FORWARDS = 3;
    let forwardedCount = 0;
    let skippedCount = 0;
    for (let i = 0; i < limited.length; i += CONCURRENT_FORWARDS) {
      const batch = limited.slice(i, i + CONCURRENT_FORWARDS);
      const results = await Promise.allSettled(batch.map(async (pendingId) => {
        const forwardedKey = `forwarded:${userId}:${pendingId}`;
        const alreadyForwarded = await env.TOPIC_MAP.get(forwardedKey);
        if (alreadyForwarded) {
          logger.info('message_forward_duplicate_skipped', { userId, messageId: pendingId });
          return { forwarded: false, reason: 'already_forwarded' };
        }
        // 补全 from：验证回调没有 Telegram 用户资料，勿用仅含 id 的 from 建话题（会变成 "User"）
        const topicFrom = await resolveUserFromForTopic(env, userId, from);
        const fakeMsg = {
          message_id: pendingId,
          chat: { id: Number(userId), type: "private" },
          from: topicFrom,
        };
        await forwardToTopic(fakeMsg, userId, `user:${userId}`, env, ctx);
        await env.TOPIC_MAP.put(forwardedKey, "1", { expirationTtl: 3600 });
        return { forwarded: true };
      }));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.forwarded) {
          forwardedCount++;
        } else if (r.status === 'fulfilled') {
          skippedCount++;
        } else if (r.status === 'rejected') {
          logger.warn('pending_forward_item_failed', { userId, error: r.reason?.message });
        }
      }
    }

    if (forwardedCount > 0) {
      await tgCall(env, "sendMessage", {
        chat_id: Number(userId),
        text: USER_COPY.pendingDelivered(forwardedCount),
        parse_mode: 'HTML',
      });
    }
    return { forwardedCount, skippedCount };
  }

  /**
   * 验证通过后转发待处理消息（本地题库路径）
   * @param {object} state - 验证挑战状态（含 pending_ids）
   * @param {number} userId - 用户 ID
   * @param {object} query - Telegram callback query 对象
   * @param {object} env - 环境变量
   * @param {object} ctx - Worker context
   */
  async function forwardPendingMessages(state, userId, query, env, ctx) {
    try {
      let pendingIds = [];
      if (Array.isArray(state.pending_ids)) {
        pendingIds = state.pending_ids.slice();
      } else if (state.pending) {
        pendingIds = [state.pending];
      }
      await forwardPendingMessageIds(userId, pendingIds, env, ctx, { from: query?.from });
    } catch (e) {
      logger.error('pending_message_forward_failed', e, { userId });
      await tgCall(env, "sendMessage", {
        chat_id: userId,
        text: VERIFY_COPY.pendingSendFailed,
      });
    }
  }

  return {
    verifyTurnstileToken,
    sendVerificationChallenge,
    handleCallbackQuery,
    forwardPendingMessageIds,
  };
}
