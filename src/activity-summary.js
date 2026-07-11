/**
 * 管理看板：消息活跃汇总与热力展示（纯函数，便于单测）
 */

/** 当日 UTC 0 点毫秒时间戳 */
export function utcDayStartMs(now = Date.now()) {
  const d = new Date(Number(now) || Date.now());
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * 汇总入站消息行 → 总量 / 小时桶 / 用户排行
 * @param {Array<{userId:string, createdAt:number}>} rows
 * @param {{topN?:number}} [opts]
 */
export function summarizeInboundActivity(rows, opts = {}) {
  const topN = Math.min(Math.max(Number(opts.topN) || 10, 1), 30);
  const hours = Array.from({ length: 24 }, () => 0);
  const byUser = new Map();
  let total = 0;

  for (const row of rows || []) {
    const createdAt = Number(row?.createdAt || 0);
    if (!createdAt) continue;
    total += 1;
    const hour = new Date(createdAt).getUTCHours();
    hours[hour] += 1;
    const uid = String(row.userId || '');
    if (!uid) continue;
    byUser.set(uid, (byUser.get(uid) || 0) + 1);
  }

  const ranking = [...byUser.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([userId, count]) => ({ userId, count }));

  const peakHours = hours
    .map((count, hour) => ({ hour, count }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour)
    .slice(0, 3);

  return { total, hours, ranking, peakHours, uniqueUsers: byUser.size };
}

/**
 * 将 24 小时计数渲染为 Unicode 热力条
 * @param {number[]} hours
 */
export function formatHeatBars(hours) {
  const list = Array.isArray(hours) && hours.length === 24
    ? hours.map(n => Math.max(0, Number(n) || 0))
    : Array.from({ length: 24 }, () => 0);
  const max = Math.max(0, ...list);
  if (max <= 0) return '·'.repeat(24);
  const blocks = '▁▂▃▄▅▆▇█';
  return list.map((n) => {
    if (n <= 0) return '·';
    // 将 (0, max] 映射到 8 档，最大值固定为 █
    const level = Math.min(8, Math.max(1, Math.ceil((n / max) * 8)));
    return blocks[level - 1];
  }).join('');
}

/**
 * 高峰时段文案，如 14:00×12 · 15:00×9
 * @param {Array<{hour:number,count:number}>} peakHours
 */
export function formatPeakHours(peakHours) {
  if (!peakHours?.length) return '暂无';
  return peakHours
    .map(p => `${String(p.hour).padStart(2, '0')}:00×${p.count}`)
    .join(' · ');
}

/**
 * 名次徽章
 * @param {number} index0
 */
export function rankMedal(index0) {
  if (index0 === 0) return '🥇';
  if (index0 === 1) return '🥈';
  if (index0 === 2) return '🥉';
  return `${index0 + 1}.`;
}
