import { describe, it, expect } from 'vitest';
import { containsBlockedWord } from '../../src/utils.js';

// 与 worker.js 中 BLOCKED_WORDS 保持一致
const BLOCKED_WORDS = ['赌博', '色情', '代开发', '加微信'];

describe('containsBlockedWord', () => {
  describe('基础命中', () => {
    it('应检测到硬编码屏蔽词「赌博」', () => {
      const result = containsBlockedWord('网络赌博平台', BLOCKED_WORDS);
      expect(result.hit).toBe(true);
      expect(result.word).toBe('赌博');
    });

    it('应检测到硬编码屏蔽词「色情」', () => {
      const result = containsBlockedWord('色情内容', BLOCKED_WORDS);
      expect(result.hit).toBe(true);
      expect(result.word).toBe('色情');
    });

    it('应检测到硬编码屏蔽词「代开发」', () => {
      const result = containsBlockedWord('代开发票', BLOCKED_WORDS);
      expect(result.hit).toBe(true);
      expect(result.word).toBe('代开发');
    });

    it('应检测到硬编码屏蔽词「加微信」', () => {
      const result = containsBlockedWord('加微信联系', BLOCKED_WORDS);
      expect(result.hit).toBe(true);
      expect(result.word).toBe('加微信');
    });
  });

  describe('大小写不敏感', () => {
    it('应忽略大小写命中屏蔽词', () => {
      const resultEn = containsBlockedWord('FREE ViAgra NOW', ['viagra']);
      expect(resultEn.hit).toBe(true);
      expect(resultEn.word).toBe('viagra');
    });
  });

  describe('边界条件', () => {
    it('空文本应返回未命中', () => {
      expect(containsBlockedWord('', ['赌博'])).toEqual({ hit: false, word: null });
    });

    it('null 文本应返回未命中', () => {
      expect(containsBlockedWord(null, ['赌博'])).toEqual({ hit: false, word: null });
    });

    it('undefined 文本应返回未命中', () => {
      expect(containsBlockedWord(undefined, ['赌博'])).toEqual({ hit: false, word: null });
    });

    it('空屏蔽词列表应返回未命中', () => {
      expect(containsBlockedWord('任何内容', [])).toEqual({ hit: false, word: null });
    });

    it('null 屏蔽词列表应返回未命中', () => {
      expect(containsBlockedWord('任何内容', null)).toEqual({ hit: false, word: null });
    });

    it('无屏蔽词的文本应返回未命中', () => {
      expect(containsBlockedWord('你好世界', BLOCKED_WORDS)).toEqual({ hit: false, word: null });
    });

    it('屏蔽词列表中含空字符串应跳过', () => {
      const result = containsBlockedWord('你好', ['', '赌博']);
      expect(result.hit).toBe(false);
      expect(result.word).toBe(null);
    });
  });

  describe('多词匹配', () => {
    it('多个屏蔽词同时存在时应返回第一个命中', () => {
      const result = containsBlockedWord('赌博和色情内容', ['赌博', '色情']);
      expect(result.hit).toBe(true);
      expect(result.word).toBe('赌博');
    });

    it('自定义屏蔽词列表应正常工作', () => {
      const customWords = ['广告', '推广', '刷单'];
      const result = containsBlockedWord('专业刷单平台', customWords);
      expect(result.hit).toBe(true);
      expect(result.word).toBe('刷单');
    });
  });
});
