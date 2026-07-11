import { describe, it, expect } from 'vitest';
import {
  normalizeEnv,
  validateBaseEnv,
  validateWebhookEnv,
} from '../../src/config.js';

describe('config', () => {
  it('规范化字符串环境变量', () => {
    const env = normalizeEnv({ BOT_TOKEN: 123, SUPERGROUP_ID: -10099 });

    expect(env.BOT_TOKEN).toBe('123');
    expect(env.SUPERGROUP_ID).toBe('-10099');
    expect(env.WEBHOOK_SECRET).toBe('');
  });

  it('基础环境缺少 KV 时抛出明确错误', () => {
    expect(() => validateBaseEnv({
      TOPIC_MAP: undefined,
      BOT_TOKEN: 'token',
      SUPERGROUP_ID: '-10099',
    })).toThrow("KV 'TOPIC_MAP' not bound");
  });

  it('基础环境拒绝无效超级群组 ID', () => {
    expect(() => validateBaseEnv({
      TOPIC_MAP: {},
      BOT_TOKEN: 'token',
      SUPERGROUP_ID: '123',
    })).toThrow('SUPERGROUP_ID must start with -100');
  });

  it('生产 Webhook 缺少 Secret 时拒绝处理', () => {
    expect(() => validateWebhookEnv({ WEBHOOK_SECRET: '' }))
      .toThrow('WEBHOOK_SECRET not set');
  });

  it('生产 Webhook Secret 少于 32 字节时拒绝处理', () => {
    expect(() => validateWebhookEnv({ WEBHOOK_SECRET: '短密钥' }))
      .toThrow('WEBHOOK_SECRET must be at least 32 bytes');
  });
});
