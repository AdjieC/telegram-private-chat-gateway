import { describe, it, expect } from 'vitest';
import {
  utcDayStartMs,
  summarizeInboundActivity,
  formatHeatBars,
  formatPeakHours,
  rankMedal,
} from '../../src/activity-summary.js';

describe('activity-summary', () => {
  it('utcDayStartMs 对齐 UTC 零点', () => {
    const ms = Date.UTC(2026, 6, 11, 15, 30, 0);
    expect(utcDayStartMs(ms)).toBe(Date.UTC(2026, 6, 11, 0, 0, 0));
  });

  it('汇总总量、排行与高峰小时', () => {
    const day = Date.UTC(2026, 6, 11, 0, 0, 0);
    const rows = [
      { userId: '1', createdAt: day + 14 * 3600_000 },
      { userId: '1', createdAt: day + 14 * 3600_000 + 1000 },
      { userId: '1', createdAt: day + 15 * 3600_000 },
      { userId: '2', createdAt: day + 14 * 3600_000 },
      { userId: '3', createdAt: day + 9 * 3600_000 },
    ];
    const s = summarizeInboundActivity(rows, { topN: 2 });
    expect(s.total).toBe(5);
    expect(s.uniqueUsers).toBe(3);
    expect(s.ranking).toEqual([
      { userId: '1', count: 3 },
      { userId: '2', count: 1 },
    ]);
    expect(s.hours[14]).toBe(3);
    expect(s.hours[15]).toBe(1);
    expect(s.hours[9]).toBe(1);
    expect(s.peakHours[0]).toMatchObject({ hour: 14, count: 3 });
  });

  it('空数据热力为全点', () => {
    expect(formatHeatBars([])).toBe('·'.repeat(24));
    expect(formatPeakHours([])).toBe('暂无');
  });

  it('热力条随最大值缩放', () => {
    const hours = Array.from({ length: 24 }, () => 0);
    hours[0] = 1;
    hours[1] = 8;
    const bar = formatHeatBars(hours);
    expect(bar).toHaveLength(24);
    expect(bar[0]).not.toBe('·');
    expect(bar[1]).toBe('█');
  });

  it('名次徽章', () => {
    expect(rankMedal(0)).toBe('🥇');
    expect(rankMedal(1)).toBe('🥈');
    expect(rankMedal(2)).toBe('🥉');
    expect(rankMedal(3)).toBe('4.');
  });
});
