/**
 * 垃圾内容检测与处理：关键词 + 链接 + 重复消息，管理员告警与统计。
 * 副作用依赖（tgCall/KV/统计/告警文案）经 createSpamModule(deps) 注入，
 * 纯检测函数（detectSpamKeywords/computeMessageHash 等）复用 src/utils.js。
 */
import {
  buildSpamCheckText,
  computeMessageHash,
  containsLink,
  detectSpamKeywords,
  parseSpamKeywords,
} from './utils.js';

/** 消息哈希去重缓存上限（同 isolate 内存有界，防无限增长） */
const MESSAGE_HASH_MAX_ENTRIES = 5000;

/**
 * @param {object} deps
 *   config  垃圾检测相关配置（SPAM_MESSAGE_HASH_TTL / SPAM_REPEAT_MESSAGE_LIMIT /
 *           NEW_USER_LINK_BLOCK_SECONDS / SPAM_NOTIFY_ADMIN / SPAM_SILENCE_MODE）
 *   logger  结构化日志器
 *   escapeHtml  HTML 转义（管理告警文案用）
 *   adminCopy  ADMIN_COPY（spamIntercepted）
 *   safeGetJSON  KV JSON 读取
 *   tgCall  Telegram API 调用
 *   getVerificationTimestamp(env, userId)  用户验证时间戳（新用户链接拦截）
 *   setBoundedCache(cache, key, value, maxEntries)  有界缓存写入
 */
