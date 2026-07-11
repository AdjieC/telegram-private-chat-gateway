import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationService } from '../../src/conversation-service.js';
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

async function createDependencies(overrides = {}) {
  const db = createMockD1();
  await ensureMigrations(db, 1000);
  const storage = createD1Storage(db);
  return {
    storage,
    telegram: createTelegram({
      createForumTopic: { ok: true, result: { message_thread_id: 88 } },
      copyMessage: { ok: true, result: { message_id: 900 } },
    }),
    policy: () => ({
      action: 'allow',
      reason: null,
      shouldForward: true,
      shouldIncrementViolation: false,
    }),
    logger: { info() {}, warn() {}, error() {} },
    now: () => 2000,
    randomId: () => 'lock-token',
    sleep: async () => {},
    supergroupId: '-100123',
    syncProfiles: false,
    ...overrides,
  };
}

describe('会话服务', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('同一新用户并发消息只创建一个 Topic', async () => {
    let releaseTopic;
    const topicReady = new Promise(resolve => { releaseTopic = resolve; });
    const telegram = createTelegram({
      createForumTopic: async () => {
        await topicReady;
        return { ok: true, result: { message_thread_id: 88 } };
      },
      copyMessage: body => ({
        ok: true,
        result: { message_id: body.message_id + 1000 },
      }),
    });
    let tokenIndex = 0;
    const dependencies = await createDependencies({
      telegram,
      randomId: () => `lock-token-${tokenIndex += 1}`,
    });
    const service = createConversationService(dependencies);

    const first = service.handlePrivateMessage(createPrivateMessage(1, 101));
    const second = service.handlePrivateMessage(createPrivateMessage(1, 102));
    releaseTopic();
    await Promise.all([first, second]);

    expect(telegram.calls('createForumTopic')).toHaveLength(1);
    expect(telegram.calls('copyMessage')).toHaveLength(2);
  });

  it('用户合法编辑向管理员 Topic 发送修改通知', async () => {
    const dependencies = await createDependencies();
    const service = createConversationService(dependencies);
    await service.handlePrivateMessage(createPrivateMessage(1, 101, { text: '旧内容' }));

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
    const service = createConversationService(dependencies);
    await service.handlePrivateMessage(createPrivateMessage(1, 101, { caption: '旧说明', text: undefined }));

    const result = await service.handleEditedPrivateMessage(
      createPrivateMessage(1, 101, { caption: '违规新说明', text: undefined, edit_date: 3000 }),
    );

    expect(result.status).toBe('blocked');
    const notice = dependencies.telegram.calls('sendMessage').at(-1).body.text;
    expect(notice).toContain('blocked_keyword');
    expect(notice).not.toContain('违规新说明');
  });

  it('管理员编辑回复时通知原用户', async () => {
    const dependencies = await createDependencies();
    await dependencies.storage.upsertUser({ userId: '1', topicId: '88' });
    const service = createConversationService(dependencies);
    await service.handleAdminMessage({
      message_id: 501,
      text: '旧回复',
      message_thread_id: 88,
      chat: { id: -100123, type: 'supergroup' },
    });

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
    const service = createConversationService(dependencies);
    await service.handlePrivateMessage(createPrivateMessage(1, 101, { text: '相同内容' }));

    await expect(service.handleEditedPrivateMessage(
      createPrivateMessage(1, 101, { text: '相同内容', edit_date: 3000 }),
    )).resolves.toEqual({ status: 'unchanged' });
    expect(dependencies.telegram.calls('sendMessage')).toHaveLength(0);
  });

  it('仅 topic_missing 清除并重建 Topic，网络错误保留映射', async () => {
    const topicMissing = Object.assign(new Error('topic missing'), { category: 'topic_missing' });
    const telegram = createTelegram({
      createForumTopic: [
        { ok: true, result: { message_thread_id: 88 } },
        { ok: true, result: { message_thread_id: 99 } },
      ],
      copyMessage: [
        topicMissing,
        { ok: true, result: { message_id: 901 } },
      ],
    });
    const dependencies = await createDependencies({ telegram });
    const service = createConversationService(dependencies);

    await service.handlePrivateMessage(createPrivateMessage(1, 101));

    expect(telegram.calls('createForumTopic')).toHaveLength(2);
    await expect(dependencies.storage.getUser('1')).resolves.toMatchObject({ topicId: '99' });

    const networkError = Object.assign(new Error('network'), { category: 'network' });
    const failingTelegram = createTelegram({ copyMessage: networkError });
    const failingService = createConversationService({
      ...dependencies,
      telegram: failingTelegram,
    });

    await expect(failingService.handlePrivateMessage(createPrivateMessage(1, 102)))
      .rejects.toBe(networkError);
    await expect(dependencies.storage.getUser('1')).resolves.toMatchObject({ topicId: '99' });
  });
});
