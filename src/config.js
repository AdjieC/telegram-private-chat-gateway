/**
 * 规范化 Worker 环境变量，避免业务代码重复处理绑定值类型。
 */
export function normalizeEnv(env = {}) {
  return {
    ...env,
    BOT_TOKEN: String(env.BOT_TOKEN ?? ''),
    SUPERGROUP_ID: String(env.SUPERGROUP_ID ?? ''),
    WEBHOOK_SECRET: String(env.WEBHOOK_SECRET ?? ''),
  };
}

/**
 * 校验 Telegram 业务端点依赖的基础绑定。
 */
export function validateBaseEnv(env) {
  if (!env.TOPIC_MAP) throw new Error("KV 'TOPIC_MAP' not bound");
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN not set');
  if (!env.SUPERGROUP_ID) throw new Error('SUPERGROUP_ID not set');
  if (!env.SUPERGROUP_ID.startsWith('-100')) {
    throw new Error('SUPERGROUP_ID must start with -100');
  }
}

/**
 * 校验 Telegram Webhook 请求额外需要的安全配置。
 */
export function validateWebhookEnv(env) {
  if (!env.WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET not set');
  if (new TextEncoder().encode(env.WEBHOOK_SECRET).length < 32) {
    throw new Error('WEBHOOK_SECRET must be at least 32 bytes');
  }
}
