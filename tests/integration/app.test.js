import { describe, it, expect } from 'vitest';
import { createApp, constantTimeEqual } from '../../src/app.js';
import { createMockEnv } from '../helpers/mock-env.js';
import { ensureMigrations } from '../../src/storage/migrations.js';

describe('createApp', () => {
  it('固定时间比较正确处理相等值和长度不同值', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true);
    expect(constantTimeEqual('secret', 'wrong')).toBe(false);
    expect(constantTimeEqual('secret', 'secret-longer')).toBe(false);
  });

  it('GET /health 不访问 Telegram 或存储', async () => {
    const app = createApp({
      handleFetch: async () => {
        throw new Error('unexpected delegation');
      },
    });
    const response = await app.fetch(
      new Request('https://worker.test/health'),
      createMockEnv(),
      { waitUntil() {} },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');
  });

  it('GET /health/env 报告运行时键在位情况且不含敏感值', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://worker.test/health/env'),
      createMockEnv({
        BOT_TOKEN: 'real-bot-token',
        SUPERGROUP_ID: '',
      }),
      { waitUntil() {} },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.presence.BOT_TOKEN).toBe(true);
    expect(body.presence.SUPERGROUP_ID).toBe(false);
    expect(JSON.stringify(body)).not.toContain('real-bot-token');
  });

  it('GET /health/d1 在 D1 可用时返回 schema 版本', async () => {
    const env = createMockEnv();
    await ensureMigrations(env.TG_BOT_DB, 1000);
    const app = createApp();
    const response = await app.fetch(
      new Request('https://worker.test/health/d1'),
      env,
      { waitUntil() {} },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.schemaVersion).toBe(1);
  });

  it('缺少 SUPERGROUP_ID 时错误附带运行时在位诊断', async () => {
    const app = createApp();
    const response = await app.fetch(new Request('https://worker.test/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'test-webhook-secret-at-least-32-bytes',
      },
      body: JSON.stringify({ update_id: 1 }),
    }), createMockEnv({ SUPERGROUP_ID: '' }), { waitUntil() {} });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain('SUPERGROUP_ID not set');
    expect(text).toContain('present=');
    expect(text).toContain('missing=');
  });

  it('缺少 TOPIC_MAP 时健康检查仍可用于存活探测', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://worker.test/health'),
      createMockEnv({ TOPIC_MAP: undefined }),
      { waitUntil() {} },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');
  });

  it('GET / 缺少全部运行时绑定时仍返回 OK', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://worker.test/'),
      createMockEnv({
        TOPIC_MAP: undefined,
        TG_BOT_DB: undefined,
        BOT_TOKEN: undefined,
        SUPERGROUP_ID: undefined,
      }),
      { waitUntil() {} },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');
  });

  it('Telegram Webhook Secret 错误时返回 401 且不委派业务', async () => {
    const handleFetch = async () => {
      throw new Error('unexpected delegation');
    };
    const app = createApp({ handleFetch });
    const response = await app.fetch(new Request('https://worker.test/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wrong',
      },
      body: JSON.stringify({ update_id: 1 }),
    }), createMockEnv(), { waitUntil() {} });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
  });

  it('Telegram Webhook 缺少 Secret 配置时返回明确错误', async () => {
    const app = createApp();
    const response = await app.fetch(new Request('https://worker.test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 1 }),
    }), createMockEnv({ WEBHOOK_SECRET: '' }), { waitUntil() {} });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Error: WEBHOOK_SECRET not set');
  });

  it('Telegram Webhook 非 JSON 时返回 415', async () => {
    const app = createApp();
    const response = await app.fetch(new Request('https://worker.test/', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-telegram-bot-api-secret-token': 'test-webhook-secret-at-least-32-bytes',
      },
      body: 'x',
    }), createMockEnv(), { waitUntil() {} });

    expect(response.status).toBe(415);
  });

  it('Telegram Webhook JSON 非法时返回 400 且不委派业务', async () => {
    const app = createApp({
      handleFetch: async () => {
        throw new Error('unexpected delegation');
      },
    });
    const response = await app.fetch(new Request('https://worker.test/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'test-webhook-secret-at-least-32-bytes',
      },
      body: '{',
    }), createMockEnv(), { waitUntil() {} });

    expect(response.status).toBe(400);
  });

  it('合法 Telegram Webhook 通过安全守卫后委派原处理器', async () => {
    const handleFetch = async () => new Response('delegated', { status: 202 });
    const app = createApp({ handleFetch });
    const response = await app.fetch(new Request('https://worker.test/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-telegram-bot-api-secret-token': 'test-webhook-secret-at-least-32-bytes',
      },
      body: JSON.stringify({ update_id: 1 }),
    }), createMockEnv(), { waitUntil() {} });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('delegated');
  });

  it('相同 update_id 重复请求只委派一次原处理器', async () => {
    const handleFetch = vi.fn().mockResolvedValue(new Response('OK'));
    const app = createApp({ handleFetch });
    const env = createMockEnv();
    const createRequest = () => new Request('https://worker.test/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'test-webhook-secret-at-least-32-bytes',
      },
      body: JSON.stringify({ update_id: 99, message: { chat: { type: 'private' } } }),
    });

    const responses = await Promise.all([
      app.fetch(createRequest(), env, { waitUntil() {} }),
      app.fetch(createRequest(), env, { waitUntil() {} }),
    ]);

    expect(handleFetch).toHaveBeenCalledTimes(1);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
  });

  it('Turnstile verify-callback 不要求 Telegram Webhook Secret', async () => {
    const handleFetch = async () => new Response('verify delegated', { status: 202 });
    const app = createApp({ handleFetch });
    const response = await app.fetch(new Request('https://worker.test/verify-callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'token', code: 'code', userId: '1' }),
    }), createMockEnv(), { waitUntil() {} });

    expect(response.status).toBe(202);
  });

  it('超过 1 MiB 的公开 POST 请求在委派前返回 413', async () => {
    const handleFetch = vi.fn();
    const app = createApp({ handleFetch });
    const response = await app.fetch(new Request('https://worker.test/verify-callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'x'.repeat(1024 * 1024) }),
    }), createMockEnv(), { waitUntil() {} });

    expect(response.status).toBe(413);
    expect(handleFetch).not.toHaveBeenCalled();
  });

  it('业务端点缺少运行时绑定时返回 500', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://worker.test/verify', { method: 'GET' }),
      createMockEnv({ TOPIC_MAP: undefined }),
      { waitUntil() {} },
    );
    expect(response.status).toBe(500);
  });

  it('scheduled 入口执行 D1 保留期清理', async () => {
    const env = createMockEnv();
    await ensureMigrations(env.TG_BOT_DB, 1000);
    env.TG_BOT_DB._table('processed_updates').push({ update_id: 'old', claimed_at: 0 });
    env.TG_BOT_DB._table('message_links').push({
      direction: 'x', source_chat_id: '1', source_message_id: '1', created_at: 0,
    });
    env.TG_BOT_DB._table('admin_audit_log').push({ id: 'old', created_at: 0 });

    await expect(createApp().scheduled({}, env)).resolves.toEqual({
      processedUpdates: 1,
      messageLinks: 1,
      adminAudits: 1,
    });
  });

  it('scheduled 缺少 D1 时明确失败', async () => {
    await expect(createApp().scheduled({}, createMockEnv({ TG_BOT_DB: undefined })))
      .rejects.toThrow("D1 'TG_BOT_DB' not bound");
  });
});
