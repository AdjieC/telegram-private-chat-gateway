const DEFAULT_API_BASE = 'https://api.telegram.org';
const API_BASE_WHITELIST = new Set([
  DEFAULT_API_BASE,
  'https://api.telegram.dev',
]);

const DEFAULT_SLEEP = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class TelegramApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TelegramApiError';
    Object.assign(this, details);
  }
}

export function classifyTelegramError({ status, description = '', retryAfter }) {
  const normalized = String(description).toLowerCase();
  if (status === 429) {
    return { category: 'rate_limited', retryable: true, retryAfter };
  }
  if (status >= 500) return { category: 'server_error', retryable: true };
  if (status === 401) return { category: 'unauthorized', retryable: false };
  if (status === 403) {
    const category = normalized.includes('bot was blocked by the user')
      ? 'user_unreachable'
      : 'forbidden';
    return { category, retryable: false };
  }
  if (
    normalized.includes('thread not found')
    || normalized.includes('topic not found')
    || normalized.includes('message thread not found')
    || normalized.includes('topic deleted')
  ) {
    return { category: 'topic_missing', retryable: false };
  }
  return { category: 'invalid_request', retryable: false };
}

function resolveApiBase(apiBase, logger) {
  if (!apiBase || API_BASE_WHITELIST.has(apiBase)) {
    return apiBase || DEFAULT_API_BASE;
  }
  logger?.warn?.('api_base_rejected', { attemptedBase: apiBase });
  return DEFAULT_API_BASE;
}

function retryDelay(attempt, random) {
  const base = attempt === 1 ? 250 : 750;
  const jitter = attempt === 1 ? 250 : 750;
  return base + Math.floor(random() * jitter);
}

export function createTelegramClient({
  botToken,
  apiBase,
  fetchImpl = fetch,
  sleep = DEFAULT_SLEEP,
  random = Math.random,
  timeoutMs = 8000,
  maxTotalMs = 20000,
  logger,
} = {}) {
  const base = resolveApiBase(apiBase, logger);

  return {
    async call(method, body) {
      const startedAt = Date.now();
      let attempt = 0;

      while (attempt < 3) {
        attempt += 1;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetchImpl(`${base}/bot${botToken}/${method}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          let result;
          try {
            result = await response.json();
          } catch (cause) {
            const error = new TelegramApiError('Invalid Telegram API response', {
              category: 'parse_error',
              retryable: true,
              status: response.status,
              method,
              attempts: attempt,
              cause,
            });
            if (attempt >= 2) throw error;

            const delay = retryDelay(attempt, random);
            if (Date.now() - startedAt + delay > maxTotalMs) throw error;
            logger?.warn?.('telegram_api_retry', {
              method,
              category: 'parse_error',
              attempt,
              delay,
            });
            await sleep(delay);
            continue;
          }
          if (result.ok) return result;

          const status = Number(result.error_code || response.status || 0);
          const retryAfter = status === 429
            ? Number(result.parameters?.retry_after || 0) || 5
            : undefined;
          const classification = classifyTelegramError({
            status,
            description: result.description,
            retryAfter,
          });
          const error = new TelegramApiError(
            result.description || `Telegram API ${status}`,
            {
              ...classification,
              status,
              method,
              attempts: attempt,
              response: result,
            },
          );

          const maxAttempts = classification.category === 'rate_limited' ? 2 : 3;
          if (!classification.retryable || attempt >= maxAttempts) throw error;

          const delay = classification.category === 'rate_limited'
            ? retryAfter * 1000
            : retryDelay(attempt, random);
          if (Date.now() - startedAt + delay > maxTotalMs) throw error;
          logger?.warn?.('telegram_api_retry', {
            method,
            category: classification.category,
            attempt,
            delay,
          });
          await sleep(delay);
        } catch (caught) {
          if (caught instanceof TelegramApiError) throw caught;

          const category = caught?.name === 'AbortError' ? 'timeout' : 'network';
          const error = new TelegramApiError(
            category === 'timeout' ? 'Request timeout' : String(caught?.message || caught),
            {
              category,
              retryable: true,
              status: 0,
              method,
              attempts: attempt,
            },
          );
          if (attempt >= 3) throw error;

          const delay = retryDelay(attempt, random);
          if (Date.now() - startedAt + delay > maxTotalMs) throw error;
          logger?.warn?.('telegram_api_retry', { method, category, attempt, delay });
          await sleep(delay);
        } finally {
          clearTimeout(timeoutId);
        }
      }

      throw new TelegramApiError('Telegram API retry limit reached', {
        category: 'network',
        retryable: true,
        status: 0,
        method,
        attempts: attempt,
      });
    },
  };
}
