import { describe, it, expect, vi, afterEach } from 'vitest';
import { secureRandomId } from '../../src/utils.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('secureRandomId（加密随机 ID）', () => {
  it('默认长度 12 且仅含小写字母数字', () => {
    const id = secureRandomId();
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[a-z0-9]{12}$/);
  });

  it('支持自定义长度', () => {
    expect(secureRandomId(20)).toHaveLength(20);
    expect(secureRandomId(1)).toHaveLength(1);
  });

  it('拒绝采样：超出均匀区间的字节被丢弃重采，消除取模偏差', () => {
    // 36 字符集 → limit = floor(256/36)*36 = 252；字节 252..255 应被拒绝
    const queue = [35, 252, 1, 0]; // 35→'9'，252 拒绝，1→'b'，0→'a'
    vi.stubGlobal('crypto', {
      getRandomValues: (arr) => {
        for (let i = 0; i < arr.length; i += 1) arr[i] = queue.shift() ?? 0;
        return arr;
      },
    });
    // 长度 3：需要 4 次采样（第 2 次被拒绝），结果为 '9ba'
    expect(secureRandomId(3)).toBe('9ba');
    // 队列已消费 4 个字节，证明 252 确实被跳过
    expect(queue).toHaveLength(0);
  });

  it('多次采样结果仍落在字符集内（回归：无越界访问）', () => {
    const id = secureRandomId(64);
    expect(id).toMatch(/^[a-z0-9]{64}$/);
  });
});
