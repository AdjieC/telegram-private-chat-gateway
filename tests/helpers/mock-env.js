/**
 * Mock 环境变量 — 创建用于测试的 env 对象
 */
import { createMockKV } from './mock-kv.js';
import { createMockD1 } from './mock-d1.js';

export function createMockEnv(overrides = {}) {
  const kv = createMockKV();
  const db = createMockD1();

  return {
    BOT_TOKEN: '123456:TEST_TOKEN',
    SUPERGROUP_ID: '-1001234567890',
    WEBHOOK_SECRET: 'test-webhook-secret-at-least-32-bytes',
    TOPIC_MAP: kv,
    TG_BOT_DB: db,
    TURNSTILE_SITE_KEY: '',
    TURNSTILE_SECRET_KEY: '',
    VERIFICATION_PAGE_URL: '',
    SPAM_KEYWORDS: '',
    ADMIN_IDS: '123456789',
    OWNER_IDS: '123456789',
    ...overrides,
  };
}
