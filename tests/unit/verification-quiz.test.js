import { describe, it, expect } from 'vitest';
import { buildQuizKeyboard } from '../../src/verification.js';

describe('buildQuizKeyboard（问答键盘构建）', () => {
  it('默认按 2 列分组，回调数据携带 verifyId 与索引', () => {
    const keyboard = buildQuizKeyboard(['水', '石头', '木头', '火'], 'abc123');
    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: '水', callback_data: 'verify:abc123:0' },
        { text: '石头', callback_data: 'verify:abc123:1' },
      ],
      [
        { text: '木头', callback_data: 'verify:abc123:2' },
        { text: '火', callback_data: 'verify:abc123:3' },
      ],
    ]);
  });

  it('支持自定义列数与奇数个选项', () => {
    const keyboard = buildQuizKeyboard(['A', 'B', 'C'], 'xyz', 3);
    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: 'A', callback_data: 'verify:xyz:0' },
        { text: 'B', callback_data: 'verify:xyz:1' },
        { text: 'C', callback_data: 'verify:xyz:2' },
      ],
    ]);
  });

  it('空选项返回空键盘；非法列数回退到 1', () => {
    expect(buildQuizKeyboard([], 'id').inline_keyboard).toEqual([]);
    const single = buildQuizKeyboard(['X'], 'id', 0);
    expect(single.inline_keyboard).toEqual([[{ text: 'X', callback_data: 'verify:id:0' }]]);
  });

  it('选项文本强制字符串化，防止非字符串污染回调', () => {
    const keyboard = buildQuizKeyboard([1, null, undefined], 'id');
    expect(keyboard.inline_keyboard[0][0]).toEqual({ text: '1', callback_data: 'verify:id:0' });
    expect(keyboard.inline_keyboard[0][1]).toEqual({ text: 'null', callback_data: 'verify:id:1' });
    expect(keyboard.inline_keyboard[1][0]).toEqual({ text: 'undefined', callback_data: 'verify:id:2' });
  });
});
