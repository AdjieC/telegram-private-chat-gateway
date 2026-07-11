import { describe, it, expect } from 'vitest';
import { containsLink } from '../../src/utils.js';

describe('containsLink', () => {
  describe('HTTP/HTTPS URL', () => {
    it('应检测到 http:// 链接', () => {
      expect(containsLink('点击 http://example.com 查看')).toBe(true);
    });

    it('应检测到 https:// 链接', () => {
      expect(containsLink('安全链接 https://secure.example.com/path')).toBe(true);
    });

    it('应检测到带端口的 URL', () => {
      expect(containsLink('本地服务 http://localhost:3000')).toBe(true);
    });

    it('应检测到带查询参数的 URL', () => {
      expect(containsLink('搜索 https://www.google.com/search?q=test')).toBe(true);
    });
  });

  describe('域名模式（无协议）', () => {
    it('应检测到裸域名', () => {
      expect(containsLink('访问 example.com')).toBe(true);
    });

    it('应检测到带路径的裸域名', () => {
      expect(containsLink('查看 example.com/page/about')).toBe(true);
    });

    it('应检测到多级域名', () => {
      expect(containsLink('新闻站 news.example.co.uk/story')).toBe(true);
    });

    it('不应将普通标点误判为链接', () => {
      expect(containsLink('你好。今天天气不错')).toBe(false);
    });
  });

  describe('Telegram 链接', () => {
    it('应检测到 t.me 链接', () => {
      expect(containsLink('加入群 t.me/groupname')).toBe(true);
    });

    it('应检测到 telegram.me 链接', () => {
      expect(containsLink('联系 telegram.me/username')).toBe(true);
    });

    it('应检测到 t.me 带参数链接', () => {
      expect(containsLink('分享 https://t.me/addstickers/setname')).toBe(true);
    });
  });

  describe('边界条件', () => {
    it('空文本应返回 false', () => {
      expect(containsLink('')).toBe(false);
    });

    it('null 应返回 false', () => {
      expect(containsLink(null)).toBe(false);
    });

    it('undefined 应返回 false', () => {
      expect(containsLink(undefined)).toBe(false);
    });

    it('纯文本无链接应返回 false', () => {
      expect(containsLink('你好世界，今天天气真好')).toBe(false);
    });

    it('仅包含点号但不是域名应返回 false', () => {
      expect(containsLink('版本 1.2.3 已发布')).toBe(false);
    });
  });

  describe('混合内容', () => {
    it('文本中嵌入链接应检测到', () => {
      expect(containsLink('你好，请关注 https://example.com 获取详情')).toBe(true);
    });

    it('多个链接应检测到', () => {
      expect(containsLink('http://a.com 和 https://b.com')).toBe(true);
    });
  });
});
