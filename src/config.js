/**
 * 运行时需要关注的环境键（用于诊断；不输出真实值）。
 */
export const KNOWN_ENV_KEYS = Object.freeze([
  'BOT_TOKEN',
  'WEBHOOK_SECRET',
  'SUPERGROUP_ID',
  'OWNER_IDS',
  'ADMIN_IDS',
  'SPAM_KEYWORDS',
  'API_BASE',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'VERIFICATION_PAGE_URL',
  'TOPIC_MAP',
  'TG_BOT_DB',
]);

const STRING_ENV_KEYS = Object.freeze([
  'BOT_TOKEN',
  'WEBHOOK_SECRET',
  'SUPERGROUP_ID',
  'OWNER_IDS',
  'ADMIN_IDS',
  'SPAM_KEYWORDS',
  'API_BASE',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'VERIFICATION_PAGE_URL',
]);

/**
 * 枚举 env 自身键名（Cloudflare env 为特殊对象，优先 Object.keys）。
 */
export function listEnvKeys(env = {}) {
  try {
    return Object.keys(env);
  } catch {
    return [];
  }
}

/**
 * 读取环境值：先精确键名，再容忍键名首尾空白（Dashboard 误输入空格时常见）。
 * 不修改原始 env，仅返回匹配到的值。
 */
export function readEnvValue(env, key) {
  if (env == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(env, key) || env[key] !== undefined) {
    const direct = env[key];
    // 精确键存在且非纯空白字符串时优先使用；空字符串则继续尝试 trim 别名
    if (direct !== undefined && direct !== null) {
      if (typeof direct !== 'string' || direct.trim().length > 0) {
        return direct;
      }
    }
  }

  const target = String(key);
  for (const actual of listEnvKeys(env)) {
    if (actual !== key && actual.trim() === target) {
      return env[actual];
    }
  }
  return env[key];
}

/**
 * 规范化 Worker 环境变量，避免业务代码重复处理绑定值类型。
 * 同时把「键名带首尾空格」的 Dashboard 误配置映射回标准键名。
 */
export function normalizeEnv(env = {}) {
  const normalized = { ...env };

  for (const key of STRING_ENV_KEYS) {
    const value = readEnvValue(env, key);
    normalized[key] = value === undefined || value === null ? '' : String(value).trim();
  }

  // 绑定保持对象引用；若仅存在带空格键名则回填标准名
  for (const key of ['TOPIC_MAP', 'TG_BOT_DB']) {
    const value = readEnvValue(env, key);
    if (value !== undefined && value !== null) {
      normalized[key] = value;
    }
  }

  return normalized;
}

/**
 * 描述绑定形态（不返回密钥/ID 明文），用于区分「有同名变量」与「真·D1/KV 绑定」。
 */
export function describeBindingShape(value) {
  if (value === undefined || value === null) {
    return { present: false, jsType: 'nullish' };
  }
  const jsType = typeof value;
  if (jsType === 'string') {
    return {
      present: value.trim().length > 0,
      jsType: 'string',
      // 字符串说明多半是 Text/Secret 变量，不是 D1/KV Binding
      looksLikeBinding: false,
      hasPrepare: false,
      hasGet: false,
      hasPut: false,
    };
  }
  if (jsType !== 'object' && jsType !== 'function') {
    return { present: true, jsType, looksLikeBinding: false };
  }
  return {
    present: true,
    jsType: 'object',
    looksLikeBinding: true,
    hasPrepare: typeof value.prepare === 'function',
    hasBatch: typeof value.batch === 'function',
    hasGet: typeof value.get === 'function',
    hasPut: typeof value.put === 'function',
  };
}

/**
 * 检查已知环境键是否“有值”（不返回真实内容，避免泄露密钥）。
 * - 字符串：非空为 true
 * - 绑定对象（KV/D1）：对象存在即为 true
 * - 会识别键名首尾带空格的误配置
 */
export function inspectEnvPresence(env = {}) {
  const presence = {};
  for (const key of KNOWN_ENV_KEYS) {
    const value = readEnvValue(env, key);
    if (value === undefined || value === null) {
      presence[key] = false;
    } else if (typeof value === 'string') {
      presence[key] = value.trim().length > 0;
    } else {
      presence[key] = true;
    }
  }

  const keys = listEnvKeys(env).sort();
  const mistypedKeys = keys.filter((name) => {
    const trimmed = name.trim();
    return name !== trimmed && KNOWN_ENV_KEYS.includes(trimmed);
  });

  const bindings = {
    TOPIC_MAP: describeBindingShape(readEnvValue(env, 'TOPIC_MAP')),
    TG_BOT_DB: describeBindingShape(readEnvValue(env, 'TG_BOT_DB')),
  };

  return { presence, keys, mistypedKeys, bindings };
}

/**
 * 将运行时 env 在位情况格式化为错误附加信息。
 */
export function formatEnvPresenceDetail(env = {}) {
  const { presence, keys, mistypedKeys, bindings } = inspectEnvPresence(env);
  const present = Object.entries(presence)
    .filter(([, ok]) => ok)
    .map(([name]) => name);
  const missing = Object.entries(presence)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const mistyped = mistypedKeys.length
    ? ` | mistypedKeys=${mistypedKeys.map((k) => JSON.stringify(k)).join(',')}`
    : '';
  const d1 = bindings?.TG_BOT_DB;
  const kv = bindings?.TOPIC_MAP;
  const bindingHint = ` | d1=${d1?.jsType || 'none'}/prepare=${Boolean(d1?.hasPrepare)} | kv=${kv?.jsType || 'none'}/get=${Boolean(kv?.hasGet)}`;
  return ` | present=${present.join(',') || 'none'} | missing=${missing.join(',') || 'none'} | keys=${keys.join(',') || 'none'}${mistyped}${bindingHint}`;
}

/**
 * 校验 D1 绑定是否为可用的 Database 对象（而非同名 Text 变量）。
 */
export function assertD1Binding(db, name = 'TG_BOT_DB') {
  if (db == null) {
    throw new Error(`D1 '${name}' not bound`);
  }
  if (typeof db === 'string') {
    throw new Error(
      `D1 '${name}' is a string variable, not a D1 Database binding. `
      + 'Delete the Text/Secret named TG_BOT_DB and add Bindings → D1 Database with variable name TG_BOT_DB.',
    );
  }
  if (typeof db.prepare !== 'function') {
    throw new Error(
      `D1 '${name}' is bound but has no prepare() (got ${typeof db}). `
      + 'In Cloudflare Dashboard: Settings → Bindings → add D1 Database, variable name must be exactly TG_BOT_DB.',
    );
  }
  return db;
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
