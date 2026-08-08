import { describe, it, expect } from 'vitest';
import {
  buildAdminHomeKeyboard,
  buildSysinfoKeyboard,
  buildUserJumpKeyboard,
  buildUserActionKeyboard,
  formatRankingBlock,
  formatHeatBlock,
  escapeHtml,
  buildBanConfirmKeyboard,
  buildCloseConfirmKeyboard,
  buildResetConfirmKeyboard,
  formatEmptyActivityHints,
  formatCstTime,
  formatTimeBoth,
  SEP_LINE,
  formatUserStatusChips,
  confirmBanText,
  confirmCloseText,
  confirmResetText,
  dangerCancelText,
  CLEANUP_CONFIRM_TEXT,
} from '../../src/admin-ui-format.js';

describe('admin-ui-format', () => {
  it('buildAdminHomeKeyboard 含活跃与查找', () => {
    const kb = buildAdminHomeKeyboard(false);
    const flat = kb.inline_keyboard.flat().map(b => b.callback_data);
    expect(flat).toContain('adm:nav:rank');
    expect(flat).toContain('adm:nav:find');
    expect(flat).toContain('adm:nav:notes');
    expect(flat).not.toContain('adm:nav:synccommands');
  });

  it('Owner 菜单含 synccommands', () => {
    const flat = buildAdminHomeKeyboard(true).inline_keyboard.flat().map(b => b.callback_data);
    expect(flat).toContain('adm:nav:synccommands');
  });

  it('sysinfo 键盘含 activity 页', () => {
    const flat = buildSysinfoKeyboard('activity').inline_keyboard.flat().map(b => b.callback_data);
    expect(flat).toContain('adm:sys:activity');
  });

  it('formatHeatBlock 标注 CST', () => {
    const hours = Array.from({ length: 24 }, () => 0);
    hours[0] = 3;
    const lines = formatHeatBlock(hours);
    expect(lines.join('\n')).toMatch(/CST/);
  });

  it('formatRankingBlock 空列表有引导', () => {
    const lines = formatRankingBlock([]);
    expect(lines.some(l => l.includes('暂无'))).toBe(true);
  });

  it('escapeHtml 转义尖括号', () => {
    expect(escapeHtml('<a>')).toContain('&lt;');
  });

  it('用户跳转键盘双列并含 panel 回调', () => {
    const kb = buildUserJumpKeyboard([
      { userId: '1', firstName: 'A' },
      { userId: '2', firstName: 'B' },
    ], { includeMenu: false });
    expect(kb.inline_keyboard[0]).toHaveLength(2);
    expect(kb.inline_keyboard[0][0].callback_data).toBe('adm:u:panel:1');
  });

  it('跳转键盘超长用户名截断并带省略号', () => {
    const longName = '这是一个非常非常长的用户名字符串用于测试截断行为';
    const kb = buildUserJumpKeyboard([
      { userId: '1', firstName: longName },
    ], { includeMenu: false });
    const label = kb.inline_keyboard[0][0].text;
    expect(label).toContain('…');
    expect(label.length).toBeLessThan(longName.length + 3);
  });

  it('formatRankingBlock 标注封禁/关闭状态徽标', () => {
    const lines = formatRankingBlock([
      { userId: '1', firstName: '被封', status: 'banned', count: 3 },
      { userId: '2', firstName: '被关', status: 'closed', count: 1 },
    ]);
    const joined = lines.join('\n');
    expect(joined).toContain('🚫');
    expect(joined).toContain('🔒');
    expect(joined).toContain('被封');
    expect(joined).toContain('被关');
  });

  it('封禁确认键盘', () => {
    const flat = buildBanConfirmKeyboard('99').inline_keyboard.flat().map(b => b.callback_data);
    expect(flat).toContain('adm:u:banok:99');
    expect(flat).toContain('adm:u:bancancel:99');
  });

  it('关闭/重置确认键盘与危险操作入口', () => {
    expect(buildCloseConfirmKeyboard('1').inline_keyboard.flat().map(b => b.callback_data))
      .toEqual(expect.arrayContaining(['adm:u:closeok:1', 'adm:u:closecancel:1']));
    expect(buildResetConfirmKeyboard('2').inline_keyboard.flat().map(b => b.callback_data))
      .toEqual(expect.arrayContaining(['adm:u:resetok:2', 'adm:u:resetcancel:2']));
    const kb = buildUserActionKeyboard('3');
    const data = kb.inline_keyboard.flat().map(b => b.callback_data);
    expect(data).toContain('adm:u:closeask:3');
    expect(data).toContain('adm:u:trust:3');
    expect(data).toContain('adm:u:banask:3');
  });

  it('按用户当前状态只显示相反的状态操作', () => {
    const kb = buildUserActionKeyboard('42', {
      banned: true,
      muted: true,
      closed: true,
      trusted: true,
    });
    const data = kb.inline_keyboard.flat().map(button => button.callback_data);

    expect(data).toContain('adm:u:unban:42');
    expect(data).toContain('adm:u:unmute:42');
    expect(data).toContain('adm:u:open:42');
    expect(data).toContain('adm:u:resetask:42');
    expect(data).not.toContain('adm:u:banask:42');
    expect(data).not.toContain('adm:u:mute:42');
    expect(data).not.toContain('adm:u:closeask:42');
    expect(data).not.toContain('adm:u:trust:42');
  });

  it('空活跃引导提示', () => {
    const hints = formatEmptyActivityHints().join('\n');
    expect(hints).toMatch(/CST/);
    expect(hints).toMatch(/find/);
  });

  it('formatCstTime 按 UTC+8 展示绝对时间', () => {
    // 2026-08-07 00:00:00 UTC → CST 08:00:00
    const ts = Date.UTC(2026, 7, 7, 0, 0, 0);
    expect(formatCstTime(ts)).toBe('2026-08-07 08:00:00 CST');
    expect(formatCstTime(null)).toBe('无');
    expect(formatCstTime(0)).toBe('无');
  });

  it('formatTimeBoth 组合相对时间与 CST 绝对时间', () => {
    const now = Date.UTC(2026, 7, 7, 12, 0, 0);
    const ts = now - 30 * 60 * 1000; // 30 分钟前
    const out = formatTimeBoth(ts, now);
    expect(out).toMatch(/30 分钟前/);
    expect(out).toMatch(/CST/);
    expect(out).toMatch(/<code>/);
  });

  it('SEP_LINE 为统一长度分隔线', () => {
    expect(SEP_LINE.length).toBeGreaterThan(10);
    expect(SEP_LINE).toMatch(/^─+$/);
  });

  it('formatUserStatusChips 只列出生效的受限状态', () => {
    expect(formatUserStatusChips({ banned: true })).toContain('已封禁');
    expect(formatUserStatusChips({ banned: true })).not.toContain('已静音');
    expect(formatUserStatusChips({ muted: true, closed: true })).toContain('已静音');
    expect(formatUserStatusChips({ muted: true, closed: true })).toContain('已关闭');
    expect(formatUserStatusChips({})).toBe('✅ 状态正常');
    expect(formatUserStatusChips({ banned: false, muted: false, closed: false })).toBe('✅ 状态正常');
  });

  it('危险操作确认文案含转义后的 UID 且三操作互不串词', () => {
    const ban = confirmBanText('12<34>');
    expect(ban).toContain('确认封禁用户');
    expect(ban).toContain('&lt;34&gt;');
    expect(ban).not.toContain('关闭对话');

    const close = confirmCloseText(99);
    expect(close).toContain('确认关闭对话');
    expect(close).not.toContain('封禁');

    const reset = confirmResetText(99);
    expect(reset).toContain('确认重置验证');
    expect(reset).not.toContain('封禁');
  });

  it('取消回执文案按操作区分，未知操作回退通用文案', () => {
    expect(dangerCancelText('ban')).toBe('已取消封禁。');
    expect(dangerCancelText('close')).toBe('已取消关闭对话。');
    expect(dangerCancelText('reset')).toBe('已取消重置验证。');
    expect(dangerCancelText('unknown')).toBe('已取消操作。');
  });

  it('清理确认文案统一为同一常量（文本命令与回调共用）', () => {
    expect(CLEANUP_CONFIRM_TEXT).toContain('确认清理无效话题');
    expect(CLEANUP_CONFIRM_TEXT).toContain('失效 Topic 映射');
  });
});
