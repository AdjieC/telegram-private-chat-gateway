import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationService,
  hashContent,
  snapshotMessage,
} from '../../src/conversation-service.js';
import { createD1Storage } from '../../src/storage/d1-storage.js';
import { ensureMigrations } from '../../src/storage/migrations.js';
import { createMockD1 } from '../helpers/mock-d1.js';

function createPrivateMessage(userId, messageId, overrides = {}) {
  return {
    message_id: messageId,
    text: `message-${messageId}`,
    chat: { id: userId, type: 'private' },
    from: { id: userId, first_name: `User ${userId}` },
    ...overrides,
  };
}

function createTelegram(script = {}) {
  const calls = [];
  const counters = new Map();
  return {
    calls(method) {
      return calls.filter(call => call.method === method);
    },
    async call(method, body) {
      calls.push({ method, body });
      const index = counters.get(method) || 0;
      counters.set(method, index + 1);
      const configured = Array.isArray(script[method])
        ? script[method][index]
        : script[method];
      if (configured instanceof Error) throw configured;
      if (typeof configured === 'function') return configured(body, index);
      return configured || { ok: true, result: { message_id: 1000 + calls.length } };
    },
  };
}

/** 直接以映射落库方式铺设编辑链路前置状态（不再经由已删除的私聊转发路径） */
async function seedLink(storage, {
  direction = 'user_to_admin',
  userId,
  sourceMessageId,
  sourceChatId,
  targetChatId = '-100123',
  topicId = '88',
  text,
}) {
  await storage.saveMessageLink({
    direction,
    sourceChatId: sourceChatId ?? String(userId),
    sourceMessageId: String(sourceMessageId),
    targetChatId,
    targetMessageId: '900',
    topicId,
    userId: String(userId),
    contentSnapshot: text,
    contentHash: hashContent(text),
    createdAt: 1000,
    updatedAt: 1000,
  });
}

async function createDependencies(overrides = {}) {
  const db = createMockD1();
  await ensureMigrations(db, 1000);
  const storage = createD1Storage(db);
  return {
    storage,
    telegram: createTelegram(),
    policy: () => ({
      action: 'allow',
      reason: null,
      shouldForward: true,
      shouldIncrementViolation: false,
    }),
    now: () => 2000,
    ...overrides,
  };
}

describe('会话服务（编辑消息映射/通知）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('用户合法编辑向管理员 Topic 发送修改通知', async () => {
    const dependencies = await createDependencies();
    await seedLink(dependencies.storage, { userId: '1', sourceMessageId: 101, text: '旧内容' });
    const service = createConversationService(dependencies);

    const result = await service.handleEditedPrivateMessage(
      createPrivateMessage(1, 101, { text: '新内容', edit_date: 3000 }),
    );

    expect(result.status).toBe('notified');
    expect(dependencies.telegram.calls('sendMessage').at(-1).body).toMatchObject({
      chat_id: '-100123',
      message_thread_id: '88',
    });
    expect(dependencies.telegram.calls('sendMessage').at(-1).body.text).toContain('新内容');
  });

  it('用户违规编辑只发送拦截原因，不转发违规内容', async () => {
    const policy = ({ message }) => ({
      action: message.edit_date ? 'reject' : 'allow',
      reason: message.edit_date ? 'blocked_keyword' : null,
      shouldForward: !message.edit_date,
      shouldIncrementViolation: Boolean(message.edit_date),
    });
    const dependencies = await createDependencies({ policy });
    await seedLink(dependencies.storage, { userId: '1', sourceMessageId: 101, text: '旧内容' });
    const service = createConversationService(dependencies);

    const result = await service.handleEditedPrivateMessage(
      createPrivateMessage(1, 101, { text: '违规新内容', edit_date: 3000 }),
    );

    expect(result.status).toBe('blocked');
    const notice = dependencies.telegram.calls('sendMessage').at(-1).body.text;
    expect(notice).toContain('blocked_keyword');
    expect(notice).not.toContain('违规新内容');
  });

  it('管理员编辑回复时通知原用户', async () => {
    const dependencies = await createDependencies();
    await seedLink(dependencies.storage, {
      direction: 'admin_to_user',
      userId: '1',
      sourceMessageId: 501,
      sourceChatId: '-100123',
      targetChatId: '-100123',
      text: '旧回复',
    });
    const service = createConversationService(dependencies);

    const result = await service.handleEditedAdminMessage({
      message_id: 501,
      text: '新回复',
      edit_date: 3000,
      message_thread_id: 88,
      chat: { id: -100123, type: 'supergroup' },
    });

    expect(result.status).toBe('notified');
    expect(dependencies.telegram.calls('sendMessage').at(-1).body).toMatchObject({
      chat_id: '1',
    });
  });

  it('编辑消息缺少映射时完成处理且不发送通知', async () => {
    const dependencies = await createDependencies();
    const service = createConversationService(dependencies);

    await expect(service.handleEditedPrivateMessage(createPrivateMessage(1, 999)))
      .resolves.toEqual({ status: 'missing_link' });
    expect(dependencies.telegram.calls('sendMessage')).toHaveLength(0);
  });

  it('编辑内容哈希未变化时不重复通知', async () => {
    const dependencies = await createDependencies();
    await seedLink(dependencies.storage, { userId: '1', sourceMessageId: 101, text: '相同内容' });
    const service = createConversationService(dependencies);

    await expect(service.handleEditedPrivateMessage(
      createPrivateMessage(1, 101, { text: '相同内容', edit_date: 3000 }),
    )).resolves.toEqual({ status: 'unchanged' });
    expect(dependencies.telegram.calls('sendMessage')).toHaveLength(0);
  });

  it('snapshotMessage 截断超长内容且哈希稳定', () => {
    const longText = 'x'.repeat(6000);
    expect(snapshotMessage({ text: longText }).length).toBe(5000);
    expect(snapshotMessage({ text: 'hello' })).toBe('hello');
    expect(snapshotMessage({ caption: '说明' })).toBe('说明');
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
  });
});