export function createSpamModule(deps) {
  const {
    config,
    logger,
    escapeHtml,
    adminCopy,
    safeGetJSON,
    tgCall,
    getVerificationTimestamp,
    setBoundedCache,
  } = deps;

  // 垃圾关键词集合（延迟初始化：env 配置在实例生命周期内不变）
  let spamKeywordsCache = null;
  // 消息哈希去重缓存（用于检测重复骚扰消息）
  const messageHashCache = new Map();

  /**
   * 加载/解析垃圾关键词列表
   * @param {object} env - 环境变量
   * @returns {string[]} 关键词数组
   */
  function getSpamKeywords(env) {
    if (spamKeywordsCache) return spamKeywordsCache;

    const raw = (env.SPAM_KEYWORDS || '').toString().trim();
    spamKeywordsCache = parseSpamKeywords(raw);

    if (spamKeywordsCache.length > 0) {
      logger.info('spam_keywords_loaded', { count: spamKeywordsCache.length });
    }
    return spamKeywordsCache;
  }

  /**
   * 检测用户是否在短时间内重复发送相同内容
   * @param {number} userId - 用户 ID
   * @param {object} msg - Telegram message object
   * @returns {Promise<{isRepeat: boolean, count: number}>}
   */
  async function detectRepeatMessage(userId, msg) {
    const hash = computeMessageHash(msg);
    if (!hash) return { isRepeat: false, count: 0 };

    const cacheKey = `msghash:${userId}:${hash}`;
    const now = Date.now();
    const cached = messageHashCache.get(cacheKey);

    // TTL 驱逐：过期条目视为首次出现
    if (cached && (now - cached.ts > config.SPAM_MESSAGE_HASH_TTL * 1000)) {
      messageHashCache.delete(cacheKey);
      const count = 1;
      setBoundedCache(messageHashCache, cacheKey, { count, ts: now }, MESSAGE_HASH_MAX_ENTRIES);
      return { isRepeat: false, count };
    }

    const count = (cached?.count || 0) + 1;
    setBoundedCache(messageHashCache, cacheKey, { count, ts: now }, MESSAGE_HASH_MAX_ENTRIES);

    if (count >= config.SPAM_REPEAT_MESSAGE_LIMIT) {
      return { isRepeat: true, count };
    }
    return { isRepeat: false, count };
  }

  /** 定期清理过期的 messageHashCache 条目（防止内存无限增长） */
  function pruneMessageHashCache(now) {
    const ttl = config.SPAM_MESSAGE_HASH_TTL * 1000;
    for (const [key, value] of messageHashCache) {
      if (now - value.ts > ttl) {
        messageHashCache.delete(key);
      }
    }
  }

  /**
   * 综合垃圾检测（关键词 + 链接 + 重复）
   * @param {object} msg - Telegram message object
   * @param {number} userId - 用户 ID
   * @param {object} env - 环境变量
   * @returns {Promise<{isSpam: boolean, reasons: string[], details: object}>}
   */
  async function spamCheck(msg, userId, env) {
    const reasons = [];
    const details = {};
    const text = buildSpamCheckText(msg).trim();

    // 1. 关键词检测
    const keywords = getSpamKeywords(env);
    const keywordResult = detectSpamKeywords(text, keywords);
    if (keywordResult.isSpam) {
      reasons.push('keyword');
      details.keyword = keywordResult.matchedWord;
    }

    // 2. 链接检测（新用户限制）
    if (containsLink(text)) {
      // 检查用户验证时间：如果在 24 小时内验证的，拦截链接
      const verifyTs = await getVerificationTimestamp(env, userId);
      if (!verifyTs) {
        reasons.push('new_user_link');
        details.linkBlockRemainingHours = Math.ceil(config.NEW_USER_LINK_BLOCK_SECONDS / 3600);
      } else {
        const elapsed = (Date.now() - parseInt(verifyTs)) / 1000;
        if (elapsed < config.NEW_USER_LINK_BLOCK_SECONDS) {
          const remainingHours = Math.ceil((config.NEW_USER_LINK_BLOCK_SECONDS - elapsed) / 3600);
          reasons.push('new_user_link');
          details.linkBlockRemainingHours = remainingHours;
        }
      }
    }

    // 3. 重复消息检测
    const repeatResult = await detectRepeatMessage(userId, msg);
    if (repeatResult.isRepeat) {
      reasons.push('repeat_message');
      details.repeatCount = repeatResult.count;
    }

    return {
      isSpam: reasons.length > 0,
      reasons,
      details,
    };
  }

  /**
   * 异步更新 spam 统计计数（在 waitUntil 中调用，不阻塞主响应）
   * @param {object} env - 环境变量
   * @param {string[]} reasons - spam 命中原因列表
   */
  async function updateSpamStats(env, reasons) {
    try {
      // 各原因计数并行写入，缩短 waitUntil 内滞留时间
      await Promise.all((reasons || []).map(async (reason) => {
        const countKey = `stats:spam:${reason}`;
        const current = parseInt(await env.TOPIC_MAP.get(countKey) || "0");
        await env.TOPIC_MAP.put(countKey, String(current + 1), { expirationTtl: 2592000 }); // 30天
      }));
      const totalKey = 'stats:spam:total';
      const total = parseInt(await env.TOPIC_MAP.get(totalKey) || "0");
      await env.TOPIC_MAP.put(totalKey, String(total + 1), { expirationTtl: 2592000 });
    } catch (e) {
      logger.warn('spam_stats_update_failed', { error: e.message });
    }
  }

  /**
   * 处理垃圾消息（通知管理员或静默丢弃）
   * @param {object} env - 环境变量
   * @param {number} userId - 用户 ID
   * @param {object} msg - 消息对象
   * @param {object} spamResult - spamCheck 返回的结果
   * @param {number} threadId - 可选，话题 ID
   */
  async function handleSpamMessage(env, userId, msg, spamResult, threadId, ctx) {
    logger.warn('spam_detected', {
      userId,
      reasons: spamResult.reasons,
      details: spamResult.details,
    });

    // 统计 spam 拦截计数（按原因分类，便于分析趋势）
    // 使用 waitUntil 异步写入 KV，不阻塞主响应
    // 注意：KV 无原子递增，多实例并发下计数可能略低于实际值，仅供参考
    if (ctx?.waitUntil) {
      ctx.waitUntil(updateSpamStats(env, spamResult.reasons));
    }

    if (config.SPAM_NOTIFY_ADMIN && !config.SPAM_SILENCE_MODE) {
      // 反查用户话题：有话题时把告警发到对应话题并给出可操作提示，避免文案与实际不符
      let notifyThreadId = threadId;
      if (!notifyThreadId) {
        const rec = await safeGetJSON(env, `user:${userId}`, null);
        notifyThreadId = rec?.thread_id || null;
      }
      const reasonText = spamResult.reasons.map(r => {
        switch (r) {
          case 'keyword': return `🔑 关键词: <code>${escapeHtml(spamResult.details.keyword)}</code>`;
          case 'new_user_link': return `🔗 新用户链接 (剩余 ${spamResult.details.linkBlockRemainingHours}h)`;
          case 'repeat_message': return `🔄 重复消息 (${spamResult.details.repeatCount}次)`;
          default: return escapeHtml(String(r));
        }
      }).join('\n');

      const body = notifyThreadId ? { message_thread_id: notifyThreadId } : {};

      await tgCall(env, 'sendMessage', {
        chat_id: env.SUPERGROUP_ID,
        text: adminCopy.spamIntercepted(escapeHtml(String(userId)), reasonText, { threadId: notifyThreadId }),
        parse_mode: 'HTML',
        ...body,
      });
    }
  }

  return {
    getSpamKeywords,
    detectRepeatMessage,
    pruneMessageHashCache,
    spamCheck,
    updateSpamStats,
    handleSpamMessage,
  };
}
