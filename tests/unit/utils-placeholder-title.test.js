import { describe, it, expect } from 'vitest';
import {
  isPlaceholderTopicTitle,
  normalizeRecentErrorItem,
  RECENT_ERROR_ACTION_MAX,
  RECENT_ERROR_TEXT_MAX,
} from '../../src/utils.js';

describe('isPlaceholderTopicTitle（占位话题标题检测）', () => {
  it('空值 / "User" / "User @xxx" 均视为占位', () => {
    expect(isPlaceholderTopicTitle(null)).toBe(true);
    expect(isPlaceholderTopicTitle(undefined)).toBe(true);
    expect(isPlaceholderTopicTitle('')).toBe(true);
    expect(isPlaceholderTopicTitle('   ')).toBe(true);
    expect(isPlaceholderTopicTitle('User')).toBe(true);
    expect(isPlaceholderTopicTitle('User @abc')).toBe(true);
  });

  it('正常标题不被误判', () => {
    expect(isPlaceholderTopicTitle('张三')).toBe(false);
    expect(isPlaceholderTopicTitle('UserX')).toBe(false);
    expect(isPlaceholderTopicTitle('User x')).toBe(false);
    expect(isPlaceholderTopicTitle('用户 @abc')).toBe(false);
  });

  it('worker 与 admin-actions 的旧规则语义合并后一致', () => {
    // worker 旧规则：=== 'User'（大小写敏感）或 /^User @/i
    // admin-actions 旧规则：=== 'User' 或 /^User(\s@|$)/i
    // 合并语义：空 / 'User' / 'User @x'；'User' 精确匹配大小写敏感，'User @x' 不区分大小写
    expect(isPlaceholderTopicTitle('user')).toBe(false);
    expect(isPlaceholderTopicTitle('USER')).toBe(false);
    expect(isPlaceholderTopicTitle('USER @abc')).toBe(true);
  });
});

describe('normalizeRecentErrorItem（系统错误条目归一化）', () => {
  it('截断超长字段并保留关联 ID', () => {
    const item = normalizeRecentErrorItem({
      ts: 1234,
      action: 'a'.repeat(RECENT_ERROR_ACTION_MAX + 50),
      error: 'e'.repeat(RECENT_ERROR_TEXT_MAX + 100),
      userId: 'u'.repeat(300),
      updateId: 999,
      correlationId: undefined,
    });
    expect(item.ts).toBe(1234);
    expect(item.action.length).toBe(RECENT_ERROR_ACTION_MAX);
    expect(item.error.length).toBe(RECENT_ERROR_TEXT_MAX);
    expect(item.userId.length).toBe(120);
    expect(item.updateId).toBe('999');
    expect(item.correlationId).toBeUndefined();
  });

  it('非对象输入返回 null，缺失字段有兜底', () => {
    expect(normalizeRecentErrorItem(null)).toBe(null);
    expect(normalizeRecentErrorItem('x')).toBe(null);
    const fallback = normalizeRecentErrorItem({ ts: 'bad', action: 42 });
    expect(fallback.ts).toBe(0);
    expect(fallback.action).toBe('42');
    expect(fallback.error).toBe('');
  });
});
