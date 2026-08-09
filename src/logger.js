const REDACTED_KEYS = new Set([
  'bot_token',
  'turnstile_secret_key',
  'webhook_secret',
  'bottoken',
  'turnstiletoken',
  'webhooksecret',
  'verifycode',
  'verifyid',
  'text',
  'caption',
  // 通用凭据/敏感字段（精确键名匹配，防新增日志误带）
  'token',
  'secret',
  'phone',
  'password',
  'passcode',
  'auth_key',
  'api_hash',
  'access_hash',
  'session_key',
  'private_key',
]);

function redactValue(key, value, seen) {
  if (REDACTED_KEYS.has(String(key).toLowerCase())) return '[REDACTED]';
  if (Array.isArray(value)) {
    return value.map(item => redactValue('', item, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const redacted = Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childKey, childValue, seen),
      ]),
    );
    seen.delete(value);
    return redacted;
  }
  return value;
}

export function redactLogData(data = {}) {
  return redactValue('', data, new WeakSet());
}

/**
 * 将任意数据序列化为 JSON 字符串。
 * JSON.stringify 遇 BigInt 会抛 TypeError、遇函数/undefined 会丢字段，
 * 日志路径不允许因序列化失败拖垮调用方，故兜底为安全字符串。
 */
export function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[Unserializable]';
    }
  }
}

/** 归一化错误值：Error 取 message，字符串原样，其余对象取 message 或安全字符串 */
function errorMessage(value) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value !== null && typeof value === 'object') {
    const message = value.message;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(value);
    } catch {
      return '[Unserializable Error]';
    }
  }
  if (value === undefined || value === null) return 'unknown';
  return String(value);
}

/** 单条日志输出长度上限：超出部分截断并追加标记，避免超长负载撑爆 Cloudflare 日志配额 */
const LOG_MAX_BYTES = 32 * 1024;
const LOG_TRUNCATED_SUFFIX = '…[truncated]';

function capLogLine(output) {
  if (output.length <= LOG_MAX_BYTES) return output;
  const keep = LOG_MAX_BYTES - LOG_TRUNCATED_SUFFIX.length;
  return `${output.slice(0, keep)}${LOG_TRUNCATED_SUFFIX}`;
}

export function createLogger(baseContext = {}, sink = console, options = {}) {
  const { onError } = options;

  function emit(level, action, data = {}) {
    const method = level.toLowerCase();
    const log = redactLogData({
      timestamp: new Date().toISOString(),
      level,
      action,
      ...baseContext,
      ...data,
    });
    const output = capLogLine(safeStringify(log));
    try {
      const target = typeof sink?.[method] === 'function' ? sink[method] : sink?.log;
      if (typeof target === 'function') target.call(sink, output);
    } catch {
      // 日志输出异常不得影响业务主流程
    }
  }

  return {
    info(action, data = {}) {
      emit('INFO', action, data);
    },
    warn(action, data = {}) {
      emit('WARN', action, data);
    },
    error(action, error, data = {}) {
      emit('ERROR', action, {
        error: errorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...data,
      });
      // 错误旁路：供网关收集系统错误（环形缓冲/KV），异常不得影响主流程
      try {
        onError?.(action, error, data);
      } catch { /* 忽略旁路失败 */ }
    },
    debug(action, data = {}) {
      emit('DEBUG', action, data);
    },
  };
}
