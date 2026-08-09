/**
 * 纯函数工具模块
 * 此模块不包含任何外部依赖（无 Logger、无 env、无全局状态），可直接单元测试
 */

/**
 * 清理资料文本：移除控制字符、合并连续空白、去除首尾空白。
 * 供话题标题与资料卡展示共用，保证各处清理规则一致。
 * @param {*} value - 原始值（非字符串会被转为字符串）
 * @returns {string}
 */
export function cleanProfileText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * HTML 转义：验证页模板与管理消息共用，防止用户可控内容注入页面/消息结构。
 * 定义在纯函数基座模块，避免页面模块反向依赖管理 UI 模块。
 * @param {*} str - 原始值（非字符串会被转为字符串）
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/**
 * 检查文本是否包含屏蔽词
 * @param {string} text - 待检查文本
 * @param {string[]} words - 屏蔽词列表
 * @returns {{ hit: boolean, word: string|null }}
 */
export function containsBlockedWord(text, words) {
  if (!text || !words || words.length === 0) return { hit: false, word: null };
  const lower = text.toLowerCase();
  for (const w of words) {
    if (w && lower.includes(w.toLowerCase())) {
      return { hit: true, word: w };
    }
  }
  return { hit: false, word: null };
}

/**
 * 提取消息正文与媒体说明，供新消息和编辑消息共享策略。
 */
export function extractMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  return [message.text, message.caption]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .trim();
}

/**
 * 检测消息文本中是否包含 URL/链接
 * @param {string} text - 消息文本
 * @returns {boolean}
 */
