import { describe, it, expect } from 'vitest';
import {
  isPlaceholderTopicTitle,
  isAdminCommandText,
  formatUserName,
  commandArgument,
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

describe('isAdminCommandText（管理命令清单）', () => {
  it('识别带参与带 @bot 后缀的管理命令', () => {
    expect(isAdminCommandText('/menu')).toBe(true);
    expect(isAdminCommandText('/find 张三')).toBe(true);
    expect(isAdminCommandText('/menu@bot')).toBe(true);
    expect(isAdminCommandText('/synccommands')).toBe(true);
  });

  it('不误判普通消息与未知命令', () => {
    expect(isAdminCommandText('你好')).toBe(false);
    expect(isAdminCommandText('/randomcmd')).toBe(false);
    expect(isAdminCommandText('')).toBe(false);
    expect(isAdminCommandText(null)).toBe(false);
  });
});

describe('formatUserName（展示名拼接）', () => {
  it('兼容 Telegram 与 D1 两种字段形态', () => {
    expect(formatUserName({ first_name: '张', last_name: '三' })).toBe('张 三');
    expect(formatUserName({ firstName: '李', lastName: '四' })).toBe('李 四');
  });

  it('缺失字段有兜底且忽略空白', () => {
    expect(formatUserName({})).toBe('未知');
    expect(formatUserName(null)).toBe('未知');
    expect(formatUserName({ first_name: '  ' })).toBe('未知');
    expect(formatUserName({ first_name: '王' })).toBe('王');
    expect(formatUserName({ first_name: '王' }, '未命名')).toBe('王');
  });
});

describe('commandArgument（命令参数提取）', () => {
  it('提取参数并兼容 @bot 后缀与空白', () => {
    expect(commandArgument('/addword 赌博', 'addword')).toBe('赌博');
    expect(commandArgument('/addword@mybot 赌博', 'addword')).toBe('赌博');
    expect(commandArgument('/note   重要客户', 'note')).toBe('重要客户');
    expect(commandArgument('/find 张三', 'find')).toBe('张三');
  });

  it('无参数时返回空字符串', () => {
    expect(commandArgument('/addword', 'addword')).toBe('');
    expect(commandArgument('', 'addword')).toBe('');
    expect(commandArgument('/addword ', 'addword')).toBe('');
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
