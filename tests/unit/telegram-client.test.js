import { describe, it, expect, vi } from 'vitest';
import {
  createTelegramClient,
  TelegramApiError,
} from '../../src/telegram-client.js';
import { telegramResponse } from '../helpers/mock-telegram.js';

function createClient(fetchImpl, overrides = {}) {
  return createTelegramClient({
    botToken: '123:TEST',
    fetchImpl,
    sleep: vi.fn().mockResolvedValue(undefined),
    random: () => 0,
    timeoutMs: 100,
    ...overrides,
  });
}

describe('Telegram Client', () => {
  it('网络错误后最多重试两次并返回成功响应', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network-1'))
      .mockRejectedValueOnce(new Error('network-2'))
      .mockResolvedValue(telegramResponse({ ok: true, result: { message_id: 1 } }));
    const client = createClient(fetchImpl);

    await expect(client.call('sendMessage', { chat_id: 1, text: 'x' }))
      .resolves.toEqual({ ok: true, result: { message_id: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('Telegram 400 不重试并抛出分类错误', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(telegramResponse({
      ok: false,
      error_code: 400,
      description: 'Bad Request: chat not found',
    }, 400));
    const client = createClient(fetchImpl);

    await expect(client.call('sendMessage', {})).rejects.toMatchObject({
      category: 'invalid_request',
      retryable: false,
      status: 400,
      method: 'sendMessage',
      attempts: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Telegram 429 按 retry_after 等待后最多重试一次', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 2 },
      }, 429))
      .mockResolvedValue(telegramResponse({ ok: true, result: true }));
    const client = createClient(fetchImpl, { sleep });

    await expect(client.call('sendMessage', {}))
      .resolves.toEqual({ ok: true, result: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('Telegram 429 缺少 retry_after 时使用五秒默认值', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
      }, 429))
      .mockResolvedValue(telegramResponse({ ok: true, result: true }));
    const client = createClient(fetchImpl, { sleep });

    await client.call('sendMessage', {});

    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('Telegram 5xx 最多重试两次', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => telegramResponse({
      ok: false,
      error_code: 500,
      description: 'Internal Server Error',
    }, 500));
    const client = createClient(fetchImpl);

    await expect(client.call('sendMessage', {})).rejects.toBeInstanceOf(TelegramApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('识别 Topic 不存在错误但不进行网络重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(telegramResponse({
      ok: false,
      error_code: 400,
      description: 'Bad Request: message thread not found',
    }, 400));
    const client = createClient(fetchImpl);

    await expect(client.call('sendMessage', {})).rejects.toMatchObject({
      category: 'topic_missing',
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('非法 JSON 响应分类为 parse_error 且最多重试一次', async () => {
    const invalidResponse = () => new Response('not-json', { status: 502 });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(invalidResponse())
      .mockResolvedValueOnce(invalidResponse());
    const client = createClient(fetchImpl);

    await expect(client.call('sendMessage', {})).rejects.toMatchObject({
      category: 'parse_error',
      attempts: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
