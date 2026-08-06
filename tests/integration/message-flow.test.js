/**
 * 主消息链路集成测试（走 worker.fetch 全链路）
 * 覆盖：验证→建话题→转发、媒体组、管理员回复、编辑通知、封禁拦截、屏蔽词、重复消息
 * 这是重构的安全网：任何行为回归都会在此暴露
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker.js';
import { createMockEnv } from '../helpers/mock-env.js';
import { createD1Storage } from '../../src/storage/d1-storage.js';

const SUPERGROUP_ID = '-1001234567890';
const ADMIN_ID = 123456789;

function createWebhookRequest(update) {
  return new Request('https://worker.test/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret-at-least-32-bytes',
    },
    body: JSON.stringify(update),
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * 可编程 Telegram mock：calls 记录全部调用；handler 可按 method 定制返回
 */
function createTelegramMock(handlers = {}) {
  const calls = [];
  async function fetchImpl(url, init) {
    const method = String(url).split('/').pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    if (handlers[method]) {
      return jsonResponse(await handlers[method](body, calls));
    }
    if (method === 'sendMessage') {
      return jsonResponse({
        ok: true,
        result: {
          message_id: 1000 + calls.length,
          ...(body.message_thread_id != null ? { message_thread_id: body.message_thread_id } : {}),
        },
      });
    }
    if (method === 'forwardMessage' || method === 'copyMessage') {
      return jsonResponse({
        ok: true,
        result: {
          message_id: 2000 + calls.length,
          ...(body.message_thread_id != null ? { message_thread_id: body.message_thread_id } : {}),
        },
      });
    }
    if (method === 'createForumTopic') {
      return jsonResponse({ ok: true, result: { message_thread_id: 88 } });
    }
    if (method === 'sendMediaGroup') {
      return jsonResponse({ ok: true, result: { message_id: 3000 + calls.length } });
    }
    return jsonResponse({ ok: true, result: true });
  }
  return { calls, fetchImpl };
}

/** ctx.waitUntil 捕获执行队列，测试中可显式 flush（真正等待每个 promise） */
function createTestCtx() {
  const pending = [];
  return {
    ctx: { waitUntil: (promise) => { pending.push(Promise.resolve(promise)); } },
    async flush() {
      await Promise.all(pending);
      pending.length = 0;
    },
  };
}

async function send(update, env, telegram) {
  const { ctx, flush } = createTestCtx();
  const response = await worker.fetch(createWebhookRequest(update), env, ctx);
  // 不自动 flush：媒体组等场景需要先推进假定时器再 flush
  return { response, flush };
}

/** 预置 KV 验证状态（等价于已验证用户） */
async function preVerify(env, userId) {
  await env.TOPIC_MAP.put(`verified:${userId}`, '1', { expirationTtl: 3600 });
  await env.TOPIC_MAP.put(`verified_ts:${userId}`, String(Date.now()), { expirationTtl: 3600 });
}

/** 预置 KV 话题映射 */
async function seedTopic(env, userId, threadId) {
  await env.TOPIC_MAP.put(`user:${userId}`, JSON.stringify({
    thread_id: threadId,
    title: `用户${userId}`,
    closed: false,
  }));
  await env.TOPIC_MAP.put(`thread:${threadId}`, String(userId));
}

function privateMessage(userId, messageId, overrides = {}) {
  return {
    message_id: messageId,
    text: `消息-${messageId}`,
    chat: { id: userId, type: 'private' },
    from: { id: userId, first_name: `用户${userId}` },
    ...overrides,
  };
}

/** 包装为完整 update 信封（含 update_id） */
function messageUpdate(message, updateId) {
  return { update_id: updateId, message };
}

