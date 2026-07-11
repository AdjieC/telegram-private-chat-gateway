import { describe, it, expect } from 'vitest';
import { USER_COPY, ADMIN_COPY } from '../../src/user-copy.js';

describe('user-copy', () => {
  it('用户侧拦截/限流文案齐全', () => {
    expect(USER_COPY.rateLimited).toMatch(/频繁/);
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
    const fwd = ADMIN_COPY.forwardTotalFail('1', '2', 'a', 'b');
    expect(fwd).toMatch(/转发完全失败/);
    expect(ADMIN_COPY.wordUsageAdd).toMatch(/addword/);
  });
});
