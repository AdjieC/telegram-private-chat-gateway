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
});
