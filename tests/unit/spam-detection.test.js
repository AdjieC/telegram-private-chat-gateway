import { describe, it, expect } from 'vitest';
import { buildSpamCheckText, containsLink, detectSpamKeywords, computeMessageHash } from '../../src/utils.js';

// 重置 spamKeywordsCache 的辅助方法：通过重新导入模块无法实现，
// 但 detectSpamKeywords 是直接传参的纯函数，不依赖全局缓存。

describe('detectSpamKeywords', () => {
  describe('关键词命中', () => {
    it('应检测到单个关键词', () => {
      const result = detectSpamKeywords('低价发票代开', ['发票', '套现']);
      expect(result.isSpam).toBe(true);
      expect(result.matchedWord).toBe('发票');
    });

    it('应返回第一个命中的关键词', () => {
      const result = detectSpamKeywords('信用卡套现服务', ['套现', '信用卡']);
      expect(result.isSpam).toBe(true);
      expect(result.matchedWord).toBe('套现');
    });

    it('大小写不敏感检测', () => {
      const result = detectSpamKeywords('FREE VIAGRA', ['viagra']);
      expect(result.isSpam).toBe(true);
      expect(result.matchedWord).toBe('viagra');
    });

    it('部分匹配（子串）应命中', () => {
      const result = detectSpamKeywords('专业代开发票服务', ['发票']);
      expect(result.isSpam).toBe(true);
    });
  });

  describe('未命中场景', () => {
    it('无关键词文本应返回非垃圾', () => {
      const result = detectSpamKeywords('你好世界', ['发票', '套现']);
      expect(result.isSpam).toBe(false);
      expect(result.matchedWord).toBe(null);
    });

    it('空关键词列表应返回非垃圾', () => {
      const result = detectSpamKeywords('任何内容', []);
      expect(result.isSpam).toBe(false);
      expect(result.matchedWord).toBe(null);
    });

    it('空文本应返回非垃圾', () => {
      const result = detectSpamKeywords('', ['发票']);
      expect(result.isSpam).toBe(false);
      expect(result.matchedWord).toBe(null);
    });

    it('null 文本应返回非垃圾', () => {
      const result = detectSpamKeywords(null, ['发票']);
      expect(result.isSpam).toBe(false);
      expect(result.matchedWord).toBe(null);
    });
  });
});

describe('computeMessageHash', () => {
  describe('一致性', () => {
    it('相同消息应产生相同哈希', () => {
      const msg = { text: '你好世界' };
      expect(computeMessageHash(msg)).toBe(computeMessageHash(msg));
    });

    it('大小写不同应产生相同哈希（toLowerCase）', () => {
      const msg1 = { text: 'Hello World' };
      const msg2 = { text: 'hello world' };
      expect(computeMessageHash(msg1)).toBe(computeMessageHash(msg2));
    });

    it('首尾空格不影响哈希', () => {
      const msg1 = { text: 'hello' };
      const msg2 = { text: '  hello  ' };
      expect(computeMessageHash(msg1)).toBe(computeMessageHash(msg2));
    });
  });

  describe('区分度', () => {
    it('不同消息应产生不同哈希', () => {
      const msg1 = { text: '你好' };
      const msg2 = { text: '再见' };
      expect(computeMessageHash(msg1)).not.toBe(computeMessageHash(msg2));
    });

    it('caption 和 text 应产生不同哈希', () => {
      const msg1 = { text: 'hello' };
      const msg2 = { caption: 'world' };
      expect(computeMessageHash(msg1)).not.toBe(computeMessageHash(msg2));
    });
  });

  describe('边界条件', () => {
    it('空文本应返回 null', () => {
      expect(computeMessageHash({ text: '' })).toBe(null);
    });

    it('无 text 和 caption 应返回 null', () => {
      expect(computeMessageHash({ photo: 'abc' })).toBe(null);
    });

    it('超长文本应截断处理不报错', () => {
      const longText = 'a'.repeat(10000);
      const hash = computeMessageHash({ text: longText });
      expect(hash).not.toBe(null);
      expect(typeof hash).toBe('string');
    });

    it('caption 应被正确处理', () => {
      const msg = { caption: '图片说明文字' };
      const hash = computeMessageHash(msg);
      expect(hash).not.toBe(null);
      expect(hash).toContain('图片说明文字');
    });
  });
});

describe('buildSpamCheckText', () => {
  it('应把发送者资料纳入垃圾检测文本，捕获显示名里的域名', () => {
    const msg = {
      text: 'This telegram',
      from: {
        first_name: 'SSVP00243',
        last_name: 'Sav$mav.com',
        username: 'Savmavcom',
      },
    };

    const text = buildSpamCheckText(msg);

    expect(text).toContain('This telegram');
    expect(text).toContain('Sav$mav.com');
    expect(containsLink(text)).toBe(true);
  });
});
