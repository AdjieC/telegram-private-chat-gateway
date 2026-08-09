/**
 * 日统计 KV 读写：按运维时区（CST UTC+8）日历日聚合 messages_in/bans/verifies/spam 与小时热力。
 * 纯 env/KV 操作，供 admin-commands（看板）、admin-actions（封禁计数）、verification（验证计数）共用。
 */
import { OPS_TZ_OFFSET_HOURS, opsDayKey, opsYesterdayKey } from './activity-summary.js';

/** 日统计 KV 保留期（秒）：近 21 天趋势参考 */
const DAILY_STATS_TTL_SECONDS = 21 * 86400;

export function emptyDailyStats(day) {
  return {
    day,
    messages_in: 0,
    bans: 0,
    verifies: 0,
    spam: 0,
    hours: Array.from({ length: 24 }, () => 0),
  };
}

export async function bumpDailyStat(env, field, n = 1) {
  if (!env?.TOPIC_MAP) return;
  try {
    // 按运维时区（CST）日历日切分，避免北京时间午夜仍算「昨天」
    const day = opsDayKey();
    const key = `stats:${day}`;
    let obj = {};
    try {
      const raw = await env.TOPIC_MAP.get(key);
      if (raw) obj = JSON.parse(raw);
    } catch { obj = {}; }
    if (!obj || typeof obj !== 'object') obj = {};
    obj[field] = Number(obj[field] || 0) + Number(n || 0);
    obj.tz = `UTC+${OPS_TZ_OFFSET_HOURS}`;
    // 入站消息同步累计小时热力（存 UTC 小时，展示时平移到 CST）
    if (field === 'messages_in') {
      if (!Array.isArray(obj.hours) || obj.hours.length !== 24) {
        obj.hours = Array.from({ length: 24 }, () => 0);
      }
      const h = new Date().getUTCHours();
      obj.hours[h] = Number(obj.hours[h] || 0) + Number(n || 0);
    }
    obj.updated_at = Date.now();
    await env.TOPIC_MAP.put(key, JSON.stringify(obj), { expirationTtl: DAILY_STATS_TTL_SECONDS });
  } catch { /* 统计失败不影响主流程 */ }
}

export async function getDailyStats(env, day = opsDayKey()) {
  try {
    const raw = await env.TOPIC_MAP.get(`stats:${day}`);
    if (!raw) return emptyDailyStats(day);
    const obj = JSON.parse(raw);
    const hours = Array.isArray(obj.hours) && obj.hours.length === 24
      ? obj.hours.map(n => Number(n || 0))
      : Array.from({ length: 24 }, () => 0);
    return {
      day,
      messages_in: Number(obj.messages_in || 0),
      bans: Number(obj.bans || 0),
      verifies: Number(obj.verifies || 0),
      spam: Number(obj.spam || 0),
      hours,
      updated_at: obj.updated_at,
    };
  } catch {
    return emptyDailyStats(day);
  }
}

/** 近 N 个运维日入站序列（含今日） */
export async function getRecentDailySeries(env, days = 7) {
  const n = Math.min(Math.max(Number(days) || 7, 1), 14);
  const series = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i -= 1) {
    const day = opsDayKey(now - i * 86400_000);
    const s = await getDailyStats(env, day);
    series.push({
      day,
      messages_in: s.messages_in,
      verifies: s.verifies,
      bans: s.bans,
      spam: s.spam,
    });
  }
  return series;
}

/** 供管理看板引用运维时区常数（文案显示用） */
export { OPS_TZ_OFFSET_HOURS, opsYesterdayKey };
