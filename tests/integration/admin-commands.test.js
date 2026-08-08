import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminCommandHandlers } from '../../src/admin-commands.js';
import { createD1Storage } from '../../src/storage/d1-storage.js';
import { ensureMigrations } from '../../src/storage/migrations.js';
import { createMockEnv } from '../helpers/mock-env.js';

describe('admin-commands handlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createHandlers(env, calls, overrides = {}) {
    return createAdminCommandHandlers({
      tgCall: async (_env, method, body) => {
        calls.push({ method, body });
        return { ok: true, result: { message_id: 1, status: 'administrator' } };
      },
      gatewayVersion: '1.0.0-test',
      recordSystemError: () => {},
      isOwnerUser: () => true,
      isAdminUser: async () => true,
      parseIdAllowlist: () => [],
      safeGetJSON: async () => null,
      resolveThreadIdForUser: async () => 10,
      getRecentSystemErrors: () => [],
      createD1Storage,
      ensureMigrations,
      userActions: {},
      ...overrides,
    });
  }

  it('handleMenuCommand 发送含管理菜单文案与键盘', async () => {
    const env = createMockEnv();
    const calls = [];
    const h = createHandlers(env, calls);
    await h.handleMenuCommand(env, 1, 123456789);
    const send = calls.find(c => c.method === 'sendMessage');
    expect(send?.body?.text).toMatch(/管理菜单/);
    expect(send?.body?.reply_markup?.inline_keyboard?.flat?.()
      .some(b => b.callback_data === 'adm:nav:rank')).toBe(true);
  });

  it('handleSysinfoCommand stats 页包含 CST', async () => {
    const env = createMockEnv();
    const calls = [];
    const h = createHandlers(env, calls);
    await h.handleSysinfoCommand(env, 1, { page: 'stats' });
    const send = calls.find(c => c.method === 'sendMessage');
    expect(send?.body?.text).toMatch(/CST/);
    expect(send?.body?.text).toMatch(/今日/);
  });

  it('错误页只展示转义后的摘要与关联 ID，隐藏 stack 和正文', async () => {
    const env = createMockEnv();
    await env.TOPIC_MAP.put('sys:recent_errors', JSON.stringify([{
      ts: Date.now(),
      action: '<telegram_failed>',
      error: '连接失败 <tag>',
      stack: 'secret stack path',
      text: 'private message',
      caption: 'secret caption',
      extra: { secret: 'large unknown object' },
      userId: '<42>',
      updateId: '<update>',
      correlationId: '<correlation>',
    }]));

    const calls = [];
    const h = createHandlers(env, calls);
    await h.handleSysinfoCommand(env, 1, { page: 'errors' });

    const body = calls.find(call => call.method === 'sendMessage').body.text;
    expect(body).toContain('连接失败 &lt;tag&gt;');
    expect(body).toContain('uid &lt;42&gt;');
    expect(body).toContain('update &lt;update&gt;');
    expect(body).toContain('corr &lt;correlation&gt;');
    expect(body).not.toContain('secret stack path');
    expect(body).not.toContain('private message');
    expect(body).not.toContain('secret caption');
    expect(body).not.toContain('large unknown object');
  });

  it('错误页合并内存与 KV 后去重，最多展示 8 条', async () => {
    const env = createMockEnv();
    const now = Date.now();
    const memoryErrors = Array.from({ length: 8 }, (_, index) => ({
      ts: now - index,
      action: `memory_${index}`,
      error: `error_${index}`,
    }));
    await env.TOPIC_MAP.put('sys:recent_errors', JSON.stringify([
      memoryErrors[0],
      { ts: now - 100, action: 'kv_1', error: 'kv error 1' },
      { ts: now - 101, action: 'kv_2', error: 'kv error 2' },
    ]));

    const calls = [];
    const h = createHandlers(env, calls, {
      getRecentSystemErrors: () => memoryErrors,
    });
    await h.handleSysinfoCommand(env, 1, { page: 'errors' });

    const body = calls.find(call => call.method === 'sendMessage').body.text;
    const errorLines = body.split('\n').filter(line => line.startsWith('🔴 <b>'));
    expect(errorLines).toHaveLength(8);
    expect(errorLines.filter(line => line.includes('memory_0'))).toHaveLength(1);
    expect(body).not.toContain('kv_1');
    expect(body).not.toContain('kv_2');
  });

  it('bumpDailyStat 写入 CST 日键', async () => {
    const env = createMockEnv();
    const h = createHandlers(env, []);
    await h.bumpDailyStat(env, 'messages_in', 2);
    const keys = [];
    let cursor;
    do {
      const page = await env.TOPIC_MAP.list({ prefix: 'stats:', cursor, limit: 100 });
      keys.push(...(page.keys || []).map(k => k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    expect(keys.some(k => k.startsWith('stats:'))).toBe(true);
    const raw = await env.TOPIC_MAP.get(keys.find(k => k.startsWith('stats:')));
    const obj = JSON.parse(raw);
    expect(obj.messages_in).toBe(2);
    expect(obj.tz).toMatch(/UTC\+8/);
  });

  it('主动作成功但面板刷新失败时记录专用错误，不误报操作失败', async () => {
    const env = createMockEnv();
    const calls = [];
    const errors = [];
    const panelError = new Error('panel unavailable');
    const h = createHandlers(env, calls, {
      recordSystemError: (...args) => errors.push(args),
      userActions: {
        mute: vi.fn(async () => {}),
        panel: vi.fn(async () => { throw panelError; }),
      },
    });

    await h.handleAdminUiCallback({
      id: 'cb-1',
      data: 'adm:u:mute:42',
      from: { id: 123456789 },
      message: {
        message_thread_id: 10,
        chat: { id: '-1001234567890' },
        message_id: 1,
      },
    }, env);

    expect(errors).toContainEqual([
      'admin_panel_refresh_failed',
      panelError,
      { userId: '42' },
      env,
    ]);
    const answers = calls.filter(call => call.method === 'answerCallbackQuery');
    expect(answers).toHaveLength(1);
    expect(answers[0].body.text).not.toBe('操作失败，请重试');
  });
});
