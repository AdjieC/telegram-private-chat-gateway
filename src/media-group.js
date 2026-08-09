/**
 * 媒体组合并转发：延迟聚合同一 media_group 的消息后以 sendMediaGroup 发送。
 * 副作用依赖（tgCall/KV/清理）经 createMediaGroupModule(deps) 注入。
 */
import { withMessageThreadId } from './utils.js';

/**
 * @param {object} deps
 */
export function createMediaGroupModule(deps) {
  const {
    config,
    tgCall,
    safeGetJSON,
    logger,
  } = deps;

  async function handleMediaGroup(msg, env, ctx, { direction, targetChat, threadId }) {
    const groupId = msg.media_group_id;
    const key = `mg:${direction}:${groupId}`;
    const item = extractMedia(msg);
    if (!item) {
      await tgCall(env, "copyMessage", withMessageThreadId({
        chat_id: targetChat,
        from_chat_id: msg.chat.id,
        message_id: msg.message_id
      }, threadId));
      return;
    }
    let rec = await safeGetJSON(env, key, null);
    if (!rec) rec = { direction, targetChat, threadId: (threadId === null ? undefined : threadId), items: [], last_ts: Date.now() };
    rec.items.push({ ...item, msg_id: msg.message_id });
    rec.last_ts = Date.now();
    await env.TOPIC_MAP.put(key, JSON.stringify(rec), { expirationTtl: config.MEDIA_GROUP_EXPIRE_SECONDS });
    ctx.waitUntil(delaySend(env, key, rec.last_ts));
  }

  // 改进的媒体提取（支持更多类型，不修改原数组）
  function extractMedia(msg) {
    // 图片
    if (msg.photo && msg.photo.length > 0) {
      const highestResolution = msg.photo[msg.photo.length - 1]; // 不使用 pop()
      return {
        type: "photo",
        id: highestResolution.file_id,
        cap: msg.caption || ""
      };
    }

    // 视频
    if (msg.video) {
      return {
        type: "video",
        id: msg.video.file_id,
        cap: msg.caption || ""
      };
    }

    // 文档
    if (msg.document) {
      return {
        type: "document",
        id: msg.document.file_id,
        cap: msg.caption || ""
      };
    }

    // 音频
    if (msg.audio) {
      return {
        type: "audio",
        id: msg.audio.file_id,
        cap: msg.caption || ""
      };
    }

    // 动图
    if (msg.animation) {
      return {
        type: "animation",
        id: msg.animation.file_id,
        cap: msg.caption || ""
      };
    }

    // 语音和视频消息不支持 media group
    return null;
  }

  // 实现媒体组清理
  async function flushExpiredMediaGroups(env, now) {
    try {
      // 媒体组 key 自带 60s TTL，过期残留极少；单页 100 条足够覆盖，
      // 避免每次消息都在 waitUntil 里全量分页扫描（原上限 20 页 × 1000 key）。
      const result = await env.TOPIC_MAP.list({ prefix: 'mg:', limit: 100 });
      let deletedCount = 0;

      for (const { name } of result.keys || []) {
        const rec = await safeGetJSON(env, name, null);
        // 清理阈值与 KV 记录 TTL 保持一致（超过 MEDIA_GROUP_EXPIRE_SECONDS 视为过期残留）
        if (rec && rec.last_ts && (now - rec.last_ts > config.MEDIA_GROUP_EXPIRE_SECONDS * 1000)) {
          await env.TOPIC_MAP.delete(name);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        logger.info('media_groups_cleaned', { deletedCount });
      }
    } catch (e) {
      logger.error('media_group_cleanup_failed', e);
    }
  }

  // 改进媒体组延迟发送
  async function delaySend(env, key, ts) {
    await new Promise(r => setTimeout(r, config.MEDIA_GROUP_DELAY_MS));

    const rec = await safeGetJSON(env, key, null);

    if (rec && rec.last_ts === ts) {
      // 验证媒体数组
      if (!rec.items || rec.items.length === 0) {
        logger.warn('media_group_empty', { key });
        await env.TOPIC_MAP.delete(key);
        return;
      }

      const media = [];
      let captionAssigned = false;
      for (const it of rec.items) {
        if (!it.type || !it.id) {
          logger.warn('media_group_invalid_item', { key, item: it });
          continue;
        }
        // caption 只允许出现在第一个有效项上：若首项无效被过滤，自动落到下一有效项
        const caption = !captionAssigned ? (it.cap || '').substring(0, 1024) : '';
        if (caption) captionAssigned = true;
        media.push({ type: it.type, media: it.id, caption });
      }

      if (media.length > 0) {
        try {
          const result = await tgCall(env, "sendMediaGroup", withMessageThreadId({
            chat_id: rec.targetChat,
            media
          }, rec.threadId));

          if (!result.ok) {
            logger.error('media_group_send_failed', result.description, {
              key,
              mediaCount: media.length
            });
          } else {
            logger.info('media_group_sent', {
              key,
              mediaCount: media.length,
              targetChat: rec.targetChat
            });
          }
        } catch (e) {
          logger.error('media_group_send_exception', e, { key });
        }
      }

      await env.TOPIC_MAP.delete(key);
    }
  }

  return {
    handleMediaGroup,
    extractMedia,
    flushExpiredMediaGroups,
  };
}
