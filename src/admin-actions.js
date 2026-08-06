/**
 * 管理动作命令：用户状态操作（封禁/静音/信任等）、词库管理、批量清理。
 * 全部为 env 直操作编排，副作用依赖经 createAdminActions(deps) 注入。
 * 词库共享逻辑来自 ./blocked-words.js。
 */
import {
  BLOCKED_WORDS,
  getBlockedWords,
  readKvBlockedWords,
  invalidateBlockedWordsCache,
} from './blocked-words.js';
import { ADMIN_COPY, USER_COPY } from './user-copy.js';
import { parseSpamKeywords, withMessageThreadId } from './utils.js';

/**
 * @param {object} deps
 */
export function createAdminActions(deps) {
  const {
    tgCall,
    safeGetJSON,
    escapeHtml,
    formatTimeBoth,
    buildUserActionKeyboard,
    createD1Storage,
    setPersistentTrust,
    getVerificationState,
    resolveUserFromForTopic,
    buildTopicTitle,
    bumpDailyStat,
    probeForumThread,
    config,
    logger,
  } = deps;

  async function panel(env, threadId, userId) {
    const from = await resolveUserFromForTopic(env, userId, null);
    const name = escapeHtml([from.first_name, from.last_name].filter(Boolean).join(' ').trim() || '未知');
    const un = from.username ? `@${escapeHtml(from.username)}` : '无用户名';
    const ban = await env.TOPIC_MAP.get(`banned:${userId}`);
    const muted = await env.TOPIC_MAP.get(`muted:${userId}`);
    const rec = await safeGetJSON(env, `user:${userId}`, null);
    const note = await env.TOPIC_MAP.get(`note:${userId}`);
    let lastMsgLine = '最近消息: 无';
    let d1Status = null;
    if (env.TG_BOT_DB) {
      try {
        const u = await createD1Storage(env.TG_BOT_DB).getUser(userId);
        if (u?.lastMessageAt) lastMsgLine = `最近消息: ${formatTimeBoth(u.lastMessageAt)}`;
        d1Status = u?.status || null;
      } catch { /* ignore */ }
    }
    const text = [
      '🎛 <b>用户面板</b>',
      '────────────────',
      `👤 ${name} · ${un}`,
      `UID <code>${userId}</code>`,
      `状态  封禁:${ban ? '🚫 是' : '否'} · 静音:${muted ? '🔇 是' : '否'} · 关闭:${rec?.closed ? '🔒 是' : '否'}`,
      d1Status ? `D1: <code>${escapeHtml(d1Status)}</code>` : '',
      lastMsgLine,
      note
        ? `📝 ${escapeHtml(String(note).slice(0, 80))}${String(note).length > 80 ? '…' : ''}`
        : '📝 无备注 · <code>/note 内容</code> 添加',
      '',
      '👇 点按钮操作',
      '<i>封禁 / 关闭 / 重置需二次确认</i>',
    ].filter(Boolean).join('\n');
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text,
      parse_mode: 'HTML',
      reply_markup: buildUserActionKeyboard(userId),
    });
  }

  async function mute(env, threadId, userId) {
    await env.TOPIC_MAP.put(`muted:${userId}`, '1');
    if (env.TG_BOT_DB) {
      try { await createD1Storage(env.TG_BOT_DB).updateUserState(userId, { isMuted: true }); } catch { /* ignore */ }
    }
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: '🔇 <b>已静音</b>：用户消息不再转发到本群',
      parse_mode: 'HTML',
    });
    await tgCall(env, 'sendMessage', {
      chat_id: userId,
      text: USER_COPY.muteUserNotify,
    });
  }

  async function unmute(env, threadId, userId) {
    await env.TOPIC_MAP.delete(`muted:${userId}`);
    await env.TOPIC_MAP.delete(`mute_notice:${userId}`);
    if (env.TG_BOT_DB) {
      try { await createD1Storage(env.TG_BOT_DB).updateUserState(userId, { isMuted: false }); } catch { /* ignore */ }
    }
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: '🔊 <b>已取消静音</b>',
      parse_mode: 'HTML',
    });
    await tgCall(env, 'sendMessage', {
      chat_id: userId,
      text: USER_COPY.unmuteUserNotify,
    });
  }

  async function note(env, threadId, userId, text) {
    const content = text.replace(/^\/note(@\w+)?\s*/i, '').trim();
    if (!content) {
      const existing = await env.TOPIC_MAP.get(`note:${userId}`);
      await tgCall(env, 'sendMessage', {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: threadId,
        text: existing
          ? `📝 <b>当前备注</b>\n${escapeHtml(existing)}\n\n用法: <code>/note 新备注</code>（发 <code>/note clear</code> 清空）`
          : '📝 暂无备注。用法: <code>/note 内容</code>',
        parse_mode: 'HTML',
      });
      return;
    }
    if (content.toLowerCase() === 'clear' || content === '-' || content === '清除') {
      await env.TOPIC_MAP.delete(`note:${userId}`);
      await tgCall(env, 'sendMessage', {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: threadId,
        text: '✅ 备注已清除',
      });
      return;
    }
    await env.TOPIC_MAP.put(`note:${userId}`, content.slice(0, 500), { expirationTtl: 365 * 86400 });
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: `✅ 备注已保存：\n${escapeHtml(content.slice(0, 500))}`,
      parse_mode: 'HTML',
    });
  }

  async function addWord(env, threadId, text, senderId) {
    const word = text.slice(9).trim();
    if (!word) {
      await tgCall(env, "sendMessage", {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: threadId,
        text: ADMIN_COPY.wordUsageAdd,
        parse_mode: "HTML",
      });
      return;
    }
    let kvWords = await readKvBlockedWords(env);

    // 检查是否已存在（合并硬编码一起判断）
    const allWords = [...new Set([...BLOCKED_WORDS, ...kvWords])];
    if (allWords.map(w => w.toLowerCase()).includes(word.toLowerCase())) {
      await tgCall(env, "sendMessage", {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: threadId,
        text: ADMIN_COPY.wordExists(escapeHtml(word)),
        parse_mode: "HTML",
      });
      return;
    }

    kvWords.push(word);
    await env.TOPIC_MAP.put("blocked_words_kv", JSON.stringify(kvWords));
    invalidateBlockedWordsCache();
    logger.info('blocked_word_added', { word, by: senderId });
    await tgCall(env, "sendMessage", {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: ADMIN_COPY.wordAdded(escapeHtml(word), kvWords.length),
      parse_mode: "HTML",
    });
  }

  async function delWord(env, threadId, text, senderId) {
    const word = text.slice(9).trim();
    if (!word) {
      await tgCall(env, "sendMessage", {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: threadId,
        text: ADMIN_COPY.wordUsageDel,
        parse_mode: "HTML",
      });
      return;
    }

    // 检查是否为硬编码词
    if (BLOCKED_WORDS.map(w => w.toLowerCase()).includes(word.toLowerCase())) {
      await tgCall(env, "sendMessage", {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: threadId,
        text: ADMIN_COPY.wordHardcoded(escapeHtml(word)),
        parse_mode: "HTML",
      });
      return;
    }

    let kvWords = await readKvBlockedWords(env);

    const before = kvWords.length;
    kvWords = kvWords.filter(w => w.toLowerCase() !== word.toLowerCase());

    if (kvWords.length === before) {
      await tgCall(env, "sendMessage", {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: threadId,
        text: ADMIN_COPY.wordMissing(escapeHtml(word)),
        parse_mode: "HTML",
      });
      return;
    }

    await env.TOPIC_MAP.put("blocked_words_kv", JSON.stringify(kvWords));
    invalidateBlockedWordsCache();
    logger.info('blocked_word_removed', { word, by: senderId });
    await tgCall(env, "sendMessage", {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: ADMIN_COPY.wordDeleted(escapeHtml(word), kvWords.length),
      parse_mode: "HTML",
    });
  }

  async function listWords(env, threadId) {
    const allWords = await getBlockedWords(env, true, logger); // 强制刷新
    const kvWords = await readKvBlockedWords(env);

    const hardcoded = BLOCKED_WORDS;
    const dynamic = kvWords.filter(w => !BLOCKED_WORDS.map(h => h.toLowerCase()).includes(w.toLowerCase()));
    // SPAM_KEYWORDS 是独立的垃圾检测词库（环境变量），不进入 blocked_words_kv
    const spamKeywords = parseSpamKeywords((env.SPAM_KEYWORDS || '').toString());

    const blockedTotal = allWords.length;
    const lines = [
      '📝 <b>内容过滤词库</b>',
      '',
      `<b>一、屏蔽词</b>（命中后拦截并提示用户，共 ${blockedTotal} 个）`,
      '',
      `🔧 <b>硬编码词</b> (${hardcoded.length} 个，修改需改代码):`,
      hardcoded.length > 0 ? hardcoded.map(w => `  • ${escapeHtml(w)}`).join('\n') : '  (无)',
      '',
      `💾 <b>动态词</b> (${dynamic.length} 个，可用 /addword /delword):`,
      dynamic.length > 0 ? dynamic.map(w => `  • ${escapeHtml(w)}`).join('\n') : '  (无)',
      '',
      `<b>二、垃圾关键词 SPAM_KEYWORDS</b>（环境变量，共 ${spamKeywords.length} 个）`,
      spamKeywords.length > 0
        ? spamKeywords.map(w => `  • ${escapeHtml(w)}`).join('\n')
        : '  (未配置；在 Cloudflare Variables 中设置 SPAM_KEYWORDS)',
      '',
      '<i>说明：/addword 只写入动态屏蔽词，不会改 SPAM_KEYWORDS。</i>',
    ];

    await tgCall(env, "sendMessage", {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: lines.join('\n'),
      parse_mode: "HTML",
    });
  }

  async function close(env, threadId, userId) {
    const key = `user:${userId}`;
    let rec = await safeGetJSON(env, key, null);
    if (!rec) {
      rec = { thread_id: threadId, closed: true };
    } else {
      rec.closed = true;
      if (!rec.thread_id) rec.thread_id = threadId;
    }
    await env.TOPIC_MAP.put(key, JSON.stringify(rec));
    if (env.TG_BOT_DB) {
      try {
        await createD1Storage(env.TG_BOT_DB).updateUserState(userId, { status: 'closed' });
      } catch (e) {
        logger.warn('close_d1_update_failed', { userId, error: e?.message });
      }
    }
    await tgCall(env, 'closeForumTopic', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
    });
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: '🚫 <b>对话已强制关闭</b>',
      parse_mode: 'HTML',
    });
  }

  async function open(env, threadId, userId) {
    const key = `user:${userId}`;
    let rec = await safeGetJSON(env, key, null);
    if (!rec) {
      rec = { thread_id: threadId, closed: false };
    } else {
      rec.closed = false;
      if (!rec.thread_id) rec.thread_id = threadId;
    }
    await env.TOPIC_MAP.put(key, JSON.stringify(rec));
    if (env.TG_BOT_DB) {
      try {
        await createD1Storage(env.TG_BOT_DB).updateUserState(userId, { status: 'active' });
      } catch (e) {
        logger.warn('open_d1_update_failed', { userId, error: e?.message });
      }
    }
    await tgCall(env, 'reopenForumTopic', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
    });
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: '✅ <b>对话已恢复</b>',
      parse_mode: 'HTML',
    });
  }

  async function reset(env, threadId, userId) {
    await setPersistentTrust(env, userId, 'normal');
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: '🔄 <b>验证重置</b>（已取消永久信任，下次需重新验证）',
      parse_mode: 'HTML',
    });
  }

  async function trust(env, threadId, userId) {
    await setPersistentTrust(env, userId, 'trusted');
    await env.TOPIC_MAP.delete(`needs_verify:${userId}`);
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: '🌟 <b>已设置永久信任</b>',
      parse_mode: 'HTML',
    });
  }

  async function ban(env, threadId, userId) {
    await env.TOPIC_MAP.put(`banned:${userId}`, "1");
    if (env.TG_BOT_DB) {
      try {
        await createD1Storage(env.TG_BOT_DB).updateUserState(userId, { status: 'banned' });
      } catch (e) {
        logger.warn('ban_d1_update_failed', { userId, error: e?.message });
      }
    }
    await bumpDailyStat(env, 'bans', 1);
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: '🚫 <b>用户已封禁</b>（已尝试通知对方）',
      parse_mode: 'HTML',
    });
    // 主动告知用户已被封禁，避免对方不知情仍持续发消息
    const notify = await tgCall(env, 'sendMessage', {
      chat_id: userId,
      text: USER_COPY.banUserNotify,
    });
    if (!notify?.ok) {
      logger.warn('ban_user_notify_failed', {
        userId,
        description: notify?.description,
      });
      await tgCall(env, 'sendMessage', {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: threadId,
        text: `⚠️ 已封禁，但通知用户失败（可能对方未私聊过机器人或已拉黑）：${escapeHtml(notify?.description || 'unknown')}`,
        parse_mode: 'HTML',
      });
    } else {
      await env.TOPIC_MAP.put(`ban_notice:${userId}`, '1', { expirationTtl: 3600 });
    }
  }

  async function unban(env, threadId, userId) {
    await env.TOPIC_MAP.delete(`banned:${userId}`);
    await env.TOPIC_MAP.delete(`ban_notice:${userId}`);
    if (env.TG_BOT_DB) {
      try {
        await createD1Storage(env.TG_BOT_DB).updateUserState(userId, { status: 'active' });
      } catch (e) {
        logger.warn('unban_d1_update_failed', { userId, error: e?.message });
      }
    }
    await tgCall(env, 'sendMessage', {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: '✅ <b>用户已解封</b>（已尝试通知对方）',
      parse_mode: 'HTML',
    });
    const notify = await tgCall(env, 'sendMessage', {
      chat_id: userId,
      text: USER_COPY.unbanUserNotify,
    });
    if (!notify?.ok) {
      logger.warn('unban_user_notify_failed', {
        userId,
        description: notify?.description,
      });
    }
  }

  async function info(env, threadId, userId) {
    const userKey = `user:${userId}`;
    let userRec = await safeGetJSON(env, userKey, null);
    const verifyStatus = await getVerificationState(env, userId);
    const banStatus = await env.TOPIC_MAP.get(`banned:${userId}`);

    // 补全资料并尽量修复历史「User」占位话题名
    const from = await resolveUserFromForTopic(env, userId, null);
    const resolvedTitle = buildTopicTitle(from);
    if (
      userRec?.thread_id
      && resolvedTitle
      && resolvedTitle !== 'User'
      && (!userRec.title || userRec.title === 'User' || /^User(\s@|$)/i.test(userRec.title))
    ) {
      try {
        const edit = await tgCall(env, 'editForumTopic', {
          chat_id: env.SUPERGROUP_ID,
          message_thread_id: userRec.thread_id,
          name: resolvedTitle,
        });
        if (edit?.ok) {
          userRec = { ...userRec, title: resolvedTitle };
          await env.TOPIC_MAP.put(userKey, JSON.stringify(userRec));
        }
      } catch (e) {
        logger.warn('info_topic_title_repair_failed', { userId, error: e?.message });
      }
    }

    const displayName = escapeHtml(
      [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || '未知',
    );
    const usernameText = from.username
      ? `@${escapeHtml(from.username)}`
      : '无';
    // t.me/username 在群内可点；tg://user?id= 在部分客户端对“群外用户”不可点
    const openLink = from.username
      ? `<a href="https://t.me/${escapeHtml(from.username)}">打开主页 @${escapeHtml(from.username)}</a>`
      : `<a href="tg://user?id=${userId}">打开用户资料</a>`;
    const topicTitle = escapeHtml(userRec?.title || resolvedTitle || '未知');
    const verifyText = verifyStatus
      ? (verifyStatus.type === 'trusted' ? '🌟 永久信任' : '✅ 已验证')
      : '❌ 未验证';
    const banText = banStatus ? '🚫 已封禁' : '✅ 正常';
    const muted = await env.TOPIC_MAP.get(`muted:${userId}`);
    const note = await env.TOPIC_MAP.get(`note:${userId}`);
    let lastMsgAt = null;
    let d1Status = null;
    if (env.TG_BOT_DB) {
      try {
        const u = await createD1Storage(env.TG_BOT_DB).getUser(userId);
        lastMsgAt = u?.lastMessageAt ?? null;
        d1Status = u?.status ?? null;
      } catch { /* ignore */ }
    }

    const lines = [
      '👤 <b>用户信息</b>',
      `姓名: ${displayName}`,
      `用户名: ${usernameText}`,
      `UID: <code>${userId}</code>`,
      `Topic ID: <code>${threadId}</code>`,
      `话题标题: ${topicTitle}`,
      `验证: ${verifyText}`,
      `封禁: ${banText} · 静音: ${muted ? '🔇 是' : '否'} · 会话关闭: ${userRec?.closed ? '是' : '否'}`,
      d1Status ? `D1 状态: <code>${escapeHtml(d1Status)}</code>` : '',
      `最近消息: ${formatTimeBoth(lastMsgAt)}`,
      note ? `备注: ${escapeHtml(note)}` : '备注: 无（/note 内容）',
      `链接: ${openLink}`,
      from.username
        ? ''
        : '<i>无公开用户名时部分客户端无法点击 tg 链接</i>',
    ].filter(Boolean).join('\n');

    await tgCall(env, "sendMessage", {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: threadId,
      text: lines,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: buildUserActionKeyboard(userId),
    });
  }

  /**
   * 批量清理命令处理函数（优化并发性能）
   *
   * 功能说明：
   * 1. 检查所有用户的话题记录
   * 2. 找出话题ID已不存在（被删除）的用户
   * 3. 删除这些用户的KV存储记录和验证状态
   * 4. 让他们下次发消息时重新验证并创建新话题
   *
   * 使用场景：
   * - 管理员手动删除了多个用户话题后
   * - 需要批量重置这些用户的状态
   *
   * @param {number} threadId - 当前话题ID（通常在General话题中调用）
   * @param {object} env - 环境变量对象
   */
  async function cleanup(threadId, env) {
    const lockKey = "cleanup:lock";
    const locked = await env.TOPIC_MAP.get(lockKey);
    if (locked) {
      await tgCall(env, "sendMessage", withMessageThreadId({
        chat_id: env.SUPERGROUP_ID,
        text: "⏳ **已有清理任务正在运行，请稍后再试。**",
        parse_mode: "Markdown"
      }, threadId));
      return;
    }

    await env.TOPIC_MAP.put(lockKey, "1", { expirationTtl: config.CLEANUP_LOCK_TTL_SECONDS });

    // 发送处理中的消息
    await tgCall(env, "sendMessage", withMessageThreadId({
      chat_id: env.SUPERGROUP_ID,
      text: "🔄 **正在扫描需要清理的用户...**",
      parse_mode: "Markdown"
    }, threadId));

    let cleanedCount = 0;
    let errorCount = 0;
    const cleanedUsers = [];
    let scannedCount = 0;

    try {
      // 逐页扫描，避免一次性拉取全部 keys 导致超时/内存膨胀
      let cursor = undefined;
      do {
        const result = await env.TOPIC_MAP.list({ prefix: "user:", cursor });
        const names = (result.keys || []).map(k => k.name);
        scannedCount += names.length;

        // 批量并发处理（限制并发数）
        for (let i = 0; i < names.length; i += config.CLEANUP_BATCH_SIZE) {
          const batch = names.slice(i, i + config.CLEANUP_BATCH_SIZE);

          const results = await Promise.allSettled(
            batch.map(async (name) => {
              const rec = await safeGetJSON(env, name, null);
              if (!rec || !rec.thread_id) return null;

              const userId = name.slice(5);
              const topicThreadId = rec.thread_id;

              // 检测话题是否存在：尝试向话题发送测试消息
              const probe = await probeForumThread(env, topicThreadId, {
                userId,
                reason: "cleanup_check",
                doubleCheckOnMissingThreadId: false
              });

              // cleanup 要求更保守：仅在明确缺失/重定向时清理，避免误删有效记录
              if (probe.status === "redirected" || probe.status === "missing") {
                await env.TOPIC_MAP.delete(name);
                await setPersistentTrust(env, userId, 'normal');
                await env.TOPIC_MAP.delete(`thread:${topicThreadId}`);

                return {
                  userId,
                  threadId: topicThreadId,
                  title: rec.title || "未知"
                };
              } else if (probe.status === "probe_invalid") {
                logger.warn('cleanup_probe_invalid_message', {
                  userId,
                  threadId: topicThreadId,
                  errorDescription: probe.description
                });
              } else if (probe.status === "unknown_error") {
                logger.warn('cleanup_probe_failed_unknown', {
                  userId,
                  threadId: topicThreadId,
                  errorDescription: probe.description
                });
              } else if (probe.status === "missing_thread_id") {
                logger.warn('cleanup_probe_missing_thread_id', { userId, threadId: topicThreadId });
              }

              return null;
            })
          );

          // 处理结果
          results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
              cleanedCount++;
              cleanedUsers.push(result.value);
              logger.info('cleanup_user', {
                userId: result.value.userId,
                threadId: result.value.threadId
              });
            } else if (result.status === 'rejected') {
              errorCount++;
              logger.error('cleanup_batch_error', result.reason);
            }
          });

          // 防止速率限制
          if (i + config.CLEANUP_BATCH_SIZE < names.length) {
            await new Promise(r => setTimeout(r, 600));
          }
        }

        cursor = result.list_complete ? undefined : result.cursor;

        // 在分页之间让出时间片，降低单次执行压力
        if (cursor) {
          await new Promise(r => setTimeout(r, 200));
        }
      } while (cursor);

      // 生成并发送清理报告
      let reportText = `✅ <b>清理完成</b>\n\n`;
      reportText += `📊 <b>统计</b>\n`;
      reportText += `• 扫描用户: <b>${scannedCount}</b>\n`;
      reportText += `• 已清理: <b>${cleanedCount}</b>\n`;
      reportText += `• 错误: ${errorCount}\n\n`;

      if (cleanedCount > 0) {
        reportText += `🗑 <b>已清理用户</b>（话题已删除）:\n`;
        for (const user of cleanedUsers.slice(0, config.MAX_CLEANUP_DISPLAY)) {
          reportText += `• UID <code>${escapeHtml(String(user.userId))}</code> · ${escapeHtml(user.title || '')}\n`;
        }
        if (cleanedUsers.length > config.MAX_CLEANUP_DISPLAY) {
          reportText += `\n…还有 ${cleanedUsers.length - config.MAX_CLEANUP_DISPLAY} 个\n`;
        }
        reportText += `\n💡 这些用户下次发消息将重新验证并创建新话题。`;
      } else {
        reportText += `✨ 没有发现需要清理的用户记录。`;
      }

      logger.info('cleanup_completed', {
        cleanedCount,
        errorCount,
        totalUsers: scannedCount
      });

      await tgCall(env, "sendMessage", withMessageThreadId({
        chat_id: env.SUPERGROUP_ID,
        text: reportText,
        parse_mode: "HTML"
      }, threadId));

    } catch (e) {
      logger.error('cleanup_failed', e, { threadId });
      await tgCall(env, "sendMessage", withMessageThreadId({
        chat_id: env.SUPERGROUP_ID,
        text: `❌ **清理过程出错**\n\n错误信息: \`${e.message}\``,
        parse_mode: "Markdown"
      }, threadId));
    } finally {
      await env.TOPIC_MAP.delete(lockKey);
    }
  }

  return {
    panel,
    info,
    note,
    mute,
    unmute,
    close,
    open,
    ban,
    unban,
    trust,
    reset,
    addWord,
    delWord,
    listWords,
    cleanup,
  };
}
