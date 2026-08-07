import { describe, it, expect } from 'vitest';
import { renderVerifyPage } from '../../src/verify-page.js';

describe('verify-page', () => {
  const page = renderVerifyPage({
    siteKey: '0x4AAAAAAA-test',
    code: 'abc<123>',
    userId: '42&1',
    workerUrl: 'https://gw.example.workers.dev',
  });

  it('渲染时替换全部模板变量并转义用户输入', () => {
    expect(page).not.toContain('{{SITE_KEY}}');
    expect(page).not.toContain('{{CODE}}');
    expect(page).not.toContain('{{USER_ID}}');
    expect(page).not.toContain('{{WORKER_URL}}');
    // 用户可控输入需转义，防止注入页面结构
    expect(page).toContain('0x4AAAAAAA-test');
    expect(page).toContain('abc&lt;123&gt;');
    expect(page).toContain('42&amp;1');
  });

  it('暗色模式跟随系统偏好并提供颜色主题声明', () => {
    expect(page).toContain('prefers-color-scheme: dark');
    expect(page).toContain('color-scheme');
    expect(page).toContain('theme-color');
  });

  it('状态区具备加载动画、无障碍与成功/错误样式', () => {
    expect(page).toContain('spinner');
    expect(page).toContain('aria-live');
    expect(page).toContain('#status.success');
    expect(page).toContain('#status.error');
  });

  it('初始显示加载状态且保留 Turnstile 错误码提示', () => {
    expect(page).toContain('正在加载验证组件');
    expect(page).toContain('110200');
    expect(page).toContain('110110');
    expect(page).toContain('110600');
  });

  it('保留返回 Telegram 按钮与 Turnstile 组件挂载点', () => {
    expect(page).toContain('cf-turnstile');
    expect(page).toContain('id="back-btn"');
    expect(page).toContain('tg://resolve');
  });
});
