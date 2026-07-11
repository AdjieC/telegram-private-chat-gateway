async function readJson(kv, key) {
  const value = await kv.get(key, { type: 'json' });
  return value && typeof value === 'object' ? value : null;
}

export function createKVStorage(kv) {
  const storage = {
    async getUser(userId) {
      const id = String(userId);
      const record = await readJson(kv, `user:${id}`);
      if (!record) return null;

      const [banned, verification] = await Promise.all([
        kv.get(`banned:${id}`),
        kv.get(`verified:${id}`),
      ]);
      return {
        userId: id,
        username: record.username || null,
        firstName: record.first_name || null,
        lastName: record.last_name || null,
        status: banned ? 'banned' : record.closed ? 'closed' : 'active',
        trustLevel: verification === 'trusted' ? 'trusted' : 'normal',
        isMuted: Boolean(record.is_muted),
        violationCount: Number(record.violation_count || 0),
        topicId: record.thread_id == null ? null : String(record.thread_id),
        infoCardMessageId: record.info_card_message_id == null
          ? null
          : String(record.info_card_message_id),
        profileSnapshot: record.user_info_json || null,
        title: record.title || null,
        createdAt: record.created_at || null,
        updatedAt: record.updated_at || null,
        lastMessageAt: record.last_message_at || null,
      };
    },

    async upsertUser(user) {
      const id = String(user.userId);
      const existing = await readJson(kv, `user:${id}`) || {};
      const record = {
        ...existing,
        thread_id: user.topicId ?? existing.thread_id ?? null,
        title: user.title ?? existing.title ?? null,
        closed: user.status === 'closed',
        username: user.username ?? existing.username ?? null,
        first_name: user.firstName ?? existing.first_name ?? null,
        last_name: user.lastName ?? existing.last_name ?? null,
        is_muted: user.isMuted ?? existing.is_muted ?? false,
        violation_count: user.violationCount ?? existing.violation_count ?? 0,
        info_card_message_id: user.infoCardMessageId
          ?? existing.info_card_message_id
          ?? null,
        user_info_json: user.profileSnapshot ?? existing.user_info_json ?? null,
        created_at: user.createdAt ?? existing.created_at ?? Date.now(),
        updated_at: user.updatedAt ?? Date.now(),
        last_message_at: user.lastMessageAt ?? existing.last_message_at ?? null,
      };
      await kv.put(`user:${id}`, JSON.stringify(record));

      if (record.thread_id != null) {
        await kv.put(`thread:${record.thread_id}`, id);
      }
      if (user.status === 'banned') await kv.put(`banned:${id}`, '1');
      else await kv.delete(`banned:${id}`);
      if (user.trustLevel !== 'trusted' && await kv.get(`verified:${id}`) === 'trusted') {
        await kv.delete(`verified:${id}`);
      }
    },

    async findUserByTopic(topicId) {
      const userId = await kv.get(`thread:${topicId}`);
      return userId ? storage.getUser(userId) : null;
    },

    async updateUserState(userId, changes) {
      const existing = await storage.getUser(userId);
      if (!existing) return null;
      const updated = { ...existing, ...changes, userId: String(userId) };
      await storage.upsertUser(updated);
      return updated;
    },
  };

  return storage;
}
