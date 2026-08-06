/**
 * 内容过滤词库：硬编码屏蔽词 + KV 动态词库（合并去重）。
 * 供消息策略（worker.js）与词库管理命令（admin-actions.js）共用。
 */

// --- PR #11: 屏蔽词列表（硬编码，用户可自行修改此数组） ---
export const BLOCKED_WORDS = [
  "赌博",
  "色情",
  "代开发",
  "加微信",
  // ↑ 在此添加更多屏蔽词，每行一个，用引号包裹、逗号结尾
];

// 屏蔽词内存缓存（减少 KV 读取频率）
const blockedWordsCache = { data: null, ts: 0, ttl: 60000 }; // 缓存 60 秒

/**
 * 获取完整屏蔽词列表 = 硬编码 + KV 动态词库（合并去重）
 * @param {object} env - Worker 环境
 * @param {boolean} forceRefresh - 是否强制刷新缓存
 * @returns {Promise<string[]>}
 */
export async function getBlockedWords(env, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && blockedWordsCache.data && (now - blockedWordsCache.ts < blockedWordsCache.ttl)) {
    return blockedWordsCache.data;
  }

  // 从 KV 读取动态屏蔽词
  let kvWords = [];
  try {
    const raw = await env.TOPIC_MAP.get("blocked_words_kv");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        kvWords = parsed.filter(w => typeof w === "string" && w.trim().length > 0);
      }
    }
  } catch (e) {
    // 解析失败按空词库处理；调用方可通过 Logger 感知
    kvWords = [];
  }

  // 合并去重（硬编码优先，KV 补充）
  const merged = [...new Set([...BLOCKED_WORDS, ...kvWords])];
  blockedWordsCache.data = merged;
  blockedWordsCache.ts = now;
  return merged;
}

/**
 * 读取 KV 动态屏蔽词（解析失败或非数组时回退为空数组）
 * 供 /addword、/delword、/listwords 共用，避免多处重复读解析逻辑
 * @param {object} env - Worker 环境
 * @returns {Promise<string[]>}
 */
export async function readKvBlockedWords(env) {
  let kvWords = [];
  try {
    const raw = await env.TOPIC_MAP.get("blocked_words_kv");
    if (raw) kvWords = JSON.parse(raw);
  } catch { /* 忽略解析错误，从空数组开始 */ }
  if (!Array.isArray(kvWords)) kvWords = [];
  return kvWords;
}

/** 词库变更（/addword /delword）后强制刷新缓存 */
export function invalidateBlockedWordsCache() {
  blockedWordsCache.data = null;
}
