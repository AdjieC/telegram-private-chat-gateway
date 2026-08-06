import { describe, it, expect } from 'vitest';
import { VERIFY_COPY } from '../../src/verify-copy.js';

describe('verify-copy', () => {
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

  it('验证限流文案按窗口分钟数生成', () => {
    expect(VERIFY_COPY.verifyRateLimited(5)).toContain('5分钟');
    expect(VERIFY_COPY.verifyRateLimited(5)).toMatch(/频繁/);
  });

  it('自动送达失败提示存在且措辞一致', () => {
    expect(VERIFY_COPY.pendingSendFailed).toMatch(/送达失败/);
    expect(VERIFY_COPY.pendingSendFailed).toMatch(/重新发送/);
  });
});
