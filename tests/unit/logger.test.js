import { describe, it, expect, vi } from 'vitest';
import { createLogger, redactLogData, safeStringify } from '../../src/logger.js';

describe('logger', () => {
  it('脱敏凭据和完整消息内容', () => {
    expect(redactLogData({
      BOT_TOKEN: 'secret',
      webhookSecret: 'secret-2',
      verifyCode: 'challenge-code',
      verifyId: 'challenge-id',
      text: 'private message',
      updateId: 123,
    })).toEqual({
      BOT_TOKEN: '[REDACTED]',
      webhookSecret: '[REDACTED]',
      verifyCode: '[REDACTED]',
      verifyId: '[REDACTED]',
      text: '[REDACTED]',
      updateId: 123,
    });
  });

  it('结构化日志合并基础上下文并在输出前脱敏', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const logger = createLogger({ requestId: 'req-1' }, sink);

    logger.info('message_received', { text: 'private', updateId: 7 });

    expect(sink.info).toHaveBeenCalledOnce();
    const log = JSON.parse(sink.info.mock.calls[0][0]);
    expect(log).toMatchObject({
      level: 'INFO',
      action: 'message_received',
      requestId: 'req-1',
      text: '[REDACTED]',
      updateId: 7,
    });
  });

  it('递归脱敏嵌套对象和数组中的消息内容', () => {
    expect(redactLogData({
      update: {
        message: {
          text: 'private',
          media: [{ caption: 'secret caption', fileId: 'file-1' }],
        },
      },
    })).toEqual({
      update: {
        message: {
          text: '[REDACTED]',
          media: [{ caption: '[REDACTED]', fileId: 'file-1' }],
        },
      },
    });
  });

  it('大小写不同的敏感字段同样脱敏，不误伤普通诊断字段', () => {
    const redacted = redactLogData({
      Text: 'private',
      CAPTION: 'secret caption',
      VerifyID: 'challenge-id',
      error: 'diagnostic error',
      stack: 'diagnostic stack',
    });

    expect(redacted).toEqual({
      Text: '[REDACTED]',
      CAPTION: '[REDACTED]',
      VerifyID: '[REDACTED]',
      error: 'diagnostic error',
      stack: 'diagnostic stack',
    });
  });

  it('onError 旁路收到错误且不影响主流程', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const onError = vi.fn();
    const logger = createLogger({}, sink, { onError });

    const error = new Error('boom');
    logger.error('action_failed', error, { userId: 7 });

    expect(sink.error).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('action_failed', error, { userId: 7 });
    const log = JSON.parse(sink.error.mock.calls[0][0]);
    expect(log).toMatchObject({
      level: 'ERROR',
      action: 'action_failed',
      error: 'boom',
    });
    expect(log.stack).toContain('Error: boom');
  });

  it('onError 抛错时不影响日志输出', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const logger = createLogger({}, sink, {
      onError: () => { throw new Error('onError boom'); },
    });

    expect(() => logger.error('x', new Error('y'))).not.toThrow();
    expect(sink.error).toHaveBeenCalledOnce();
  });

  it('日志含 BigInt 时不抛异常且不丢失输出', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const logger = createLogger({}, sink);
    expect(() => logger.info('bigint_event', { value: 9007199254740993n })).not.toThrow();
    const raw = sink.info.mock.calls[0][0];
    // safeStringify 兜底后至少输出一条可解析/可读的记录
    expect(typeof raw).toBe('string');
    expect(raw.length).toBeGreaterThan(0);
  });

  it('error 归一化：非 Error 值也能安全记录', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const logger = createLogger({}, sink);

    logger.error('string_error', '直接失败原因');
    expect(JSON.parse(sink.error.mock.calls[0][0]).error).toBe('直接失败原因');

    logger.error('object_error', { message: '对象内 message' });
    expect(JSON.parse(sink.error.mock.calls[1][0]).error).toBe('对象内 message');

    expect(() => logger.error('undefined_error', undefined)).not.toThrow();
    expect(JSON.parse(sink.error.mock.calls[2][0]).error).toBe('unknown');
  });

  it('sink 不完整或抛错时日志路径不拖垮业务', () => {
    const throwingSink = { error: () => { throw new Error('sink boom'); } };
    const logger = createLogger({}, throwingSink);
    expect(() => logger.error('x', new Error('y'))).not.toThrow();

    const noMethodSink = {};
    const logger2 = createLogger({}, noMethodSink);
    expect(() => logger2.info('x', { a: 1 })).not.toThrow();
  });

  it('safeStringify 对不可序列化值兜底', () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
    const circular = {};
    circular.self = circular;
    expect(safeStringify(circular)).toMatch(/Circular|Unserializable|\[/);
  });

  it('超长日志截断到长度上限并保留可读标记，正常日志不截断', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const logger = createLogger({}, sink);

    logger.info('big_payload', { payload: 'x'.repeat(100000) });
    const big = sink.info.mock.calls[0][0];
    expect(big.length).toBeLessThan(40 * 1024);
    expect(big.endsWith('…[truncated]')).toBe(true);

    logger.info('small', { a: 1 });
    const small = sink.info.mock.calls[1][0];
    expect(small).toContain('"a":1');
    expect(small).not.toContain('truncated');
  });
});
