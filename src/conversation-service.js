import { extractMessageText } from './utils.js';

const SNAPSHOT_LIMIT = 5000;

export function snapshotMessage(message) {
  return extractMessageText(message).slice(0, SNAPSHOT_LIMIT);
}

export function hashContent(content) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/**
 * 会话服务：负责编辑消息的映射查询与修改通知。
 * 新消息转发、话题创建等主链路由 worker.js 编排（含网关特有逻辑），
 * 本模块仅承载「消息映射 → 编辑变更通知」这一独立职责。
 */
export function createConversationService({
  storage,
  telegram,
  policy,
  now = Date.now,
}) {
  async function evaluate(message, user) {
    return policy ? policy({ message, user }) : {
      action: 'allow',
      reason: null,
      shouldForward: true,
      shouldIncrementViolation: false,
    };
  }

  async function updateLinkSnapshot(link, message, contentSnapshot) {
    await storage.saveMessageLink({
      ...link,
      contentSnapshot,
      contentHash: hashContent(contentSnapshot),
      updatedAt: now(),
    });
  }

  async function handleEditedPrivateMessage(message) {
    const link = await storage.getMessageLink(
      'user_to_admin',
      message.chat.id,
      message.message_id,
    );
    if (!link) return { status: 'missing_link' };

    const user = await storage.getUser(link.userId);
    const policyResult = await evaluate(message, user || { userId: link.userId });
    if (!policyResult.shouldForward) {
      await telegram.call('sendMessage', {
        chat_id: link.targetChatId,
        message_thread_id: link.topicId,
        text: `🚫 用户编辑已拦截：${policyResult.reason || policyResult.action}`,
      });
      return { status: 'blocked', reason: policyResult.reason };
    }

    const contentSnapshot = snapshotMessage(message);
    if (hashContent(contentSnapshot) === link.contentHash) return { status: 'unchanged' };
    await telegram.call('sendMessage', {
      chat_id: link.targetChatId,
      message_thread_id: link.topicId,
      text: `✏️ 用户修改了消息\n原内容：${link.contentSnapshot || '(空)'}\n新内容：${contentSnapshot || '(空)'}`,
    });
    await updateLinkSnapshot(link, message, contentSnapshot);
    return { status: 'notified' };
  }

  async function handleEditedAdminMessage(message) {
    const link = await storage.getMessageLink(
      'admin_to_user',
      message.chat.id,
      message.message_id,
    );
    if (!link) return { status: 'missing_link' };
    const contentSnapshot = snapshotMessage(message);
    if (hashContent(contentSnapshot) === link.contentHash) return { status: 'unchanged' };

    await telegram.call('sendMessage', {
      chat_id: link.userId,
      text: `✏️ 管理员修改了回复\n原内容：${link.contentSnapshot || '(空)'}\n新内容：${contentSnapshot || '(空)'}`,
    });
    await updateLinkSnapshot(link, message, contentSnapshot);
    return { status: 'notified' };
  }

  return {
    handleEditedPrivateMessage,
    handleEditedAdminMessage,
  };
}
