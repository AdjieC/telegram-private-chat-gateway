/**
 * 纯函数工具模块
 * 此模块不包含任何外部依赖（无 Logger、无 env、无全局状态），可直接单元测试
 */

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
