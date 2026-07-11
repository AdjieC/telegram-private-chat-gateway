export function createEphemeralStore(kv) {
  return {
    async getVerification(userId) {
      const value = await kv.get(`verified:${userId}`);
      if (!value) return null;
      if (value === 'trusted') return { type: 'legacy_trusted' };
      return { type: 'temporary' };
    },

    async getVerificationTimestamp(userId) {
      const value = await kv.get(`verified_ts:${userId}`);
      return value == null ? null : Number(value);
    },

    async setVerification(userId, {
      type = 'temporary',
      ttl,
      verifiedAt = Date.now(),
    }) {
      if (type !== 'temporary') {
        throw new Error('Permanent trust must use persistent storage');
      }
      await Promise.all([
        kv.put(`verified:${userId}`, '1', { expirationTtl: ttl }),
        kv.put(`verified_ts:${userId}`, String(verifiedAt), { expirationTtl: ttl }),
      ]);
    },

    async clearVerification(userId) {
      await Promise.all([
        kv.delete(`verified:${userId}`),
        kv.delete(`verified_ts:${userId}`),
      ]);
    },

    async checkRateLimit(userId, action, limit, windowSeconds) {
      const key = `ratelimit:${action}:${userId}`;
      const count = Number(await kv.get(key) || 0);
      if (count >= limit) return { allowed: false, remaining: 0 };
      const next = count + 1;
      await kv.put(key, String(next), { expirationTtl: windowSeconds });
      return { allowed: true, remaining: Math.max(0, limit - next) };
    },

    async getAdminCache(userId) {
      const value = await kv.get(`admin:${userId}`);
      if (value == null) return null;
      return value === '1';
    },

    async setAdminCache(userId, isAdmin, ttl) {
      await kv.put(`admin:${userId}`, isAdmin ? '1' : '0', { expirationTtl: ttl });
    },

    async getAdminState(userId) {
      return kv.get(`admin_state:${userId}`, { type: 'json' });
    },

    async setAdminState(userId, state, ttl = 600) {
      await kv.put(`admin_state:${userId}`, JSON.stringify(state), { expirationTtl: ttl });
    },

    async clearAdminState(userId) {
      await kv.delete(`admin_state:${userId}`);
    },

    async getTopicHealth(topicId) {
      const value = await kv.get(`thread_ok:${topicId}`);
      if (value == null) return null;
      return value === '1';
    },

    async setTopicHealth(topicId, healthy, ttl) {
      await kv.put(`thread_ok:${topicId}`, healthy ? '1' : '0', { expirationTtl: ttl });
    },

    async clearTopicHealth(topicId) {
      await kv.delete(`thread_ok:${topicId}`);
    },
  };
}
