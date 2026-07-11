import { extractMessageText } from './utils.js';

const SNAPSHOT_LIMIT = 5000;
const TOPIC_LOCK_TTL_MS = 30000;
const TOPIC_TITLE_LIMIT = 128;
const TOPIC_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

function cleanProfileText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTopicTitle(user) {
  const userId = cleanProfileText(user.userId) || 'unknown';
  const username = cleanProfileText(user.username).replace(/[^\w]/g, '');
  const displayName = cleanProfileText(
    [user.firstName, user.lastName].filter(Boolean).join(' '),
  ) || 'User';
  const suffix = `${username ? ` · @${username}` : ''} · ${userId}`;
  return `${displayName.slice(0, Math.max(0, TOPIC_TITLE_LIMIT - suffix.length))}${suffix}`;
}

export function buildProfileCard(user) {
  const status = user.status === 'banned'
    ? '已封禁'
    : user.status === 'closed' ? '已关闭' : '正常';
  const trust = user.trustLevel === 'trusted' ? '永久信任' : '普通';
  const muted = user.isMuted ? '已静音' : '未静音';
  const username = user.username ? `@${user.username}` : '无';
  return {
    text: [
      '👤 用户资料',
      `UID: ${user.userId}`,
      `用户名: ${username}`,
      `姓名: ${cleanProfileText([user.firstName, user.lastName].filter(Boolean).join(' ')) || '未知'}`,
      `会话状态: ${status}`,
      `信任状态: ${trust}`,
      `静音状态: ${muted}`,
      `违规次数: ${Number(user.violationCount || 0)}`,
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '信任/取消', callback_data: `v1:user:trust:${user.userId}` },
          { text: '封禁/解封', callback_data: `v1:user:ban:${user.userId}` },
        ],
        [
          { text: '关闭/打开', callback_data: `v1:user:close:${user.userId}` },
          { text: '静音/取消', callback_data: `v1:user:mute:${user.userId}` },
        ],
      ],
    },
  };
}

export async function syncUserProfile(user, {
  storage,
  telegram,
  logger,
  now = Date.now,
  supergroupId,
}) {
  try {
    let previous = {};
    try {
      previous = user.profileSnapshot ? JSON.parse(user.profileSnapshot) : {};
    } catch {
      previous = {};
    }
    const profile = {
      username: user.username ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
    };
    const profileChanged = JSON.stringify(previous.profile || null) !== JSON.stringify(profile);
    if (!profileChanged && user.infoCardMessageId) return { status: 'unchanged' };
    const titleUpdateDue = user.topicId && profileChanged && (
      !previous.titleUpdatedAt
      || now() - previous.titleUpdatedAt >= TOPIC_UPDATE_INTERVAL_MS
    );

    if (titleUpdateDue) {
      await telegram.call('editForumTopic', {
        chat_id: supergroupId,
        message_thread_id: user.topicId,
        name: buildTopicTitle(user),
      });
    }

    const card = buildProfileCard(user);
    let infoCardMessageId = user.infoCardMessageId;
    if (user.topicId && !infoCardMessageId) {
      const response = await telegram.call('sendMessage', {
        chat_id: supergroupId,
        message_thread_id: user.topicId,
        text: card.text,
        reply_markup: card.replyMarkup,
      });
      infoCardMessageId = telegramResultValue(response, 'message_id') ?? null;
    } else if (user.topicId && infoCardMessageId && profileChanged) {
      await telegram.call('editMessageText', {
        chat_id: supergroupId,
        message_id: infoCardMessageId,
        text: card.text,
        reply_markup: card.replyMarkup,
      });
    }

    await storage.updateUserState(user.userId, {
      username: profile.username,
      firstName: profile.firstName,
      lastName: profile.lastName,
      infoCardMessageId,
      profileSnapshot: JSON.stringify({
        profile,
        titleUpdatedAt: titleUpdateDue ? now() : previous.titleUpdatedAt ?? null,
      }),
    });
    return { status: 'synced' };
  } catch (error) {
    logger?.warn?.('profile_sync_failed', {
      userId: user.userId,
      error: error?.message || 'unknown',
    });
    return { status: 'failed' };
  }
}

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

function telegramResultValue(response, key) {
  return response?.result?.[key] ?? response?.[key];
}

function createRetryableError(message, category) {
  return Object.assign(new Error(message), { category, retryable: true });
}

