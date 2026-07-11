import { describe, expect, it } from 'vitest';
import {
  evaluateMessagePolicy,
  matchRule,
  validateRuleInput,
} from '../../src/message-policy.js';

const verifiedUser = {
  user: { status: 'active', trustLevel: 'normal' },
  verification: { type: 'temporary' },
};

describe('消息策略', () => {
  it('Caption 与文本使用相同屏蔽规则', () => {
    const result = evaluateMessagePolicy({
      message: { caption: '加微信联系' },
      ...verifiedUser,
      rules: [{
        ruleId: 'r1',
        ruleType: 'blocked_keyword',
        matchType: 'contains',
        pattern: '加微信',
        action: 'count_violation',
      }],
      now: 1000,
    });

    expect(result).toMatchObject({
      action: 'reject',
      reason: 'blocked_keyword',
      matchedRuleId: 'r1',
      shouldForward: false,
      shouldIncrementViolation: true,
    });
  });

  it('编辑后的 Caption 复用相同策略', () => {
    const result = evaluateMessagePolicy({
      message: { caption: '修改后包含广告', edit_date: 1000 },
      ...verifiedUser,
      rules: [{
        ruleId: 'r1',
        ruleType: 'blocked_keyword',
        matchType: 'contains',
        pattern: '广告',
        action: 'reject',
      }],
    });

    expect(result.action).toBe('reject');
  });

  it('按优先级升序执行并在首条命中后停止', () => {
    const result = evaluateMessagePolicy({
      message: { text: 'hello world' },
      ...verifiedUser,
      rules: [
        {
          ruleId: 'later',
          ruleType: 'auto_reply',
          matchType: 'contains',
          pattern: 'hello',
          responseText: 'later',
          action: 'reply_only',
          priority: 200,
        },
        {
          ruleId: 'first',
          ruleType: 'auto_reply',
          matchType: 'contains',
          pattern: 'hello',
          responseText: 'first',
          action: 'reply_and_forward',
          priority: 10,
        },
      ],
    });

    expect(result).toMatchObject({
      action: 'allow',
      matchedRuleId: 'first',
      autoReply: 'first',
      shouldForward: true,
    });
  });

  it('未验证普通用户需要验证，永久信任用户可直接通过', () => {
    expect(evaluateMessagePolicy({
      message: { text: 'hello' },
      user: { status: 'active', trustLevel: 'normal' },
      verification: null,
      rules: [],
    }).action).toBe('require_verification');

    expect(evaluateMessagePolicy({
      message: { text: 'hello' },
      user: { status: 'active', trustLevel: 'trusted' },
      verification: null,
      rules: [],
    }).action).toBe('allow');
  });

  it('封禁和关闭状态在规则匹配前拒绝消息', () => {
    expect(evaluateMessagePolicy({
      message: { text: 'hello' },
      user: { status: 'banned' },
      verification: { type: 'temporary' },
      rules: [],
    })).toMatchObject({ action: 'silent_reject', reason: 'banned' });

    expect(evaluateMessagePolicy({
      message: { text: 'hello' },
      user: { status: 'closed' },
      verification: { type: 'temporary' },
      rules: [],
    })).toMatchObject({ action: 'reject', reason: 'closed' });
  });
});

describe('规则匹配', () => {
  it('contains 与 equals 使用去首尾空格和大小写归一化', () => {
    expect(matchRule('  Hello World  ', {
      matchType: 'contains',
      pattern: 'hello',
    })).toBe(true);
    expect(matchRule('  Hello World  ', {
      matchType: 'equals',
      pattern: 'hello world',
    })).toBe(true);
  });

  it('regex 仅在安全验证后匹配', () => {
    expect(matchRule('订单 A-123', {
      matchType: 'regex',
      pattern: '^订单\\s+[A-Z]-\\d+$',
    })).toBe(true);
  });

  it('自动回复 reply_only 不继续转发', () => {
    const result = evaluateMessagePolicy({
      message: { text: '工作时间' },
      ...verifiedUser,
      rules: [{
        ruleId: 'reply',
        ruleType: 'auto_reply',
        matchType: 'equals',
        pattern: '工作时间',
        responseText: '周一至周五',
        action: 'reply_only',
      }],
    });

    expect(result).toMatchObject({
      action: 'auto_reply_only',
      autoReply: '周一至周五',
      shouldForward: false,
    });
  });
});

describe('规则安全验证', () => {
  it('限制匹配表达式和回复文本长度', () => {
    expect(() => validateRuleInput({
      matchType: 'contains',
      pattern: 'a'.repeat(201),
    })).toThrow('pattern must not exceed 200 characters');
    expect(() => validateRuleInput({
      matchType: 'contains',
      pattern: 'a',
      responseText: 'x'.repeat(4001),
    })).toThrow('responseText must not exceed 4000 characters');
  });

  it('拒绝可匹配空字符串的正则', () => {
    expect(() => validateRuleInput({
      matchType: 'regex',
      pattern: 'a*',
    })).toThrow('regex must not match empty text');
  });

  it('拒绝明显灾难性回溯结构', () => {
    expect(() => validateRuleInput({
      matchType: 'regex',
      pattern: '(a+)+$',
    })).toThrow('regex contains unsafe nested quantifiers');
  });

  it('拒绝量词组内存在前缀重叠的分支', () => {
    expect(() => validateRuleInput({
      matchType: 'regex',
      pattern: '(a|aa)+$',
    })).toThrow('regex contains unsafe overlapping alternatives');
  });

  it('拒绝可选量词嵌套和未知动作', () => {
    expect(() => validateRuleInput({
      ruleType: 'blocked_keyword', matchType: 'regex', pattern: '(a?)+$', action: 'reject',
    })).toThrow('regex contains unsafe nested quantifiers');
    expect(() => validateRuleInput({
      ruleType: 'auto_reply', matchType: 'contains', pattern: 'x',
      responseText: 'y', action: 'execute_code',
    })).toThrow('unsupported action');
  });

  it('自动回复动作需要回复文本', () => {
    expect(() => validateRuleInput({
      ruleType: 'auto_reply', matchType: 'contains', pattern: 'hello', action: 'reply_only',
    })).toThrow('responseText is required');
  });
});
