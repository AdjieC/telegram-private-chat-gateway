import { describe, expect, it, vi } from 'vitest';
import {
  buildProfileCard,
  buildTopicTitle,
  syncUserProfile,
} from '../../src/conversation-service.js';

describe('用户资料卡', () => {
  it('Topic 名称超长时保留完整用户 ID', () => {
    const title = buildTopicTitle({
      userId: '123456789',
      firstName: '很长'.repeat(100),
      username: 'example',
    });

    expect(title.length).toBeLessThanOrEqual(128);
    expect(title).toContain('123456789');
  });

  it('清理控制字符和重复空白', () => {
    expect(buildTopicTitle({
      userId: '42',
      firstName: ' A\n\u0000  B ',
      username: 'user-name',
    })).toBe('A B · @username · 42');
  });

  it('资料卡展示独立状态并使用版本化 Callback', () => {
    const card = buildProfileCard({
      userId: '42',
      username: 'example',
      firstName: 'Alice',
      status: 'closed',
      trustLevel: 'trusted',
      isMuted: true,
      violationCount: 3,
    });

    expect(card.text).toContain('永久信任');
    expect(card.text).toContain('已关闭');
    expect(card.text).toContain('已静音');
    expect(card.replyMarkup.inline_keyboard.flat()[0].callback_data).toMatch(/^v1:/);
  });

  it('资料同步失败只记录告警，不抛出异常', async () => {
    const logger = { warn: vi.fn() };
    await expect(syncUserProfile({ userId: '42', topicId: '88' }, {
      storage: { updateUserState: vi.fn().mockRejectedValue(new Error('D1 failed')) },
      telegram: { call: vi.fn() },
      logger,
      now: () => 1000,
    })).resolves.toEqual({ status: 'failed' });
    expect(logger.warn).toHaveBeenCalledWith('profile_sync_failed', expect.any(Object));
  });

  it('资料与资料卡均未变化时不写 D1 或调用 Telegram', async () => {
    const profile = { username: 'example', firstName: 'Alice', lastName: null };
    const storage = { updateUserState: vi.fn() };
    const telegram = { call: vi.fn() };
    await expect(syncUserProfile({
      userId: '42', topicId: '88', infoCardMessageId: '99', ...profile,
      profileSnapshot: JSON.stringify({ profile, titleUpdatedAt: 1000 }),
    }, { storage, telegram, logger: { warn() {} }, now: () => 2000 }))
      .resolves.toEqual({ status: 'unchanged' });
    expect(storage.updateUserState).not.toHaveBeenCalled();
    expect(telegram.call).not.toHaveBeenCalled();
  });
});
