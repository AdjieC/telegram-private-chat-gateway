import { describe, expect, it } from 'vitest';
import { createKVStorage } from '../../src/storage/kv-storage.js';
import { createMockKV } from '../helpers/mock-kv.js';

describe('KV 长期状态兼容', () => {
  it('KV 兼容写不再保存永久信任', async () => {
    const kv = createMockKV(new Map([['user:1', JSON.stringify({ thread_id: 88 })]]));
    const storage = createKVStorage(kv);
    await storage.upsertUser({ userId: '1', topicId: '88', trustLevel: 'trusted' });
    await expect(kv.get('verified:1')).resolves.toBe(null);
  });
});
