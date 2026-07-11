import { describe, expect, it, vi } from 'vitest';
import { createAdminService } from '../../src/admin-service.js';

const cases = [
  ['owner', 'admin.grant', true],
  ['operator', 'user.ban', true],
  ['operator', 'rule.create', false],
  ['rules_manager', 'rule.create', true],
  ['rules_manager', 'user.ban', false],
];

describe('管理员服务', () => {
  it.each(cases)('%s 对 %s 的权限为 %s', async (role, action, expected) => {
    const service = createAdminService({
      storage: { getAdminUser: vi.fn().mockResolvedValue({ role, enabled: true }) },
      ownerIds: [],
    });
    await expect(service.authorize('1', action)).resolves.toBe(expected);
  });

  it('恢复 Owner 始终拥有全部权限', async () => {
    const service = createAdminService({ storage: {}, ownerIds: ['1'] });
    await expect(service.authorize('1', 'admin.grant')).resolves.toBe(true);
  });

  it('私聊 /start 为授权管理员发送内联菜单', async () => {
    const telegram = { call: vi.fn().mockResolvedValue({ ok: true }) };
    const service = createAdminService({
      storage: { getAdminUser: vi.fn().mockResolvedValue({ role: 'operator', enabled: true }) },
      telegram,
      ownerIds: [],
    });

    await service.handlePrivateAdminMessage({
      text: '/start',
      chat: { id: 1, type: 'private' },
      from: { id: 1 },
    });

    expect(telegram.call).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
      chat_id: 1,
      reply_markup: {
        inline_keyboard: [[{ text: '检查后台连接', callback_data: 'v1:admin:status' }]],
      },
    }));
  });

  it('后台状态按钮只报告真实可用的连接状态', async () => {
    const telegram = { call: vi.fn().mockResolvedValue({ ok: true }) };
    const service = createAdminService({ storage: {}, telegram, ownerIds: ['1'] });

    await expect(service.handleCallbackQuery({
      id: 'cb', data: 'v1:admin:status', from: { id: 1 },
    })).resolves.toMatchObject({ status: 'handled' });
    expect(telegram.call).toHaveBeenCalledWith('answerCallbackQuery', {
      callback_query_id: 'cb',
      text: '后台连接正常',
      show_alert: false,
    });
  });

  it('规则管理员可以进入后台，但不能执行用户封禁操作', async () => {
    const storage = {
      getAdminUser: vi.fn().mockResolvedValue({ role: 'rules_manager', enabled: true }),
      getUser: vi.fn().mockResolvedValue({ userId: '42', status: 'active' }),
    };
    const telegram = { call: vi.fn().mockResolvedValue({ ok: true }) };
    const service = createAdminService({ storage, telegram });

    await expect(service.handlePrivateAdminMessage({
      text: '/start', chat: { id: 1 }, from: { id: 1 },
    })).resolves.toMatchObject({ status: 'menu' });
    await expect(service.handleCallbackQuery({
      id: 'cb', data: 'v1:user:ban:42', from: { id: 1 },
    })).resolves.toMatchObject({ status: 'unauthorized' });
    expect(storage.getUser).not.toHaveBeenCalled();
  });

  it('Operator 用户按钮更新 D1 状态并写入审计', async () => {
    const storage = {
      getAdminUser: vi.fn().mockResolvedValue({ role: 'operator', enabled: true }),
      getUser: vi.fn().mockResolvedValue({ userId: '42', status: 'active', trustLevel: 'normal' }),
      updateUserState: vi.fn().mockResolvedValue({ userId: '42', status: 'banned' }),
      appendAudit: vi.fn().mockResolvedValue(undefined),
    };
    const telegram = { call: vi.fn().mockResolvedValue({ ok: true }) };
    const service = createAdminService({
      storage, telegram, randomId: () => 'audit-1', now: () => 2000,
    });

    await expect(service.handleCallbackQuery({
      id: 'cb', data: 'v1:user:ban:42', from: { id: 1 },
    })).resolves.toMatchObject({ status: 'handled' });
    expect(storage.updateUserState).toHaveBeenCalledWith('42', { status: 'banned' });
    expect(storage.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      id: 'audit-1', action: 'user.ban', resourceId: '42',
    }));
    expect(telegram.call).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['trust', { trustLevel: 'normal' }, { trustLevel: 'trusted' }],
    ['ban', { status: 'banned' }, { status: 'active' }],
    ['close', { status: 'closed' }, { status: 'active' }],
    ['mute', { isMuted: false }, { isMuted: true }],
  ])('资料卡 %s 操作按当前状态切换', async (action, beforeState, changes) => {
    const storage = {
      getAdminUser: vi.fn().mockResolvedValue({ role: 'operator', enabled: true }),
      getUser: vi.fn().mockResolvedValue({ userId: '42', ...beforeState }),
      updateUserState: vi.fn().mockResolvedValue({ userId: '42', ...changes }),
      appendAudit: vi.fn(),
    };
    const service = createAdminService({
      storage,
      telegram: { call: vi.fn().mockResolvedValue({ ok: true }) },
    });

    await service.handleCallbackQuery({
      id: 'cb', data: `v1:user:${action}:42`, from: { id: 1 },
    });

    expect(storage.updateUserState).toHaveBeenCalledWith('42', changes);
  });

  it('拒绝格式非法或未知的 Callback', async () => {
    const telegram = { call: vi.fn().mockResolvedValue({ ok: true }) };
    const service = createAdminService({ storage: {}, telegram, ownerIds: ['1'] });
    await expect(service.handleCallbackQuery({
      id: 'cb', data: 'v1:user:drop-table:not-a-user', from: { id: 1 },
    })).resolves.toMatchObject({ status: 'invalid' });
    expect(telegram.call).toHaveBeenCalledWith('answerCallbackQuery', expect.objectContaining({
      show_alert: true,
    }));
  });

  it('规则写操作后主动失效策略缓存', async () => {
    const onRulesChanged = vi.fn();
    const storage = {
      upsertRule: vi.fn(),
      deleteRule: vi.fn().mockResolvedValue(true),
      setRuleEnabled: vi.fn().mockResolvedValue(true),
    };
    const service = createAdminService({
      storage,
      ownerIds: ['1'],
      onRulesChanged,
      randomId: () => 'r1',
      now: () => 2000,
    });

    await service.createRule('1', {
      ruleType: 'blocked_keyword', matchType: 'contains', pattern: 'x', action: 'reject',
    });
    await service.setRuleEnabled('1', 'r1', false);
    await service.deleteRule('1', 'r1');

    expect(onRulesChanged).toHaveBeenCalledTimes(3);
  });

  it('/cancel 清除管理员输入状态', async () => {
    const ephemeralStore = { clearAdminState: vi.fn() };
    const service = createAdminService({
      storage: { getAdminUser: vi.fn().mockResolvedValue({ role: 'operator', enabled: true }) },
      ephemeralStore,
      telegram: { call: vi.fn() },
    });
    await service.handlePrivateAdminMessage({
      text: '/cancel',
      chat: { id: 1, type: 'private' },
      from: { id: 1 },
    });
    expect(ephemeralStore.clearAdminState).toHaveBeenCalledWith(1);
  });

  it('Callback 执行时重新检查权限并只回答一次', async () => {
    const telegram = { call: vi.fn().mockResolvedValue({ ok: true }) };
    const service = createAdminService({
      storage: { getAdminUser: vi.fn().mockResolvedValue({ role: 'operator', enabled: false }) },
      telegram,
    });
    await service.handleCallbackQuery({ id: 'cb1', data: 'v1:admin:rules', from: { id: 1 } });
    expect(telegram.call).toHaveBeenCalledTimes(1);
    expect(telegram.call).toHaveBeenCalledWith('answerCallbackQuery', expect.objectContaining({
      callback_query_id: 'cb1',
      show_alert: true,
    }));
  });
});
