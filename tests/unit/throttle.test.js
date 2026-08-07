import { describe, it, expect } from 'vitest';
import { createThrottle } from '../../src/utils.js';

describe('createThrottle', () => {
  it('窗口内同 key 只放行一次', () => {
    const shouldSend = createThrottle({ windowMs: 60000 });
    expect(shouldSend('alert_a', 1000)).toBe(true);
    expect(shouldSend('alert_a', 2000)).toBe(false);
    expect(shouldSend('alert_a', 60000)).toBe(false);
    expect(shouldSend('alert_a', 61000)).toBe(true);
  });

  it('不同 key 互不影响', () => {
    const shouldSend = createThrottle({ windowMs: 60000 });
    expect(shouldSend('alert_a', 1000)).toBe(true);
    expect(shouldSend('alert_b', 1000)).toBe(true);
    expect(shouldSend('alert_b', 2000)).toBe(false);
    expect(shouldSend('alert_a', 2000)).toBe(false);
  });

  it('默认窗口与 key 字符串化', () => {
    const shouldSend = createThrottle();
    expect(shouldSend(123, 0)).toBe(true);
    expect(shouldSend('123', 1000)).toBe(false);
    expect(shouldSend(123, 59999)).toBe(false);
    expect(shouldSend(123, 60000)).toBe(true);
  });
});
