/**
 * Turnstile 人机验证页面：HTML 模板与渲染（纯字符串，便于单测）
 * 由 worker.js GET /verify 端点渲染并附带 Turnstile 专用 CSP。
 * 模板变量：{{SITE_KEY}} {{CODE}} {{USER_ID}} {{WORKER_URL}}
 *
 * 设计要点：
 * - 暗色模式跟随系统偏好（prefers-color-scheme），Turnstile 组件主题同步切换
 * - 状态提示为胶囊样式，区分加载中 / 成功 / 失败三种状态
 * - 无障碍：状态区 aria-live，按钮可聚焦
 */
import { escapeHtml } from './utils.js';

// 两个验证页面共用的基础样式（暗色模式、卡片、按钮、页脚），避免两套模板各自维护导致漂移
const VERIFY_SHARED_STYLE = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#f0f2f5;--card:#ffffff;--text:#1a1a1a;--sub:#5b6472;--muted:#9aa3af;
  --accent:#0088cc;--border:#e4e7ec;
  --success-bg:#e8f7ee;--success-text:#0f7a45;
  --error-bg:#fdecec;--error-text:#b42318;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0f172a;--card:#1e293b;--text:#f1f5f9;--sub:#94a3b8;--muted:#64748b;
    --accent:#38bdf8;--border:#334155;
    --success-bg:#0b2e21;--success-text:#4ade80;
    --error-bg:#3b1212;--error-text:#fca5a5;
  }
}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;color:var(--text)}
.card{background:var(--card);border-radius:20px;padding:36px 24px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(15,23,42,0.08);border:1px solid var(--border)}
.icon{font-size:52px;margin-bottom:14px}
h2{color:var(--text);margin-bottom:8px;font-size:20px;font-weight:600}
p.desc{color:var(--sub);font-size:14px;margin-bottom:26px;line-height:1.7}
#back-btn{display:inline-block;margin:20px auto 0;background:var(--accent);color:#fff;border:none;padding:13px 28px;border-radius:12px;font-size:16px;text-decoration:none;font-weight:600;transition:opacity .2s,transform .1s;box-shadow:0 2px 8px rgba(0,136,204,0.3)}
#back-btn:hover{opacity:.92}
#back-btn:focus-visible{outline:3px solid var(--text);outline-offset:3px}
#back-btn:active{transform:scale(.98)}
.footer{margin-top:22px;font-size:11px;color:var(--muted)}
@media (prefers-reduced-motion: reduce){
  *{animation:none!important;transition:none!important}
  #back-btn:active{transform:none}
}
`;

const VERIFY_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)">
<meta name="format-detection" content="telephone=no">
<title>人机验证</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>${VERIFY_SHARED_STYLE}
.turnstile-container{display:flex;justify-content:center;margin-bottom:10px;min-height:65px}
#status{display:inline-flex;align-items:center;gap:7px;font-size:13px;line-height:1.5;color:var(--sub);margin-top:14px;padding:9px 16px;border-radius:999px;background:var(--bg);border:1px solid var(--border);min-height:38px;transition:background .2s,color .2s}
#status.success{background:var(--success-bg);color:var(--success-text);border-color:transparent}
#status.error{background:var(--error-bg);color:var(--error-text);border-color:transparent}
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;display:inline-block;animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
#tech-wrap{margin-top:18px;text-align:left;font-size:12px;color:var(--muted)}
#tech-wrap summary{cursor:pointer;user-select:none;color:var(--sub)}
#tech-detail{white-space:pre-wrap;word-break:break-all;margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.footer span{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
</style>
</head>
<body>
<div class="card">
  <div class="icon" aria-hidden="true">🛡️</div>
  <h2>人机验证</h2>
  <p class="desc">请完成下方验证以确认您不是机器人。<br>验证通过后您的消息将自动送达。</p>
  <div class="turnstile-container">
    <div class="cf-turnstile" data-sitekey="{{SITE_KEY}}" data-callback="onTurnstileSuccess" data-error-callback="onTurnstileError"></div>
  </div>
  <div id="status" role="status" aria-live="polite" aria-atomic="true"></div>
  <a id="back-btn" href="tg://resolve">📱 返回 Telegram</a>
  <details id="tech-wrap" hidden>
    <summary>技术详情（排障用）</summary>
    <div id="tech-detail"></div>
  </details>
  <div class="footer" data-user-id="{{USER_ID}}" data-code="{{CODE}}">
    <span id="footer-status">私聊网关 · 人机验证</span>
  </div>
</div>
<script>
// Turnstile 组件主题跟随系统偏好（需在 widget 渲染前设置，并随系统切换实时重建）
(function(){
  var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  var el = document.querySelector('.cf-turnstile');
  if (!mq) return;
  function applyTheme() {
    var theme = mq.matches ? 'dark' : 'light';
    if (el) el.setAttribute('data-theme', theme);
    // 已验证流程开始后不再重建，避免打断用户操作
    if (window.turnstile && !submitted) {
      try {
        window.turnstile.remove(el);
        window.turnstile.render(el, {
          sitekey: el.getAttribute('data-sitekey'),
          callback: el.getAttribute('data-callback'),
          'error-callback': el.getAttribute('data-error-callback'),
          theme: theme
        });
      } catch (e) { /* 重建失败时保持现状，不阻塞页面 */ }
    }
  }
  applyTheme();
  if (mq.addEventListener) {
    mq.addEventListener('change', applyTheme);
  } else if (mq.addListener) { // 旧 Safari
    mq.addListener(applyTheme);
  }
})();
var submitted = false;
function updateFooter(status) {
  var el = document.getElementById('footer-status');
  if (el) el.textContent = status;
}
function showStatus(msg, cls) {
  var el = document.getElementById('status');
  if (!el) return;
  el.className = cls || '';
  el.innerHTML = '';
  if (cls === 'loading') {
    var sp = document.createElement('span');
    sp.className = 'spinner';
    el.appendChild(sp);
  }
  var t = document.createElement('span');
  t.textContent = msg;
  el.appendChild(t);
  // 页面标题随状态更新，便于多标签页/后台排障识别
  var titles = { loading: '人机验证中', success: '✅ 验证成功', error: '❌ 验证失败' };
  if (titles[cls]) document.title = titles[cls];
  // 页脚状态行同步，给用户一个「本页可关闭」的明确信号
  var footers = { loading: '正在验证身份…', success: '验证已完成，本页可关闭', error: '验证未完成，可稍后重试' };
  if (footers[cls]) updateFooter(footers[cls]);
}
function onTurnstileSuccess(token) {
  if (submitted) return;
  submitted = true;
  showStatus('✅ 验证通过，正在通知机器人…', 'loading');
  fetch('{{WORKER_URL}}/verify-callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token, code: '{{CODE}}', userId: '{{USER_ID}}' })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      var msg = '✅ 验证成功！请返回 Telegram 继续对话。';
      if (data.pendingCount > 0) {
        msg += '（' + data.pendingCount + ' 条消息将于数秒内送达）';
      }
      showStatus(msg, 'success');
      document.querySelector('.desc').textContent = '验证完成，请返回 Telegram 查看机器人消息。';
    } else {
      var errMap = {
        'turnstile_failed': '人机验证未通过，请刷新页面重试',
        'code_invalid_or_expired': '验证链接已过期（约 {{VERIFY_EXPIRE_MINUTES}} 分钟），请返回 Telegram 重新发消息获取新链接',
        'server_not_configured': '服务器未完成配置，请联系管理员'
      };
      var errMsg = errMap[data.error] || ('验证失败: ' + (data.detail || data.error || '未知错误'));
      showStatus(errMsg, 'error');
      submitted = false;
      if (window.turnstile) {
        window.turnstile.reset();
      }
    }
  })
  .catch(function(e) {
    showStatus('❌ 网络连接失败，请检查网络后刷新页面重试', 'error');
    submitted = false;
    if (window.turnstile) {
      window.turnstile.reset();
    }
  });
}
function onTurnstileError(errorCode) {
  // 用户侧只展示友好提示；管理员排障所需的错误码与修复建议折叠在「技术详情」中，
  // 避免向普通用户暴露部署细节（域名授权、Site Key 等）。
  // Turnstile 客户端错误码：https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
  var code = (errorCode == null || errorCode === '') ? '' : String(errorCode);
  var hint = '';
  if (code === '110200') {
    hint = '域名未授权：请在 Cloudflare Turnstile → Hostname 中添加当前 Worker 域名，如 xxx.workers.dev';
  } else if (code === '110110') {
    hint = 'Site Key 无效：请检查 Dashboard 中的 TURNSTILE_SITE_KEY';
  } else if (code === '110600') {
    hint = '挑战超时：请刷新页面重试；若在 Telegram 内置浏览器失败，可改用系统浏览器打开链接';
  } else if (code === '300030' || code === '300031') {
    hint = '组件初始化失败：多为 CSP/网络拦截 challenges.cloudflare.com';
  } else if (!code) {
    hint = '无法加载 challenges.cloudflare.com：请检查网络/代理/地区访问';
  }
  showStatus('⚠️ 验证组件加载失败，请刷新重试；若多次失败，请返回 Telegram 重新获取链接。', 'error');
  var wrap = document.getElementById('tech-wrap');
  var detailEl = document.getElementById('tech-detail');
  if (wrap && detailEl) {
    detailEl.textContent = (code ? '错误码: ' + code + '\n' : '') + (hint || '未知错误');
    wrap.hidden = false;
  }
}
// 初始加载态：脚本未就绪时显示加载动画（区分脚本被墙与 widget 配置错误）
showStatus('正在加载验证组件…', 'loading');
// 脚本长时间未就绪时给出提示（区分脚本被墙与 widget 配置错误）
setTimeout(function() {
  if (!window.turnstile && !submitted) {
    showStatus('⚠️ 未能加载 Turnstile 脚本（challenges.cloudflare.com）。请检查网络，或让管理员暂时关闭 TURNSTILE_* 变量以使用本地题库验证。', 'error');
  }
}, 8000);
</script>
</body>
</html>`;

