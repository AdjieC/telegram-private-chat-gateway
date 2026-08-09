import { describe, it, expect } from 'vitest';
import { VERIFY_COPY } from '../../src/verify-copy.js';
import { USER_COPY } from '../../src/user-copy.js';

describe('verify-copy', () => {
  it('系统繁忙文案与用户侧口径一致（防两处漂移）', () => {
    expect(VERIFY_COPY.systemError).toBe(USER_COPY.systemBusy);
  });

  it('挑战与成功文案使用统一 HTML 口径', () => {
    expect(VERIFY_COPY.turnstileChallenge).toMatch(/人机验证/);
    expect(VERIFY_COPY.turnstileChallenge).toMatch(/<b>/);
    expect(VERIFY_COPY.quizChallenge('1+1=?')).toContain('1+1=?');
    expect(VERIFY_COPY.successBody).toMatch(/验证成功/);
    expect(VERIFY_COPY.successBodyWithPending).toMatch(/送达/);
  });

  it('失败/过期提示可区分', () => {
    expect(VERIFY_COPY.expired).toMatch(/过期/);
    expect(VERIFY_COPY.wrongAnswer).toMatch(/错误/);
    expect(VERIFY_COPY.wrongAnswerHint).toMatch(/再选/);
    expect(VERIFY_COPY.expired).not.toBe(VERIFY_COPY.wrongAnswer);
  });

  it('验证页错误页文案收拢（缺参/未配置/重发引导）', () => {
    expect(VERIFY_COPY.pageErrorMissingParams.message).toMatch(/缺少必要参数/);
    expect(VERIFY_COPY.pageErrorMissingParams.hintResend).toMatch(/重新发送消息/);
    expect(VERIFY_COPY.pageErrorMissingParams.hintNoSiteKey).toMatch(/本地题库/);
    expect(VERIFY_COPY.pageErrorMissingParams.hintResend)
      .not.toBe(VERIFY_COPY.pageErrorMissingParams.hintNoSiteKey);
  });

  it('验证限流文案按窗口分钟数生成', () => {
    expect(VERIFY_COPY.verifyRateLimited(5)).toContain('5 分钟');
    expect(VERIFY_COPY.verifyRateLimited(5)).toMatch(/频繁/);
    expect(VERIFY_COPY.verifyRateLimited(5)).toContain('约');
  });

  it('自动送达失败提示存在且措辞一致', () => {
    expect(VERIFY_COPY.pendingSendFailed).toMatch(/送达失败/);
    expect(VERIFY_COPY.pendingSendFailed).toMatch(/重新发送/);
  });
});
