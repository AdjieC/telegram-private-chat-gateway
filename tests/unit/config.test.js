import { describe, it, expect } from 'vitest';
import {
  assertD1Binding,
  formatEnvPresenceDetail,
  inspectEnvPresence,
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

  it('inspectEnvPresence 只报告是否存在且不暴露真实值', () => {
    const report = inspectEnvPresence({
      BOT_TOKEN: 'secret-token',
      SUPERGROUP_ID: '',
      TOPIC_MAP: { get() {} },
      WEBHOOK_SECRET: 'x'.repeat(32),
    });

    expect(report.presence.BOT_TOKEN).toBe(true);
    expect(report.presence.SUPERGROUP_ID).toBe(false);
    expect(report.presence.TOPIC_MAP).toBe(true);
    expect(report.presence.WEBHOOK_SECRET).toBe(true);
    expect(JSON.stringify(report)).not.toContain('secret-token');
    const detail = formatEnvPresenceDetail({
      BOT_TOKEN: 'secret-token',
      SUPERGROUP_ID: '',
    });
    expect(detail).toMatch(/missing=[^|]*SUPERGROUP_ID/);
    expect(detail).toContain('present=BOT_TOKEN');
  });

  it('assertD1Binding 拒绝字符串伪绑定', () => {
    expect(() => assertD1Binding('3bd53c36-3b0f-44c9-a3ba-5b9238e65f6f')).toThrow(/string variable/);
    expect(() => assertD1Binding({})).toThrow(/prepare/);
    expect(() => assertD1Binding({ prepare() {} })).not.toThrow();
  });

  it('容忍 Dashboard 变量名首尾空格并规范化到标准键', () => {
    const env = normalizeEnv({
      ' SUPERGROUP_ID': '-1004483872571',
      ' SPAM_KEYWORDS': 'a,b',
      BOT_TOKEN: 'token',
      WEBHOOK_SECRET: 'x'.repeat(32),
      TOPIC_MAP: { get() {} },
    });

    expect(env.SUPERGROUP_ID).toBe('-1004483872571');
    expect(env.SPAM_KEYWORDS).toBe('a,b');
    expect(() => validateBaseEnv(env)).not.toThrow();

    const report = inspectEnvPresence({
      ' SUPERGROUP_ID': '-1004483872571',
      ' TURNSTILE_SITE_KEY': 'site',
    });
    expect(report.presence.SUPERGROUP_ID).toBe(true);
    expect(report.mistypedKeys).toEqual(
      expect.arrayContaining([' SUPERGROUP_ID', ' TURNSTILE_SITE_KEY']),
    );
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
