import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMediaGroupModule } from '../../src/media-group.js';

/** 构造最小依赖的媒体组合并模块（内存 KV + 记录 tgCall 调用） */
function createModule(overrides = {}) {
  const store = new Map();
  const calls = [];
  const module = createMediaGroupModule({
    config: { MEDIA_GROUP_EXPIRE_SECONDS: 60, MEDIA_GROUP_DELAY_MS: 3000 },
    tgCall: async (env, method, body) => {
      calls.push({ method, body });
      return { ok: true, result: { message_id: 1 } };
    },
    safeGetJSON: async (env, key, def) => {
      const raw = store.get(key);
      if (raw == null) return def;
      try { return JSON.parse(raw); } catch { return def; }
    },
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
  });
  const kv = {
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list() {
      return {
        keys: [...store.keys()].map(name => ({ name })),
        list_complete: true,
      };
    },
  };
  return { module, store, calls, kv };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('extractMedia（媒体类型提取）', () => {
  it('photo 取最高分辨率 file_id 并携带 caption', () => {
    const { module } = createModule();
    expect(module.extractMedia({
      photo: [{ file_id: 'low', width: 100 }, { file_id: 'hi', width: 800 }],
      caption: '图注',
    })).toEqual({ type: 'photo', id: 'hi', cap: '图注' });
  });

  it('video / document / audio / animation 各归其类', () => {
    const { module } = createModule();
    expect(module.extractMedia({ video: { file_id: 'v' } })).toEqual({ type: 'video', id: 'v', cap: '' });
    expect(module.extractMedia({ document: { file_id: 'd' } })).toEqual({ type: 'document', id: 'd', cap: '' });
    expect(module.extractMedia({ audio: { file_id: 'a' } })).toEqual({ type: 'audio', id: 'a', cap: '' });
    expect(module.extractMedia({ animation: { file_id: 'g' } })).toEqual({ type: 'animation', id: 'g', cap: '' });
  });

  it('语音/视频消息与纯文本不参与媒体组合并', () => {
    const { module } = createModule();
    expect(module.extractMedia({ voice: { file_id: 'voice' } })).toBe(null);
    expect(module.extractMedia({ video_note: { file_id: 'note' } })).toBe(null);
    expect(module.extractMedia({ text: '普通文字' })).toBe(null);
  });
});

describe('handleMediaGroup / delaySend（合并转发）', () => {
  it('同组消息延迟后单次 sendMediaGroup，成功后清理 KV 键', async () => {
    vi.useFakeTimers();
    const { module, store, calls, kv } = createModule();
    const env = { TOPIC_MAP: kv };
    const ctx = { waitUntil: vi.fn(p => p) };
    const base = { media_group_id: 'g1', chat: { id: 100 }, photo: [{ file_id: 'hi', width: 800 }] };

    await module.handleMediaGroup({ ...base, message_id: 1 }, env, ctx, { direction: 'p2t', targetChat: '-100', threadId: 88 });
    await module.handleMediaGroup({ ...base, message_id: 2 }, env, ctx, { direction: 'p2t', targetChat: '-100', threadId: 88 });

    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(ctx.waitUntil.mock.calls.map(([p]) => p));

    const sends = calls.filter(c => c.method === 'sendMediaGroup');
    expect(sends).toHaveLength(1);
    expect(sends[0].body.media).toEqual([
      { type: 'photo', media: 'hi', caption: '' },
      { type: 'photo', media: 'hi', caption: '' },
    ]);
    expect(store.has('mg:p2t:g1')).toBe(false);
  });

  it('首项无效被过滤时 caption 自动落到下一有效项', async () => {
    vi.useFakeTimers();
    const { module, calls, kv } = createModule();
    const env = { TOPIC_MAP: kv };
    const ctx = { waitUntil: vi.fn(p => p) };
    const group = { media_group_id: 'g-caption', chat: { id: 100 } };

    // 第一项 photo 无 file_id（无效），第二项 video 带 caption
    await module.handleMediaGroup(
      { ...group, message_id: 1, photo: [{ width: 100, height: 100 }] },
      env, ctx, { direction: 'p2t', targetChat: '-100', threadId: 88 },
    );
    await module.handleMediaGroup(
      { ...group, message_id: 2, video: { file_id: 'v1' }, caption: '第二项说明' },
      env, ctx, { direction: 'p2t', targetChat: '-100', threadId: 88 },
    );

    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(ctx.waitUntil.mock.calls.map(([p]) => p));

    const sends = calls.filter(c => c.method === 'sendMediaGroup');
    expect(sends).toHaveLength(1);
    expect(sends[0].body.media).toEqual([
      { type: 'video', media: 'v1', caption: '第二项说明' },
    ]);
  });

  it('无法提取媒体的消息直接 copyMessage 兜底，不走合并', async () => {
    const { module, calls, kv } = createModule();
    const env = { TOPIC_MAP: kv };
    const ctx = { waitUntil: vi.fn() };
    await module.handleMediaGroup(
      { media_group_id: 'g2', message_id: 1, chat: { id: 100 }, voice: { file_id: 'v' } },
      env, ctx, { direction: 'p2t', targetChat: '-100', threadId: 88 },
    );
    const copy = calls.find(c => c.method === 'copyMessage');
    expect(copy).toBeTruthy();
    expect(copy.body.message_thread_id).toBe(88);
    expect(calls.some(c => c.method === 'sendMediaGroup')).toBe(false);
  });
});

describe('flushExpiredMediaGroups（过期清理）', () => {
  it('仅删除超过保留期的残留键', async () => {
    const { module, store, kv } = createModule();
    const now = Date.now();
    store.set('mg:expired', JSON.stringify({ last_ts: now - 120_000, items: [], targetChat: '-100' }));
    store.set('mg:fresh', JSON.stringify({ last_ts: now - 1000, items: [], targetChat: '-100' }));

    await module.flushExpiredMediaGroups({ TOPIC_MAP: kv }, now);

    expect(store.has('mg:expired')).toBe(false);
    expect(store.has('mg:fresh')).toBe(true);
  });
});
