import { describe, it, expect } from 'vitest';
import { createMockKV } from '../helpers/mock-kv.js';
import { createEphemeralStore } from '../../src/storage/kv-ephemeral-store.js';

describe('KV ephemeral store', () => {
  it('保存和读取有 TTL 的临时验证状态', async () => {
    const kv = createMockKV();
    const store = createEphemeralStore(kv);

    await store.setVerification('1', { ttl: 60, verifiedAt: 1000 });

    await expect(store.getVerification('1')).resolves.toEqual({ type: 'temporary' });
    await expect(store.getVerificationTimestamp('1')).resolves.toBe(1000);
  });

  it('拒绝把永久信任写入临时验证键', async () => {
    const kv = createMockKV();
    const store = createEphemeralStore(kv);

    await expect(store.setVerification('1', { type: 'trusted', ttl: 60 }))
      .rejects.toThrow('Permanent trust must use persistent storage');
    expect(kv._has('verified:1')).toBe(false);
  });

  it('清除验证时同时删除验证值和时间戳', async () => {
    const kv = createMockKV();
    const store = createEphemeralStore(kv);
    await store.setVerification('1', { ttl: 60, verifiedAt: 1000 });

    await store.clearVerification('1');

    await expect(store.getVerification('1')).resolves.toBe(null);
    await expect(store.getVerificationTimestamp('1')).resolves.toBe(null);
  });

  it('速率限制在窗口内递增并返回剩余额度', async () => {
    const store = createEphemeralStore(createMockKV());

    await expect(store.checkRateLimit('1', 'message', 2, 60))
      .resolves.toEqual({ allowed: true, remaining: 1 });
    await expect(store.checkRateLimit('1', 'message', 2, 60))
      .resolves.toEqual({ allowed: true, remaining: 0 });
    await expect(store.checkRateLimit('1', 'message', 2, 60))
      .resolves.toEqual({ allowed: false, remaining: 0 });
  });

  it('管理员和 Topic 健康缓存使用明确 TTL', async () => {
    const kv = createMockKV();
    const store = createEphemeralStore(kv);

    await store.setAdminCache('1', true, 300);
    await store.setTopicHealth('88', true, 60);

    await expect(store.getAdminCache('1')).resolves.toBe(true);
    await expect(store.getTopicHealth('88')).resolves.toBe(true);
  });

  it('管理员输入状态可设置、读取和清除', async () => {
    const store = createEphemeralStore(createMockKV());
    await store.setAdminState('1', { action: 'rule.create' }, 600);
    await expect(store.getAdminState('1')).resolves.toEqual({ action: 'rule.create' });
    await store.clearAdminState('1');
    await expect(store.getAdminState('1')).resolves.toBe(null);
  });
});
