const REDACTED_KEYS = new Set([
  'BOT_TOKEN',
  'TURNSTILE_SECRET_KEY',
  'WEBHOOK_SECRET',
  'botToken',
  'turnstileToken',
  'webhookSecret',
  'verifyCode',
  'verifyId',
  'text',
  'caption',
]);

function redactValue(key, value, seen) {
  if (REDACTED_KEYS.has(key)) return '[REDACTED]';
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

export function createLogger(baseContext = {}, sink = console) {
  function emit(level, action, data = {}) {
    const method = level.toLowerCase();
    const log = redactLogData({
      timestamp: new Date().toISOString(),
      level,
      action,
      ...baseContext,
      ...data,
    });
    const output = JSON.stringify(log);
    (sink[method] || sink.log).call(sink, output);
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
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...data,
      });
    },
    debug(action, data = {}) {
      emit('DEBUG', action, data);
    },
  };
}