/**
 * 渲染验证页：替换模板变量并做 HTML 转义。
 * @param {{siteKey:string, code:string, userId:string, workerUrl:string, verifyExpireMinutes?:number}} params
 * @returns {string} 完整 HTML 页面
 */
export function renderVerifyPage({ siteKey, code, userId, workerUrl, verifyExpireMinutes }) {
  // 过期提示分钟数由调用方按 TURNSTILE_VERIFY_TTL 换算注入，避免跨文件漂移
  const expireMinutes = Number(verifyExpireMinutes) > 0
    ? Math.round(Number(verifyExpireMinutes))
    : 10;
  return VERIFY_PAGE_HTML
    .replace(/{{SITE_KEY}}/g, escapeHtml(siteKey))
    .replace(/{{CODE}}/g, escapeHtml(code))
    .replace(/{{USER_ID}}/g, escapeHtml(userId))
    .replace(/{{WORKER_URL}}/g, escapeHtml(workerUrl))
    .replace(/{{VERIFY_EXPIRE_MINUTES}}/g, String(expireMinutes));
}

// 验证页错误提示（缺参/未配置等场景）：与验证页共用视觉语言，避免裸 HTML 与风格割裂
const VERIFY_ERROR_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)">
<meta name="format-detection" content="telephone=no">
<title>人机验证</title>
<style>${VERIFY_SHARED_STYLE}
.error{display:inline-flex;align-items:center;gap:7px;font-size:13px;line-height:1.5;color:var(--error-text);margin-top:14px;padding:9px 16px;border-radius:999px;background:var(--error-bg);border:1px solid transparent}
</style>
</head>
<body>
<div class="card">
  <div class="icon" aria-hidden="true">⚠️</div>
  <h2>验证不可用</h2>
  <p class="desc">{{DESC}}</p>
  <div class="error">❌ 无法继续验证</div>
  <a id="back-btn" href="tg://resolve">📱 返回 Telegram</a>
  <div class="footer">请返回 Telegram 后向机器人重新发送消息获取新链接</div>
</div>
</body>
</html>`;

/**
 * 渲染验证错误页：链接缺参、验证未配置等场景的统一降级提示。
 * @param {{message?:string, hint?:string}} [opts] - message 为原因说明，hint 为补充引导
 * @returns {string} 完整 HTML 页面
 */
export function renderVerifyErrorPage({ message = '验证链接无效或已失效。', hint = '' } = {}) {
  const desc = [escapeHtml(message), escapeHtml(hint)].filter(Boolean).join('<br>');
  return VERIFY_ERROR_PAGE_HTML.replace(/{{DESC}}/g, desc);
}
