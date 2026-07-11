import {
  normalizeEnv,
  validateBaseEnv,
  validateWebhookEnv,
} from './config.js';
import { ensureMigrations } from './storage/migrations.js';
import { createD1Storage } from './storage/d1-storage.js';
import { routeUpdate } from './update-router.js';
import { createMaintenanceService } from './maintenance-service.js';

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

class HttpRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readRequestBodyWithLimit(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new HttpRequestError(413, 'Payload Too Large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  const maxLength = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return mismatch === 0;
}

export async function validateTelegramWebhookRequest(request, env) {
  validateWebhookEnv(env);

  const contentType = request.headers.get('content-type') || '';
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpRequestError(415, 'Unsupported Media Type');
  }

  const providedSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!constantTimeEqual(providedSecret, env.WEBHOOK_SECRET)) {
    throw new HttpRequestError(401, 'Unauthorized');
  }

  try {
    JSON.parse(await readRequestBodyWithLimit(request.clone()));
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    throw new HttpRequestError(400, 'Bad Request');
  }
}

async function notFoundHandler() {
  return new Response('Not Found', { status: 404 });
}

/**
 * 创建可测试的 Worker 应用入口。
 * 健康检查在任何运行时绑定校验前完成，确保可用于存活探测。
 */
export function createApp({ handleFetch = notFoundHandler } = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (
        request.method === 'GET'
        && (url.pathname === '/' || url.pathname === '/health')
      ) {
        return new Response('OK');
      }

      const normalizedEnv = normalizeEnv(env);
      if (request.method === 'POST' && url.pathname !== '/') {
        try {
          await readRequestBodyWithLimit(request.clone());
        } catch (error) {
          if (error instanceof HttpRequestError) {
            return new Response(error.message, { status: error.status });
          }
          throw error;
        }
      }
      if (request.method === 'POST' && url.pathname === '/') {
        try {
          await validateTelegramWebhookRequest(request, normalizedEnv);
        } catch (error) {
          if (error instanceof HttpRequestError) {
            return new Response(error.message, { status: error.status });
          }
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }

      try {
        validateBaseEnv(normalizedEnv);
      } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
      }

      if (request.method === 'POST' && url.pathname === '/') {
        if (!normalizedEnv.TG_BOT_DB) {
          return new Response('Error: D1 TG_BOT_DB not bound', { status: 500 });
        }
        await ensureMigrations(normalizedEnv.TG_BOT_DB);
        const update = await request.clone().json();
        return routeUpdate(update, {
          storage: createD1Storage(normalizedEnv.TG_BOT_DB),
          handleUpdate: () => handleFetch(request, normalizedEnv, ctx),
        });
      }

      return handleFetch(request, normalizedEnv, ctx);
    },

    async scheduled(_event, env) {
      const normalizedEnv = normalizeEnv(env);
      if (!normalizedEnv.TG_BOT_DB) throw new Error("D1 'TG_BOT_DB' not bound");
      await ensureMigrations(normalizedEnv.TG_BOT_DB);
      return createMaintenanceService({
        storage: createD1Storage(normalizedEnv.TG_BOT_DB),
      }).runRetentionCleanup(Date.now());
    },
  };
}

export const defaultApp = createApp();