export function createConversationService({
  storage,
  telegram,
  policy,
  logger,
  now = Date.now,
  randomId = () => crypto.randomUUID(),
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  supergroupId,
  syncProfiles = true,
}) {
  async function evaluate(message, user) {
    return policy ? policy({ message, user }) : {
      action: 'allow',
      reason: null,
      shouldForward: true,
      shouldIncrementViolation: false,
    };
  }

  async function ensureUser(message) {
    const userId = String(message.from?.id ?? message.chat?.id);
    const existing = await storage.getUser(userId);
    if (existing) return existing;
    const user = {
      userId,
      username: message.from?.username ?? null,
      firstName: message.from?.first_name ?? null,
      lastName: message.from?.last_name ?? null,
      status: 'active',
      trustLevel: 'normal',
    };
    if (storage.ensureUser) return storage.ensureUser(user);
    await storage.upsertUser(user);
    return storage.getUser(userId);
  }

  async function createTopic(user, token) {
    const response = await telegram.call('createForumTopic', {
      chat_id: supergroupId,
      name: buildTopicTitle(user),
    });
    const topicId = telegramResultValue(response, 'message_thread_id');
    if (topicId == null) throw createRetryableError('createForumTopic missing topic id', 'temporary');
    const saved = await storage.setTopic(user.userId, topicId, token, now());
    if (!saved) throw createRetryableError('topic lock ownership lost', 'topic_lock_lost');
    return String(topicId);
  }

  async function getOrCreateTopic(user) {
    const current = await storage.getUser(user.userId);
    if (current?.topicId) return current.topicId;

    const token = randomId();
    const acquired = await storage.acquireTopicLock(
      user.userId,
      token,
      now(),
      TOPIC_LOCK_TTL_MS,
    );
    if (acquired) {
      try {
        return await createTopic(current || user, token);
      } finally {
        await storage.releaseTopicLock(user.userId, token, now());
      }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(150 + attempt * 75);
      const refreshed = await storage.getUser(user.userId);
      if (refreshed?.topicId) return refreshed.topicId;
    }
    throw createRetryableError('topic creation is locked', 'topic_lock_busy');
  }

  async function saveLink({ direction, message, response, userId, topicId, targetChatId }) {
    const contentSnapshot = snapshotMessage(message);
    await storage.saveMessageLink({
      direction,
      sourceChatId: message.chat.id,
      sourceMessageId: message.message_id,
      targetChatId,
      targetMessageId: telegramResultValue(response, 'message_id'),
      topicId,
      userId,
      contentSnapshot,
      contentHash: hashContent(contentSnapshot),
      createdAt: now(),
      updatedAt: now(),
    });
  }

  async function copyPrivateMessage(message, user, topicId) {
    try {
      const response = await telegram.call('copyMessage', {
        chat_id: supergroupId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
        message_thread_id: topicId,
      });
      await saveLink({
        direction: 'user_to_admin',
        message,
        response,
        userId: user.userId,
        topicId,
        targetChatId: supergroupId,
      });
      return { status: 'forwarded', topicId };
    } catch (error) {
      if (error?.category !== 'topic_missing') throw error;
      await storage.clearTopic(user.userId, topicId, now());
      const replacementTopicId = await getOrCreateTopic(user);
      return copyPrivateMessage(message, user, replacementTopicId);
    }
  }

  async function handlePrivateMessage(message) {
    const user = await ensureUser(message);
    const policyResult = await evaluate(message, user);
    if (!policyResult.shouldForward) {
      return { status: policyResult.action, reason: policyResult.reason };
    }
    const topicId = await getOrCreateTopic(user);
    if (syncProfiles) {
      await syncUserProfile({
        ...user,
        topicId,
        username: message.from?.username ?? user.username,
        firstName: message.from?.first_name ?? user.firstName,
        lastName: message.from?.last_name ?? user.lastName,
      }, {
        storage,
        telegram,
        logger,
        now,
        supergroupId,
      });
    }
    return copyPrivateMessage(message, user, topicId);
  }

  async function handleAdminMessage(message) {
    const user = await storage.findUserByTopic(message.message_thread_id);
    if (!user) return { status: 'missing_user' };
    const response = await telegram.call('copyMessage', {
      chat_id: user.userId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
    await saveLink({
      direction: 'admin_to_user',
      message,
      response,
      userId: user.userId,
      topicId: user.topicId,
      targetChatId: user.userId,
    });
    return { status: 'forwarded' };
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
    handlePrivateMessage,
    handleAdminMessage,
    handleEditedPrivateMessage,
    handleEditedAdminMessage,
  };
}
