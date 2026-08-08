import { describe, it, expect, vi } from 'vitest';
import { createLogger, redactLogData } from '../../src/logger.js';

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
});
