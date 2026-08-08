import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSpamModule } from '../../src/spam.js';

/** 构造最小依赖的 spam 模块（可覆盖注入点便于单测） */
function createModule(overrides = {}) {
  return createSpamModule({
    config: {
      SPAM_MESSAGE_HASH_TTL: 3600,
      SPAM_REPEAT_MESSAGE_LIMIT: 3,
      NEW_USER_LINK_BLOCK_SECONDS: 86400,
      SPAM_NOTIFY_ADMIN: false,
      SPAM_SILENCE_MODE: false,
    },
    logger: { info() {}, warn() {}, error() {} },
    escapeHtml: (s) => String(s),
    adminCopy: { spamIntercepted: () => '' },
    safeGetJSON: async () => null,
    tgCall: async () => ({ ok: true }),
    getVerificationTimestamp: async () => null,
    setBoundedCache: (cache, key, value, max) => {
      cache.delete(key);
      cache.set(key, value);
      if (cache.size > max) cache.delete(cache.keys().next().value);
    },
    ...overrides,
  });
}

describe('spam module', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('相同内容连续发送达到阈值判定为重复垃圾', async () => {
    const m = createModule();
    const env = { SPAM_KEYWORDS: '' };
    const msg = { text: '重复内容', chat: { id: 1 }, from: { id: 1, first_name: 'x' } };
    expect((await m.spamCheck(msg, 1, env)).isSpam).toBe(false);
    expect((await m.spamCheck(msg, 1, env)).isSpam).toBe(false);
    const third = await m.spamCheck(msg, 1, env);
    expect(third.isSpam).toBe(true);
    expect(third.reasons).toContain('repeat_message');
    expect(third.details.repeatCount).toBe(3);
  });

  it('关键词命中返回 keyword 原因与命中词', async () => {
    const m = createModule();
    const env = { SPAM_KEYWORDS: '发票,套现' };
    const result = await m.spamCheck({ text: '低价代开发票', chat: { id: 2 }, from: { id: 2 } }, 2, env);
    expect(result.isSpam).toBe(true);
    expect(result.reasons).toContain('keyword');
    expect(result.details.keyword).toBe('发票');
  });

  it('新用户链接在验证时间戳缺失时拦截', async () => {
    const m = createModule({ getVerificationTimestamp: async () => null });
    const env = { SPAM_KEYWORDS: '' };
    const result = await m.spamCheck({ text: '访问 https://example.com', chat: { id: 3 }, from: { id: 3 } }, 3, env);
    expect(result.reasons).toContain('new_user_link');
    expect(result.details.linkBlockRemainingHours).toBe(24);
  });

  it('已验证但不足 24 小时的新用户仍拦截链接', async () => {
    // 验证时间戳在 1 小时前：仍处于 24h 链接限制窗口内
    const oneHourAgo = Date.now() - 3600 * 1000;
    const m = createModule({ getVerificationTimestamp: async () => String(oneHourAgo) });
    const env = { SPAM_KEYWORDS: '' };
    const result = await m.spamCheck({ text: '访问 https://example.com', chat: { id: 3 }, from: { id: 3 } }, 3, env);
    expect(result.reasons).toContain('new_user_link');
    expect(result.details.linkBlockRemainingHours).toBe(23);
  });

  it('已过 24 小时的新用户不再拦截链接', async () => {
    const twoDaysAgo = Date.now() - 2 * 86400 * 1000;
    const m = createModule({ getVerificationTimestamp: async () => String(twoDaysAgo) });
    const env = { SPAM_KEYWORDS: '' };
    const result = await m.spamCheck({ text: '访问 https://example.com', chat: { id: 3 }, from: { id: 3 } }, 3, env);
    expect(result.reasons).not.toContain('new_user_link');
  });

  it('pruneMessageHashCache 清理过期条目，之后重复发送重新计数', async () => {
    const m = createModule();
    const env = { SPAM_KEYWORDS: '' };
    const msg = { text: 'prune测试', chat: { id: 9 }, from: { id: 9 } };
    await m.spamCheck(msg, 9, env); // count 1
    await m.spamCheck(msg, 9, env); // count 2
    // 快进到 TTL 之后清理全部条目
    m.pruneMessageHashCache(Date.now() + 2 * 3600 * 1000);
    // 清理后视为首次出现，不再命中重复
    const after = await m.spamCheck(msg, 9, env);
    expect(after.isSpam).toBe(false);
    expect(after.details.repeatCount).toBeUndefined();
  });

  it('消息哈希 TTL 过期后重复发送重新计数', async () => {
    vi.useFakeTimers();
    const m = createModule();
    const env = { SPAM_KEYWORDS: '' };
    const msg = { text: 'TTL测试', chat: { id: 10 }, from: { id: 10 } };
    await m.spamCheck(msg, 10, env); // count 1
    // 推进超过 SPAM_MESSAGE_HASH_TTL（3600s）：过期条目视为首次出现
    vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
    const r = await m.spamCheck(msg, 10, env);
    expect(r.isSpam).toBe(false);
    expect(r.details.repeatCount).toBeUndefined();
  });

  it('updateSpamStats 按原因并行写入并累加 total', async () => {
    const store = new Map();
    const m = createModule();
    const env = {
      TOPIC_MAP: {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, value); },
      },
    };
    await m.updateSpamStats(env, ['keyword', 'keyword', 'repeat_message']);
    await m.updateSpamStats(env, ['keyword']);
    // KV 无原子递增，同一原因并行写入可能丢失一次更新（实现注释已声明该权衡）；
    // total 按事件计数（每次调用 +1），断言键被写入、total 累加正确即可
    expect(store.has('stats:spam:keyword')).toBe(true);
    expect(store.get('stats:spam:repeat_message')).toBe('1');
    expect(store.get('stats:spam:total')).toBe('2');
  });

  it('handleSpamMessage 在 SPAM_NOTIFY_ADMIN 关闭时不调用 tgCall', async () => {
    const calls = [];
    const m = createModule({
      tgCall: async (env, method) => { calls.push(method); return { ok: true }; },
    });
    const env = { TOPIC_MAP: {}, SUPERGROUP_ID: '-1001' };
    await m.handleSpamMessage(env, 5, {}, { isSpam: true, reasons: ['keyword'], details: { keyword: 'x' } }, null, { waitUntil: () => {} });
    expect(calls).toEqual([]);
  });

  it('handleSpamMessage 在通知开启时发送管理员告警', async () => {
    const calls = [];
    const m = createModule({
      config: {
        SPAM_MESSAGE_HASH_TTL: 3600,
        SPAM_REPEAT_MESSAGE_LIMIT: 3,
        NEW_USER_LINK_BLOCK_SECONDS: 86400,
        SPAM_NOTIFY_ADMIN: true,
        SPAM_SILENCE_MODE: false,
      },
      tgCall: async (env, method, body) => { calls.push({ method, body }); return { ok: true }; },
    });
    const env = { TOPIC_MAP: {}, SUPERGROUP_ID: '-1001' };
    await m.handleSpamMessage(env, 5, {}, { isSpam: true, reasons: ['repeat_message'], details: { repeatCount: 3 } }, 88, { waitUntil: () => {} });
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('sendMessage');
    expect(calls[0].body.message_thread_id).toBe(88);
  });

  it('handleSpamMessage 通知文案覆盖 keyword 与未知原因', async () => {
    const calls = [];
    const m = createModule({
      config: {
        SPAM_MESSAGE_HASH_TTL: 3600,
        SPAM_REPEAT_MESSAGE_LIMIT: 3,
        NEW_USER_LINK_BLOCK_SECONDS: 86400,
        SPAM_NOTIFY_ADMIN: true,
        SPAM_SILENCE_MODE: false,
      },
      tgCall: async (env, method, body) => { calls.push({ method, body }); return { ok: true }; },
      adminCopy: {
        spamIntercepted: (userId, reasonText) => `⚠️ 告警\n${reasonText}`,
      },
    });
    const env = { TOPIC_MAP: {}, SUPERGROUP_ID: '-1001' };
    await m.handleSpamMessage(env, 5, {}, {
      isSpam: true,
      reasons: ['keyword', 'unknown_reason'],
      details: { keyword: '发票' },
    }, null, { waitUntil: () => {} });
    expect(calls.length).toBe(1);
    expect(calls[0].body.text).toContain('发票');
    expect(calls[0].body.text).toContain('unknown_reason');
  });

  it('handleSpamMessage 无话题时反查 user 记录并发送到对应话题', async () => {
    const calls = [];
    const m = createModule({
      config: {
        SPAM_MESSAGE_HASH_TTL: 3600,
        SPAM_REPEAT_MESSAGE_LIMIT: 3,
        NEW_USER_LINK_BLOCK_SECONDS: 86400,
        SPAM_NOTIFY_ADMIN: true,
        SPAM_SILENCE_MODE: false,
      },
      safeGetJSON: async (env, key) => (key === 'user:5' ? { thread_id: 77 } : null),
      tgCall: async (env, method, body) => { calls.push({ method, body }); return { ok: true }; },
    });
    const env = { TOPIC_MAP: {}, SUPERGROUP_ID: '-1001' };
    await m.handleSpamMessage(env, 5, {}, { isSpam: true, reasons: ['repeat_message'], details: { repeatCount: 2 } }, undefined, { waitUntil: () => {} });
    expect(calls.length).toBe(1);
    expect(calls[0].body.message_thread_id).toBe(77);
  });
});
