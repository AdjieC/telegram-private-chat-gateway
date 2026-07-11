import { describe, it, expect } from 'vitest';
import {
  normalizeTgDescription,
  isTopicMissingOrDeleted,
  isTestMessageInvalid,
  withMessageThreadId,
  generateVerifyCode,
} from '../../src/utils.js';

describe('normalizeTgDescription', () => {
  it('应将描述转为小写', () => {
    expect(normalizeTgDescription('Bad Request')).toBe('bad request');
  });

  it('空字符串应返回空字符串', () => {
    expect(normalizeTgDescription('')).toBe('');
  });

  it('null 应返回空字符串', () => {
    expect(normalizeTgDescription(null)).toBe('');
  });

  it('undefined 应返回空字符串', () => {
    expect(normalizeTgDescription(undefined)).toBe('');
  });

  it('数字应转为字符串', () => {
    expect(normalizeTgDescription(404)).toBe('404');
  });
});

describe('isTopicMissingOrDeleted', () => {
  it('应识别 "thread not found"', () => {
    expect(isTopicMissingOrDeleted('Bad Request: message thread not found')).toBe(true);
  });

  it('应识别 "topic not found"', () => {
    expect(isTopicMissingOrDeleted('Bad Request: topic not found')).toBe(true);
  });

  it('应识别 "topic deleted"', () => {
    expect(isTopicMissingOrDeleted('Forbidden: topic deleted')).toBe(true);
  });

  it('应识别 "forum topic not found"', () => {
    expect(isTopicMissingOrDeleted('Bad Request: forum topic not found')).toBe(true);
  });

  it('应识别 "topic closed permanently"', () => {
    expect(isTopicMissingOrDeleted('Bad Request: topic closed permanently')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isTopicMissingOrDeleted('THREAD NOT FOUND')).toBe(true);
  });

  it('正常描述应返回 false', () => {
    expect(isTopicMissingOrDeleted('Bad Request: chat not found')).toBe(false);
  });

  it('空字符串应返回 false', () => {
    expect(isTopicMissingOrDeleted('')).toBe(false);
  });
});

describe('isTestMessageInvalid', () => {
  it('应识别 "message text is empty"', () => {
    expect(isTestMessageInvalid('Bad Request: message text is empty')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isTestMessageInvalid('MESSAGE TEXT IS EMPTY')).toBe(true);
  });

  it('非空消息应返回 false', () => {
    expect(isTestMessageInvalid('OK')).toBe(false);
  });
});

describe('withMessageThreadId', () => {
  it('应添加 threadId 到 body', () => {
    const body = { chat_id: 123, text: 'hello' };
    const result = withMessageThreadId(body, 42);
    expect(result).toEqual({ chat_id: 123, text: 'hello', message_thread_id: 42 });
  });

  it('threadId 为 null 时不添加', () => {
    const body = { chat_id: 123 };
    const result = withMessageThreadId(body, null);
    expect(result).toEqual({ chat_id: 123 });
    expect(result.message_thread_id).toBeUndefined();
  });

  it('threadId 为 undefined 时不添加', () => {
    const body = { chat_id: 123 };
    const result = withMessageThreadId(body, undefined);
    expect(result).toEqual({ chat_id: 123 });
    expect(result.message_thread_id).toBeUndefined();
  });

  it('threadId 为 0 时应添加（falsy 但非 null/undefined）', () => {
    const body = { chat_id: 123 };
    const result = withMessageThreadId(body, 0);
    expect(result.message_thread_id).toBe(0);
  });

  it('不应修改原 body 对象（不可变性）', () => {
    const body = { chat_id: 123 };
    withMessageThreadId(body, 42);
    expect(body.message_thread_id).toBeUndefined();
  });
});

describe('generateVerifyCode', () => {
  it('应生成 32 位十六进制字符串（16 字节）', () => {
    const code = generateVerifyCode();
    expect(code).toMatch(/^[0-9a-f]{32}$/);
  });

  it('每次调用应生成不同 code', () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
      codes.add(generateVerifyCode());
    }
    // 100 次生成应全部唯一
    expect(codes.size).toBe(100);
  });
});
