import { describe, it, expect, vi } from 'vitest';
import { createMockD1 } from '../helpers/mock-d1.js';
import { ensureMigrations } from '../../src/storage/migrations.js';
import { createD1Storage } from '../../src/storage/d1-storage.js';
import { createUpdateHandler, routeUpdate } from '../../src/update-router.js';

async function createStorage() {
  const db = createMockD1();
  await ensureMigrations(db, 1000);
  return { db, storage: createD1Storage(db) };
}

describe('Update idempotency', () => {
  it('同一 update_id 并发请求只执行一次副作用', async () => {
    const { storage } = await createStorage();
    const handleUpdate = vi.fn().mockResolvedValue(new Response('OK'));
    const update = { update_id: 42, message: { chat: { type: 'private' } } };

    const responses = await Promise.all([
      routeUpdate(update, { storage, handleUpdate, now: () => 2000 }),
      routeUpdate(update, { storage, handleUpdate, now: () => 2000 }),
    ]);

    expect(handleUpdate).toHaveBeenCalledTimes(1);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
  });

  it('已完成 Update 再次到达时直接返回成功', async () => {
    const { storage } = await createStorage();
    await storage.claimUpdate('42', 'message', 1000);
    await storage.completeUpdate('42', 1100);

    await expect(storage.claimUpdate('42', 'message', 1200)).resolves.toBe('duplicate');
  });

  it('处理状态超过五分钟后允许原子接管', async () => {
    const { storage } = await createStorage();
    await storage.claimUpdate('42', 'message', 1000);

    await expect(storage.claimUpdate('42', 'message', 301001))
      .resolves.toBe('reclaimed');
  });

  it('临时失败标记 retryable 并返回 500', async () => {
    const { storage } = await createStorage();
    const handleUpdate = vi.fn().mockRejectedValue(new Error('BOT_TOKEN=secret'));

    const response = await routeUpdate(
      { update_id: 42, message: { chat: { type: 'private' } } },
      { storage, handleUpdate, now: () => 2000 },
    );

    expect(response.status).toBe(500);
    expect(await storage.getProcessedUpdate('42')).toMatchObject({
      status: 'retryable',
      error_code: 'temporary',
    });
  });
});

describe('Update 业务分发', () => {
  it('编辑消息按私聊和管理员群组分别路由', async () => {
    const conversation = {
      handleEditedPrivateMessage: vi.fn(),
      handleEditedAdminMessage: vi.fn(),
    };
    const handleUpdate = createUpdateHandler({
      conversation,
      supergroupId: '-100123',
    });

    await handleUpdate({
      edited_message: { chat: { id: 1, type: 'private' } },
    });
    await handleUpdate({
      edited_message: { chat: { id: -100123, type: 'supergroup' } },
    });

    expect(conversation.handleEditedPrivateMessage).toHaveBeenCalledTimes(1);
    expect(conversation.handleEditedAdminMessage).toHaveBeenCalledTimes(1);
  });
});