describe('主消息链路（worker.fetch 全链路）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('新用户消息 → 本地题库验证 → 答对后自动建话题并转发', async () => {
    const telegram = createTelegramMock();
    vi.stubGlobal('fetch', telegram.fetchImpl);
    const env = createMockEnv();
    const userId = 111;

    // 1) 发消息 → 触发验证
    await send(messageUpdate(privateMessage(userId, 101, { text: '你好，管理员' }), 8100), env, telegram);
    const quiz = telegram.calls.find(c => c.method === 'sendMessage' && c.body.reply_markup);
    expect(quiz).toBeTruthy();
    expect(quiz.body.text).toContain('人机验证');
    const button = quiz.body.reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('verify:'));
    expect(button).toBeTruthy();
    const [, verifyId] = button.callback_data.split(':');

    // 从 KV 读取服务端保存的正确答案索引（点击任意第一个按钮不保证正确）
    const chalRaw = await env.TOPIC_MAP.get(`chal:${verifyId}`);
    expect(chalRaw).toBeTruthy();
    const correctIdx = JSON.parse(chalRaw).answerIndex;

    // 验证状态未写入，消息未转发
    expect(telegram.calls.some(c => c.method === 'forwardMessage')).toBe(false);

    // 2) 答对 → 转发待发消息 + 建话题 + 落映射
    const callback = {
      update_id: 8101,
      callback_query: {
        id: 'cb-8101',
        from: { id: userId, first_name: '用户111' },
        data: `verify:${verifyId}:${correctIdx}`,
        message: { message_id: 101, chat: { id: userId }, text: quiz.body.text },
      },
    };
    await send(callback, env, telegram);

    const fwd = telegram.calls.find(c => c.method === 'forwardMessage');
    expect(fwd).toBeTruthy();
    expect(fwd.body).toMatchObject({
      chat_id: SUPERGROUP_ID,
      from_chat_id: userId,
      message_id: 101,
      message_thread_id: 88,
    });
    expect(telegram.calls.some(c => c.method === 'createForumTopic')).toBe(true);
    expect(await env.TOPIC_MAP.get(`thread:88`)).toBe(String(userId));

    const storage = createD1Storage(env.TG_BOT_DB);
    const user = await storage.getUser(String(userId));
    expect(user).toMatchObject({ userId: String(userId), topicId: '88' });
    const link = await storage.getMessageLink('user_to_admin', String(userId), '101');
    expect(link).toMatchObject({ topicId: '88', userId: String(userId) });

    // 3) 已通过验证的用户再次发消息 → 直接转发不再弹题
    telegram.calls.length = 0;
    await send(messageUpdate(privateMessage(userId, 102, { text: '第二条消息' }), 8102), env, telegram);
    expect(telegram.calls.some(c => c.method === 'forwardMessage' && c.body.message_id === 102)).toBe(true);
  });

  it('答题错误时提示只追加一次（幂等）', async () => {
    const telegram = createTelegramMock();
    vi.stubGlobal('fetch', telegram.fetchImpl);
    const env = createMockEnv();
    const userId = 333;

    await send(messageUpdate(privateMessage(userId, 301, { text: '验证我' }), 8300), env, telegram);
    const quiz = telegram.calls.find(c => c.method === 'sendMessage' && c.body.reply_markup);
    const button = quiz.body.reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('verify:'));
    const [, verifyId] = button.callback_data.split(':');
    const chalRaw = await env.TOPIC_MAP.get(`chal:${verifyId}`);
    const correctIdx = JSON.parse(chalRaw).answerIndex;
    const wrongIdx = correctIdx === 0 ? 1 : 0;

    // 第一次答错 → toast 提示 + 题目消息追加 hint
    await send({
      update_id: 8301,
      callback_query: {
        id: 'cb-w1',
        from: { id: userId, first_name: '用户333' },
        data: `verify:${verifyId}:${wrongIdx}`,
        message: { message_id: 301, chat: { id: userId }, text: quiz.body.text },
      },
    }, env, telegram);

    const edited = telegram.calls.filter(c => c.method === 'editMessageText');
    expect(edited).toHaveLength(1);
    expect(edited[0].body.text).toContain('回答不正确');

    // 第二次答错 → message.text 已含 hint，不应再次追加
    telegram.calls.length = 0;
    await send({
      update_id: 8302,
      callback_query: {
        id: 'cb-w2',
        from: { id: userId, first_name: '用户333' },
        data: `verify:${verifyId}:${correctIdx === 0 ? 1 : 0}`,
        message: { message_id: 301, chat: { id: userId }, text: edited[0].body.text },
      },
    }, env, telegram);

    expect(telegram.calls.filter(c => c.method === 'editMessageText')).toHaveLength(0);
  });

  it('媒体组消息延迟合并后以 sendMediaGroup 转发到话题', async () => {
    vi.useFakeTimers();
    const telegram = createTelegramMock();
    vi.stubGlobal('fetch', telegram.fetchImpl);
    const env = createMockEnv();
    const userId = 222;
    await preVerify(env, userId);
    await seedTopic(env, userId, 88);

    const photo = privateMessage(userId, 201, {
      text: undefined,
      media_group_id: 'mg-201',
      photo: [{ file_id: 'photo-f1', width: 100, height: 100 }],
    });
    const { flush } = await send(messageUpdate(photo, 8201), env, telegram);
    await vi.advanceTimersByTimeAsync(3000);
    await flush();

    const mediaCall = telegram.calls.find(c => c.method === 'sendMediaGroup');
    expect(mediaCall).toBeTruthy();
    expect(mediaCall.body).toMatchObject({
      chat_id: SUPERGROUP_ID,
      message_thread_id: 88,
    });
    expect(mediaCall.body.media).toEqual([{ type: 'photo', media: 'photo-f1', caption: '' }]);
  });

  it('管理员在话题内回复 → copyMessage 直达用户并落 admin_to_user 映射', async () => {
    const telegram = createTelegramMock();
    vi.stubGlobal('fetch', telegram.fetchImpl);
    const env = createMockEnv();
    const userId = 333;
    await seedTopic(env, userId, 88);

    await send({
      update_id: 8301,
      message: {
        message_id: 501,
        text: '已收到，马上处理',
        chat: { id: SUPERGROUP_ID, type: 'supergroup' },
        message_thread_id: 88,
        from: { id: ADMIN_ID, first_name: '管理员' },
      },
    }, env, telegram);

    const copy = telegram.calls.find(c => c.method === 'copyMessage');
    expect(copy).toBeTruthy();
    expect(copy.body).toMatchObject({
      chat_id: userId,
      from_chat_id: SUPERGROUP_ID,
      message_id: 501,
    });
    const storage = createD1Storage(env.TG_BOT_DB);
    const link = await storage.getMessageLink('admin_to_user', String(SUPERGROUP_ID), '501');
    expect(link).toMatchObject({ userId: String(userId), topicId: '88' });
  });

  it('用户编辑消息 → 管理员话题收到修改通知并更新快照', async () => {
    const telegram = createTelegramMock();
    vi.stubGlobal('fetch', telegram.fetchImpl);
    const env = createMockEnv();
    const userId = 444;
    await preVerify(env, userId);
    await seedTopic(env, userId, 88);

    await send(messageUpdate(privateMessage(userId, 601, { text: '旧内容' }), 8400), env, telegram);
    expect(telegram.calls.some(c => c.method === 'forwardMessage' && c.body.message_id === 601)).toBe(true);

    telegram.calls.length = 0;
    await send({
      update_id: 8401,
      edited_message: privateMessage(userId, 601, { text: '新内容', edit_date: 3000 }),
    }, env, telegram);

    const notice = telegram.calls.find(c => c.method === 'sendMessage' && c.body.message_thread_id === '88');
    expect(notice).toBeTruthy();
    expect(notice.body.text).toContain('用户修改了消息');
    expect(notice.body.text).toContain('新内容');

    // 再次编辑相同内容 → 不重复通知
    telegram.calls.length = 0;
    await send({
      update_id: 8402,
      edited_message: privateMessage(userId, 601, { text: '新内容', edit_date: 4000 }),
    }, env, telegram);
    expect(telegram.calls.some(c => c.method === 'sendMessage' && c.body.message_thread_id === '88')).toBe(false);
  });

  it('封禁用户发消息 → 每小时提示一次且不转发', async () => {
    const telegram = createTelegramMock();
    vi.stubGlobal('fetch', telegram.fetchImpl);
    const env = createMockEnv();
    const userId = 555;
    await env.TOPIC_MAP.put(`banned:${userId}`, '1');

    await send(messageUpdate(privateMessage(userId, 701, { text: '我是被封禁的人' }), 8500), env, telegram);

    const notice = telegram.calls.find(c => c.method === 'sendMessage' && c.body.chat_id === userId);
    expect(notice.body.text).toContain('封禁');
    expect(telegram.calls.some(c => c.method === 'forwardMessage')).toBe(false);
    // 重复发送不再重复提示
    telegram.calls.length = 0;
    await send(messageUpdate(privateMessage(userId, 702), 8501), env, telegram);
    expect(telegram.calls.some(c => c.method === 'sendMessage' && c.body.chat_id === userId)).toBe(false);
  });

  it('/addword 添加屏蔽词后命中消息被拦截', async () => {
    const telegram = createTelegramMock();
    vi.stubGlobal('fetch', telegram.fetchImpl);
    const env = createMockEnv();

    await send({
      update_id: 8501,
      message: {
        message_id: 801,
        text: '/addword 违禁词',
        chat: { id: SUPERGROUP_ID, type: 'supergroup' },
        from: { id: ADMIN_ID },
      },
    }, env, telegram);
    expect(telegram.calls.some(c => c.method === 'sendMessage' && c.body.text.includes('已添加屏蔽词'))).toBe(true);

    const userId = 777;
    await preVerify(env, userId);
    await send(messageUpdate(privateMessage(userId, 802, { text: '这条消息含违禁词' }), 8600), env, telegram);

    const blocked = telegram.calls.find(c => c.method === 'sendMessage' && c.body.chat_id === userId);
    expect(blocked.body.text).toContain('拦截');
    expect(telegram.calls.some(c => c.method === 'forwardMessage')).toBe(false);
  });

  it('相同内容重复发送触发垃圾拦截并通知管理员', async () => {
    const telegram = createTelegramMock();
    vi.stubGlobal('fetch', telegram.fetchImpl);
    const env = createMockEnv();
    const userId = 666;
    await preVerify(env, userId);
    await seedTopic(env, userId, 88);

    let flush;
    for (let i = 0; i < 3; i += 1) {
      ({ flush } = await send(messageUpdate(privateMessage(userId, 900 + i, { text: '重复骚扰内容' }), 8700 + i), env, telegram));
    }
    // 等待 waitUntil 中的 spam 统计写入
    await flush();

    // 前 2 条转发，第 3 条被垃圾检测拦截
    expect(telegram.calls.filter(c => c.method === 'forwardMessage')).toHaveLength(2);
    const spamNotice = telegram.calls.find(c => c.method === 'sendMessage' && c.body.chat_id === SUPERGROUP_ID);
    expect(spamNotice.body.text).toContain('骚扰');
    expect(await env.TOPIC_MAP.get('stats:spam:total')).toBe('1');
  });
});
