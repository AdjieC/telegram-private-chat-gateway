import { describe, it, expect } from 'vitest';
import { renderVerifyPage, renderVerifyErrorPage } from '../../src/verify-page.js';

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
    // 用户可控输入需转义，防止注入页面结构（data 属性承载，不参与可见文案）
    expect(page).toContain('0x4AAAAAAA-test');
    expect(page).toContain('abc&lt;123&gt;');
    expect(page).toContain('42&amp;1');
  });

  it('页脚不直接展示用户 ID 与验证码（转为 data 属性承载）', () => {
    expect(page).toContain('data-user-id="42&amp;1"');
    expect(page).toContain('data-code="abc&lt;123&gt;"');
    // 可见文案中不应出现调试风格的 User:/Code: 标签
    expect(page).not.toContain('Code:');
    expect(page).toContain('id="footer-status"');
  });

  it('页脚状态行随验证状态更新', () => {
    expect(page).toContain('正在验证身份…');
    expect(page).toContain('验证已完成，本页可关闭');
    expect(page).toContain('验证未完成，可稍后重试');
  });

  it('暗色模式跟随系统偏好并提供颜色主题声明', () => {
    expect(page).toContain('prefers-color-scheme: dark');
    expect(page).toContain('color-scheme');
    expect(page).toContain('theme-color');
    // 主题不应硬编码为 light：由脚本按系统偏好动态设置，避免暗色用户看到亮色闪烁
    expect(page).not.toContain('data-theme="light"');
    expect(page).toContain("setAttribute('data-theme', theme)");
  });

  it('状态区具备加载动画、无障碍与成功/错误样式', () => {
    expect(page).toContain('spinner');
    expect(page).toContain('aria-live');
    expect(page).toContain('role="status"');
    expect(page).toContain('aria-atomic="true"');
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

  it('返回 Telegram 按钮默认可见（加载/失败态用户也可返回，而非仅成功后才出现）', () => {
    // 按钮不应初始隐藏：用户误入页面或验证失败时需要随时能返回 Telegram
    expect(page).not.toContain('#back-btn{display:none}');
    expect(page).not.toContain("btn.style.display = 'inline-block'");
  });

  it('返回 Telegram 按钮拥有键盘焦点可见反馈', () => {
    expect(page).toContain('#back-btn:focus-visible');
  });

  it('Turnstile 错误只向用户展示友好提示，排障详情默认折叠', () => {
    // 用户可见文案不再夹带管理员排障细节（域名授权/Site Key 等）
    expect(page).toContain('验证组件加载失败，请刷新重试');
    // 排障详情收敛到可折叠容器，仅管理员排障时展开；错误码映射仍保留
    expect(page).toContain('id="tech-detail"');
    expect(page).toContain('<details');
    expect(page).toContain('110200');
    expect(page).toContain('110110');
    expect(page).toContain('110600');
    // 部署术语只允许出现在折叠的技术详情里，不得出现在用户可见主文案中
    expect(page.indexOf('Hostname')).toBeGreaterThan(page.indexOf('id="tech-detail"'));
  });

  it('页面标题随验证状态更新，便于多标签页识别', () => {
    expect(page).toContain("'✅ 验证成功'");
    expect(page).toContain("'❌ 验证失败'");
  });

  it('过期提示分钟数由参数注入且缺省兜底为 10', () => {
    const withMinutes = renderVerifyPage({
      siteKey: 'k', code: 'c', userId: '1', workerUrl: 'https://x.workers.dev',
      verifyExpireMinutes: 5,
    });
    expect(withMinutes).toContain('约 5 分钟');
    // 未传参时兜底 10，且模板占位符必须被替换干净
    expect(page).toContain('约 10 分钟');
    expect(page).not.toContain('{{VERIFY_EXPIRE_MINUTES}}');
  });
});

describe('verify-page error page', () => {
  it('渲染错误提示并转义用户可控内容', () => {
    const page = renderVerifyErrorPage({ message: '缺少参数<坏>', hint: '请重新发送消息' });
    expect(page).toContain('缺少参数&lt;坏&gt;');
    expect(page).toContain('请重新发送消息');
    expect(page).toContain('tg://resolve');
    expect(page).toContain('prefers-color-scheme: dark');
  });

  it('无 hint 时只渲染 message，且默认值兜底', () => {
    const page = renderVerifyErrorPage();
    expect(page).toContain('验证链接无效或已失效');
    expect(page).not.toContain('<br>');
    expect(page).not.toContain('{{DESC}}');
  });

  it('message 与 hint 同时存在时以换行分隔', () => {
    const page = renderVerifyErrorPage({ message: '原因', hint: '引导' });
    expect(page).toContain('原因<br>引导');
  });
});
