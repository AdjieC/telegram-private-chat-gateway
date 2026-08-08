import { describe, it, expect } from 'vitest';
import {
  USER_COPY,
  ADMIN_COPY,
  EDIT_SNIPPET_LIMIT,
  truncateText,
  policyReasonLabel,
} from '../../src/user-copy.js';

describe('user-copy', () => {
  it('用户侧拦截/限流文案齐全', () => {
    expect(USER_COPY.rateLimited(1)).toMatch(/频繁/);
    expect(USER_COPY.rateLimited(1)).toContain('1 分钟');
    // 明确告知本次消息未送达，避免用户误以为消息已发送
    expect(USER_COPY.rateLimited(1)).toContain('本次消息未送达');
    expect(USER_COPY.systemBusy).toMatch(/繁忙/);
    expect(USER_COPY.bannedHourly).toMatch(/封禁/);
    expect(USER_COPY.mutedHourly).toMatch(/静音/);
    expect(USER_COPY.blockedWord).toMatch(/拦截/);
    expect(USER_COPY.conversationClosed).toMatch(/关闭/);
    expect(USER_COPY.pendingDelivered(3)).toMatch(/3/);
    expect(USER_COPY.banUserNotify).toBe(USER_COPY.bannedHourly);
  });

  it('管理侧 spam/转发失败为 HTML 结构', () => {
    const spam = ADMIN_COPY.spamIntercepted('1', '🔑 x');
    expect(spam).toMatch(/<b>/);
    expect(spam).toMatch(/code/);
    // 无话题时引导用 /find 定位，有话题时引导用 /panel
    expect(spam).toContain('/find UID');
    expect(ADMIN_COPY.spamIntercepted('1', '🔑 x', { threadId: 88 })).toContain('/panel');
    expect(ADMIN_COPY.spamIntercepted('1', '🔑 x', { threadId: 88 })).not.toContain('/find');
    const fwd = ADMIN_COPY.forwardTotalFail('1', '2', 'a', 'b');
    expect(fwd).toMatch(/转发完全失败/);
    expect(ADMIN_COPY.wordUsageAdd).toMatch(/addword/);
  });

  it('编辑通知文案集中且保留关键语义', () => {
    expect(USER_COPY.adminEditedReply('旧', '新')).toContain('管理员修改了回复');
    expect(USER_COPY.adminEditedReply('旧', '新')).toContain('新内容');
    expect(ADMIN_COPY.userEditedMessage('旧', '新')).toContain('用户修改了消息');
    expect(ADMIN_COPY.userEditedMessage('旧', '新')).toContain('新内容');
    expect(ADMIN_COPY.userEditBlocked('blocked_keyword')).toContain('命中屏蔽词或规则');
    expect(ADMIN_COPY.userEditBlocked('banned')).toContain('用户已封禁');
    expect(ADMIN_COPY.userEditBlocked(null)).toContain('unknown');
    expect(policyReasonLabel('closed')).toBe('会话已关闭');
    expect(policyReasonLabel('unknown_reason')).toBe('unknown_reason');
  });

  it('编辑通知对超长内容截断，避免超过 Telegram 消息上限', () => {
    const longText = '长'.repeat(4000);
    const notice = ADMIN_COPY.userEditedMessage(longText, longText);
    expect(notice.length).toBeLessThan(4096);
    expect(notice).toContain('…');
    expect(truncateText('短文本')).toBe('短文本');
    expect(truncateText(longText).length).toBe(EDIT_SNIPPET_LIMIT + 1);
    expect(truncateText(undefined)).toBe('');
    expect(truncateText(null)).toBe('');
  });

  it('管理状态操作反馈与回调 toast 文案齐全', () => {
    expect(ADMIN_COPY.mutedInGroup).toContain('已静音');
    expect(ADMIN_COPY.unmutedInGroup).toContain('已取消静音');
    expect(ADMIN_COPY.conversationClosedInGroup).toContain('已强制关闭');
    expect(ADMIN_COPY.conversationOpenedInGroup).toContain('已恢复');
    expect(ADMIN_COPY.bannedInGroup).toContain('已封禁');
    expect(ADMIN_COPY.unbannedInGroup).toContain('已解封');
    expect(ADMIN_COPY.trusted).toContain('永久信任');
    expect(ADMIN_COPY.verificationReset).toContain('验证重置');
    expect(ADMIN_COPY.noteSaved('x')).toContain('备注已保存');
    expect(ADMIN_COPY.noteView('x')).toContain('当前备注');
    expect(ADMIN_COPY.noteCleared).toContain('已清除');
    expect(ADMIN_COPY.banNotifyFailed('err')).toContain('通知用户失败');
    expect(ADMIN_COPY.cbNoPermission).toBe('无权限');
    expect(ADMIN_COPY.cbUpdated).toBe('已更新');
    expect(ADMIN_COPY.cbCancelled).toBe('已取消');
    expect(ADMIN_COPY.cbOperationFailed).toBe('操作失败，请重试');
    expect(ADMIN_COPY.kvNotBoundNotes).toContain('KV 未绑定');
    expect(ADMIN_COPY.d1NotBoundFind).toContain('D1 未绑定');
    expect(ADMIN_COPY.searchFailed('boom')).toContain('boom');
    expect(ADMIN_COPY.adminMenuTitle).toBe('管理后台');
    expect(ADMIN_COPY.cbInvalidOperation).toBe('无效操作');
    expect(ADMIN_COPY.userNotFound).toBe('用户不存在');
    expect(ADMIN_COPY.callbackBusy('ban')).toBe('正在封禁…');
    expect(ADMIN_COPY.callbackBusy('closeok')).toBe('正在关闭…');
    expect(ADMIN_COPY.callbackBusy('reset')).toBe('正在重置…');
    expect(ADMIN_COPY.callbackBusy('mute')).toBe('处理中…');
    expect(ADMIN_COPY.processed).toBe('已处理');
    expect(ADMIN_COPY.backendConnected).toBe('后台连接正常');
    expect(ADMIN_COPY.permissionExpired).toBe('权限已失效');
    // 清理流程统一 HTML，无 Markdown 星号/反引号
    expect(ADMIN_COPY.cleanupBusy).toContain('<b>');
    expect(ADMIN_COPY.cleanupScanning).toContain('<b>');
    expect(ADMIN_COPY.cleanupFailed('x')).toContain('<code>');
    expect(`${ADMIN_COPY.cleanupBusy}${ADMIN_COPY.cleanupScanning}${ADMIN_COPY.cleanupFailed('x')}`).not.toMatch(/\*\*|`/);
  });
});