export function containsLink(text) {
  if (!text) return false;
  const patterns = [
    /https?:\/\/\S+/i,
    /[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(\/\S*)?/,
    /t\.me\/\S+/i,
    /telegram\.me\/\S+/i,
  ];
  return patterns.some(p => p.test(text));
}

/**
 * 构建反垃圾检测文本：消息正文 + 发送者资料
 * @param {object} msg - Telegram message object
 * @returns {string} 用于关键词/链接检测的合并文本
 */
export function buildSpamCheckText(msg) {
  if (!msg || typeof msg !== 'object') return '';
  const from = msg.from || {};
  return [
    msg.text,
    msg.caption,
    from.first_name,
    from.last_name,
    from.username,
  ]
    .filter(v => typeof v === 'string' && v.trim().length > 0)
    .join(' ');
}

/**
 * 检测消息是否包含垃圾关键词
 * @param {string} text - 消息文本
 * @param {string[]} keywords - 关键词列表
 * @returns {{isSpam: boolean, matchedWord: string|null}}
 */
export function detectSpamKeywords(text, keywords) {
  if (!text || keywords.length === 0) {
    return { isSpam: false, matchedWord: null };
  }
  const lower = text.toLowerCase();
  for (const word of keywords) {
    if (lower.includes(word)) {
      return { isSpam: true, matchedWord: word };
    }
  }
  return { isSpam: false, matchedWord: null };
}

/**
 * 计算消息内容的简单哈希（用于重复检测）
 * @param {object} msg - Telegram message object
 * @returns {string|null} 哈希字符串，无法计算时返回 null
 */
export function computeMessageHash(msg) {
  const text = (msg.text || msg.caption || '').trim().toLowerCase();
  if (!text) return null;

  // 简单 fingerprint：用 text 长度 + 前100字符 + 后20字符
  const fingerprint = `${text.length}|${text.substring(0, 100)}|${text.substring(Math.max(0, text.length - 20))}`;
  return fingerprint;
}

/**
 * 标准化 Telegram API 描述字符串
 * @param {string} description - API 返回的描述
 * @returns {string} 小写化后的字符串
 */
export function normalizeTgDescription(description) {
  return (description || "").toString().toLowerCase();
}

/**
 * 判断话题是否不存在或已被删除
 * @param {string} description - Telegram API 返回的描述
 * @returns {boolean}
 */
export function isTopicMissingOrDeleted(description) {
  const desc = normalizeTgDescription(description);
  return desc.includes("thread not found") ||
    desc.includes("topic not found") ||
    desc.includes("message thread not found") ||
    desc.includes("topic deleted") ||
    desc.includes("thread deleted") ||
    desc.includes("forum topic not found") ||
    desc.includes("topic closed permanently");
}

/**
 * 判断探测消息是否因内容为空而失败
 * @param {string} description - Telegram API 返回的描述
 * @returns {boolean}
 */
export function isTestMessageInvalid(description) {
  const desc = normalizeTgDescription(description);
  return desc.includes("message text is empty") ||
    desc.includes("bad request: message text is empty");
}

/**
 * 判断文本是否为管理命令（支持带参 / 带 @bot 后缀）。
 * worker.js 私聊拦截与群内权限提示共用同一命令清单，避免两处维护漂移。
 * @param {*} text - 命令文本（如 '/menu'、'/find 词'、'/menu@bot'）
 * @returns {boolean}
 */
const ADMIN_COMMAND_PATTERN =
  /^\/(help|menu|dashboard|sysinfo|system|status|stats|rank|activity|heat|whoami|find|notes|cleanup|listwords|addword|delword|panel|info|ban|unban|close|open|mute|unmute|trust|reset|note|synccommands)(@|\s|$)/i;
export function isAdminCommandText(text) {
  return ADMIN_COMMAND_PATTERN.test(String(text ?? ''));
}

/**
 * 判断话题标题是否为「资料缺失」占位标题（'User' / 'User @xxx' / 空），
 * 命中后应尝试用最新资料修复标题。worker.js 与 admin-actions.js 共用，避免两处规则漂移。
 * 语义 = 旧 worker 规则（=== 'User' 或 /^User @/i）与旧 admin-actions 规则（=== 'User' 或 /^User(\s@|$)/i）的并集。
 * @param {*} title - 话题标题
 * @returns {boolean}
 */
export function isPlaceholderTopicTitle(title) {
  const value = String(title ?? '').trim();
  if (!value) return true;
  return value === 'User' || /^User\s@/i.test(value);
}

/**
 * 为请求 body 添加 message_thread_id 字段
 * @param {object} body - 请求体
 * @param {number|null|undefined} threadId - 话题 ID
 * @returns {object} 新的请求体
 */
export function withMessageThreadId(body, threadId) {
  if (threadId === undefined || threadId === null) return body;
  return { ...body, message_thread_id: threadId };
}

/**
 * 将 SPAM_KEYWORDS 环境变量解析为关键词数组
 * @param {string} raw - 原始环境变量值（逗号/分号/换行分隔）
 * @returns {string[]} 解析后的关键词数组
 */
export function parseSpamKeywords(raw) {
  if (!raw) return [];
  return raw.toString().trim()
    .split(/[,;，；\n]+/g)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
}

/**
 * 生成安全的验证 code（16 字节十六进制）
 * @returns {string} 32 位十六进制字符串
 */
export function generateVerifyCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 生成加密安全的随机 ID（小写字母 + 数字）。
 * 拒绝采样消除取模偏差（与 worker.js secureRandomInt 同一口径）：
 * 字节值超出 [0, limit) 均匀区间时丢弃重采，保证每个字符等概率出现。
 * @param {number} [length] - 输出长度（默认 12）
 * @returns {string}
 */
export function secureRandomId(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const limit = Math.floor(256 / chars.length) * chars.length;
  const result = [];
  const byte = new Uint8Array(1);
  const target = Math.max(1, Number(length) || 12);
  while (result.length < target) {
    crypto.getRandomValues(byte);
    if (byte[0] < limit) result.push(chars[byte[0] % chars.length]);
  }
  return result.join('');
}

/**
 * 简易节流器：同一 key 在 windowMs 窗口内只放行一次。
 * 用于管理告警等高频路径，防止故障期间告警风暴刷屏。
 * @param {{windowMs?:number}} [opts]
 * @returns {(key:string, now?:number) => boolean} 返回 true 表示本次放行
 */
export function createThrottle({ windowMs = 60000 } = {}) {
  const lastSentAt = new Map();
  return (key, now = Date.now()) => {
    const k = String(key);
    const prev = lastSentAt.get(k);
    // prev 未记录表示从未发送过，直接放行（避免窗口小于 now 起始值时的误判）
    if (prev !== undefined && now - prev < windowMs) return false;
    lastSentAt.set(k, now);
    return true;
  };
}

// --- 系统错误条目归一化（内存环形缓冲与 KV 持久化、看板展示共用同一规则） ---

/** 错误 action 文本上限 */
export const RECENT_ERROR_ACTION_MAX = 120;
/** 错误描述文本上限 */
export const RECENT_ERROR_TEXT_MAX = 500;
/** 关联 ID（userId/updateId/correlationId）上限 */
export const RECENT_ERROR_ID_MAX = 120;

/**
 * 归一化系统错误条目：截断超长字段、过滤非对象输入。
 * worker.js（recordSystemError）与 admin-commands.js（错误看板）共用，
 * 避免两处各自实现同一套截断规则导致展示漂移。
 * @param {object} item - 原始条目 {ts, action, error, userId?, updateId?, correlationId?}
 * @returns {object|null} 归一化条目；非对象输入返回 null
 */
export function normalizeRecentErrorItem(item) {
  if (!item || typeof item !== 'object') return null;
  const text = (value, maxLength, fallback = '') => {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    return String(value).slice(0, maxLength);
  };
  const id = (value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const valueText = String(value).slice(0, RECENT_ERROR_ID_MAX);
    return valueText || undefined;
  };
  const ts = Number(item.ts);
  const entry = {
    ts: Number.isFinite(ts) ? ts : 0,
    action: text(item.action, RECENT_ERROR_ACTION_MAX, 'unknown'),
    error: text(item.error, RECENT_ERROR_TEXT_MAX),
  };
  for (const key of ['userId', 'updateId', 'correlationId']) {
    const value = id(item[key]);
    if (value !== undefined) entry[key] = value;
  }
  return entry;
}
