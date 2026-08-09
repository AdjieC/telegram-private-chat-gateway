/**
 * Mock KV 实现 — 用于单元测试中替代 Cloudflare KV
 * 提供与 env.TOPIC_MAP 兼容的接口（含 TTL 过期模拟）
 */

export function createMockKV(initialData = new Map()) {
  // 存储格式: { value, expiresAt }
  const store = new Map();
  for (const [k, v] of initialData) {
    store.set(k, { value: v, expiresAt: null });
  }

  function isExpired(entry) {
    return entry && entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  return {
    async get(key, options) {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) return null;
      if (options?.type === 'json' && typeof entry.value === 'string') {
        try { return JSON.parse(entry.value); } catch { return null; }
      }
      return entry.value;
    },

    async put(key, value, options) {
      const ttl = options?.expirationTtl;
      const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
      store.set(key, {
        value: typeof value === 'string' ? value : JSON.stringify(value),
        expiresAt,
      });
    },

    async delete(key) {
      store.delete(key);
    },

    async list({ prefix, limit = 1000, cursor } = {}) {
      const allNames = [...store.keys()]
        .filter(k => !prefix || k.startsWith(prefix))
        .filter(k => !isExpired(store.get(k)))
        .sort();
      // 真实 KV 分页语义：按游标推进，避免恒定返回 has_more 导致调用方死循环
      const start = cursor ? Number(cursor) || 0 : 0;
      const keys = allNames.slice(start, start + limit).map(name => ({ name }));
      const next = start + limit;
      const hasMore = next < allNames.length;
      return {
        keys,
        list_complete: !hasMore,
        cursor: hasMore ? String(next) : undefined,
      };
    },

    // 测试断言辅助方法
    _store: store,
    _getRaw(key) { return store.get(key)?.value; },
    _has(key) { return store.has(key) && !isExpired(store.get(key)); },
    _size() { return [...store.keys()].filter(k => !isExpired(store.get(k))).length; },
    _debug() { return Object.fromEntries([...store.entries()].map(([k, v]) => [k, v.value])); },
  };
}
