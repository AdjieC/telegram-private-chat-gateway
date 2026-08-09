import { describe, it, expect, vi } from 'vitest';
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

  it('KV 读取失败时不会伪造允许或成功状态', async () => {
    const kv = {
      get: vi.fn().mockRejectedValue(new Error('kv unavailable')),
      put: vi.fn(),
    };
    const store = createEphemeralStore(kv);

    await expect(store.checkRateLimit('42', 'message', 3, 60))
      .rejects.toThrow('kv unavailable');
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('达到限额后不再写入 KV，并沿用窗口 TTL', async () => {
    const kv = createMockKV();
    const put = vi.spyOn(kv, 'put');
    const store = createEphemeralStore(kv);

    await store.checkRateLimit('42', 'message', 1, 60);
    await store.checkRateLimit('42', 'message', 1, 60);

    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('ratelimit:message:42', '1', { expirationTtl: 60 });
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

describe('mock KV 分页（list 游标语义）', () => {
  it('超过 limit 时按游标推进直至 list_complete，不会死循环', async () => {
    const kv = createMockKV();
    for (let i = 0; i < 25; i += 1) {
      await kv.put(`user:${String(i).padStart(2, '0')}`, String(i));
    }

    const page1 = await kv.list({ prefix: 'user:', limit: 10 });
    expect(page1.keys).toHaveLength(10);
    expect(page1.list_complete).toBe(false);
    expect(page1.cursor).toBe('10');

    const page2 = await kv.list({ prefix: 'user:', limit: 10, cursor: page1.cursor });
    expect(page2.keys).toHaveLength(10);
    expect(page2.cursor).toBe('20');

    const page3 = await kv.list({ prefix: 'user:', limit: 10, cursor: page2.cursor });
    expect(page3.keys).toHaveLength(5);
    expect(page3.list_complete).toBe(true);
    expect(page3.cursor).toBeUndefined();
  });

  it('无前缀与过期键过滤保持一致', async () => {
    const kv = createMockKV();
    await kv.put('a:1', 'x');
    await kv.put('b:2', 'y');
    const all = await kv.list({});
    expect(all.keys).toHaveLength(2);
    expect(all.list_complete).toBe(true);
  });
});
