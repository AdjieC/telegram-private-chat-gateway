import { describe, it, expect } from 'vitest';
import { parseSpamKeywords } from '../../src/utils.js';

describe('parseSpamKeywords', () => {
  describe('分隔符解析', () => {
    it('应解析逗号分隔的关键词', () => {
      const result = parseSpamKeywords('发票,套现,赌博');
      expect(result).toEqual(['发票', '套现', '赌博']);
    });

    it('应解析中文逗号分隔', () => {
      const result = parseSpamKeywords('发票，套现，赌博');
      expect(result).toEqual(['发票', '套现', '赌博']);
    });

    it('应解析分号分隔', () => {
      const result = parseSpamKeywords('发票;套现;赌博');
      expect(result).toEqual(['发票', '套现', '赌博']);
    });

    it('应解析中文分号分隔', () => {
      const result = parseSpamKeywords('发票；套现；赌博');
      expect(result).toEqual(['发票', '套现', '赌博']);
    });

    it('应解析换行分隔', () => {
      const result = parseSpamKeywords('发票\n套现\n赌博');
      expect(result).toEqual(['发票', '套现', '赌博']);
    });

    it('应支持混合分隔符', () => {
      const result = parseSpamKeywords('发票,套现；赌博\n刷单');
      expect(result).toEqual(['发票', '套现', '赌博', '刷单']);
    });
  });

  describe('大小写处理', () => {
    it('应将英文关键词转为小写', () => {
      const result = parseSpamKeywords('Viagra,CASINO');
      expect(result).toEqual(['viagra', 'casino']);
    });
  });

  describe('空格处理', () => {
    it('应去除首尾空格', () => {
      const result = parseSpamKeywords('  发票  ,  套现  ');
      expect(result).toEqual(['发票', '套现']);
    });

    it('应过滤空字符串（连续分隔符产生的空项）', () => {
      const result = parseSpamKeywords('发票,,套现');
      expect(result).toEqual(['发票', '套现']);
    });
  });

  describe('边界条件', () => {
    it('空字符串应返回空数组', () => {
      expect(parseSpamKeywords('')).toEqual([]);
    });

    it('null 应返回空数组', () => {
      expect(parseSpamKeywords(null)).toEqual([]);
    });

    it('undefined 应返回空数组', () => {
      expect(parseSpamKeywords(undefined)).toEqual([]);
    });

    it('纯空格应返回空数组', () => {
      expect(parseSpamKeywords('   ')).toEqual([]);
    });

    it('仅分隔符应返回空数组', () => {
      expect(parseSpamKeywords(',;;，')).toEqual([]);
    });

    it('单个关键词应正常解析', () => {
      expect(parseSpamKeywords('发票')).toEqual(['发票']);
    });

    it('数字输入应转为字符串处理', () => {
      expect(parseSpamKeywords(123)).toEqual(['123']);
    });
  });
});
