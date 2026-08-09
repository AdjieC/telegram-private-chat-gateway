import { extractMessageText } from './utils.js';

const MAX_PATTERN_LENGTH = 200;
const MAX_RESPONSE_LENGTH = 4000;
const MAX_INPUT_LENGTH = 5000;
const MATCH_TYPES = new Set(['contains', 'equals', 'regex']);
const RULE_ACTIONS = {
  blocked_keyword: new Set(['reject', 'silent_reject', 'count_violation', 'notify_only']),
  auto_reply: new Set(['reply_and_forward', 'reply_only', 'forward_only']),
  content_type: new Set(['reject', 'silent_reject', 'allow']),
};

// 校验结果缓存：同一「类型|模式|动作」规则只完整校验一次。
// 规则校验含正则编译与不安全嵌套量词启发式扫描（ReDoS 防护），
// 热路径上每条消息 × 每条规则重复执行成本可观；规则来自 D1 且创建时已校验，结果稳定可缓存。
const VALIDATION_CACHE_MAX = 500;
const ruleValidationCache = new Map(); // key -> true（仅缓存通过校验的规则）

// 已编译正则缓存（按 pattern 复用，避免每条消息重新 new RegExp）
const regexCache = new Map(); // pattern -> RegExp

function cacheBoundedSet(cache, key, value) {
  if (cache.size >= VALIDATION_CACHE_MAX) {
    // Map 迭代顺序为插入序，删除最早插入的条目
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
}

function getCachedRegex(pattern) {
  let re = regexCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern, 'i');
    cacheBoundedSet(regexCache, pattern, re);
  }
  return re;
}

export function classifyContentType(message = {}) {
  if (message.forward_origin || message.forward_from || message.forward_from_chat) return 'forwarded_message';
  if (message.caption && (message.photo || message.video || message.document || message.audio || message.animation)) return 'media_caption';
  if (message.text) return 'text';
  for (const type of ['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'animation', 'contact', 'location', 'poll']) {
    if (message[type]) return type;
  }
  return 'unknown';
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function ruleValue(rule, camelName, snakeName) {
  return rule?.[camelName] ?? rule?.[snakeName];
}

function hasUnsafeNestedQuantifier(pattern) {
  return /\((?:[^()\\]|\\.)*(?:[+*?]|\{\d*,?\d*\})(?:[^()\\]|\\.)*\)\s*(?:[+*?]|\{\d*,?\d*\})/.test(pattern);
}

function hasOverlappingQuantifiedAlternatives(pattern) {
  const quantifiedGroup = /\(([^()]*)\)\s*(?:[+*]|\{\d*,?\d*\})/g;
  for (const match of pattern.matchAll(quantifiedGroup)) {
    const alternatives = match[1].split('|').filter(Boolean);
    for (let leftIndex = 0; leftIndex < alternatives.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < alternatives.length; rightIndex += 1) {
        const left = alternatives[leftIndex];
        const right = alternatives[rightIndex];
        if (left.startsWith(right) || right.startsWith(left)) return true;
      }
    }
  }
  return false;
}

export function validateRuleInput(rule) {
  const matchType = ruleValue(rule, 'matchType', 'match_type') || 'contains';
  const pattern = String(rule?.pattern ?? '');
  const responseText = String(ruleValue(rule, 'responseText', 'response_text') ?? '');
  const ruleType = ruleValue(rule, 'ruleType', 'rule_type');
  const action = rule?.action;

  // 校验结果缓存：键覆盖全部校验输入，命中即视为已通过
  const cacheKey = [matchType, pattern, ruleType || '', action || '', String(responseText.length)].join('\u0000');
  if (ruleValidationCache.has(cacheKey)) return;

  if (!MATCH_TYPES.has(matchType)) throw new Error(`unsupported matchType: ${matchType}`);
  if (!pattern) throw new Error('pattern is required');
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error('pattern must not exceed 200 characters');
  }
  if (responseText.length > MAX_RESPONSE_LENGTH) {
    throw new Error('responseText must not exceed 4000 characters');
  }
  if (ruleType && !RULE_ACTIONS[ruleType]) throw new Error(`unsupported ruleType: ${ruleType}`);
  if (ruleType && action && !RULE_ACTIONS[ruleType].has(action)) {
    throw new Error(`unsupported action: ${action}`);
  }
  if (
    ruleType === 'auto_reply'
    && action !== 'forward_only'
    && responseText.length === 0
  ) {
    throw new Error('responseText is required for auto reply');
  }

  if (matchType !== 'regex') {
    cacheBoundedSet(ruleValidationCache, cacheKey, true);
    return;
  }
  if (hasUnsafeNestedQuantifier(pattern)) {
    throw new Error('regex contains unsafe nested quantifiers');
  }
  if (hasOverlappingQuantifiedAlternatives(pattern)) {
    throw new Error('regex contains unsafe overlapping alternatives');
  }

  let expression;
  try {
    expression = getCachedRegex(pattern);
  } catch {
    throw new Error('regex is invalid');
  }
  if (expression.test('')) throw new Error('regex must not match empty text');

  cacheBoundedSet(ruleValidationCache, cacheKey, true);
}

export function matchRule(text, rule) {
  validateRuleInput(rule);
  const input = String(text ?? '').slice(0, MAX_INPUT_LENGTH);
  const pattern = String(rule.pattern);
  const matchType = ruleValue(rule, 'matchType', 'match_type') || 'contains';

  if (matchType === 'regex') return getCachedRegex(pattern).test(input);

  const normalizedInput = normalizeText(input);
  const normalizedPattern = normalizeText(pattern);
  if (matchType === 'equals') return normalizedInput === normalizedPattern;
  return normalizedInput.includes(normalizedPattern);
}

function createResult(overrides = {}) {
  return {
    action: 'allow',
    reason: null,
    matchedRuleId: null,
    autoReply: null,
    shouldForward: true,
    shouldIncrementViolation: false,
    ...overrides,
  };
}

function ruleId(rule) {
  const value = ruleValue(rule, 'ruleId', 'rule_id');
  return value == null ? null : String(value);
}

/** 兼容层：将屏蔽词数组转为 legacy blocked_keyword 规则（入口与策略评估共用，避免两处构造漂移） */
export function buildLegacyBlockedRules(blockedWords) {
  return (Array.isArray(blockedWords) ? blockedWords : [])
    .filter(Boolean)
    .map((pattern, index) => ({
      ruleId: `legacy_blocked:${index}`,
      ruleType: 'blocked_keyword',
      matchType: 'contains',
      pattern,
      action: 'reject',
      priority: index,
    }));
}

function enabledRules(rules) {
  return [...(Array.isArray(rules) ? rules : [])]
    .filter(rule => rule && rule.enabled !== false && rule.enabled !== 0)
    .sort((left, right) => Number(left.priority ?? 100) - Number(right.priority ?? 100));
}

function blockedRuleResult(rule) {
  const action = rule.action || 'count_violation';
  if (action === 'silent_reject') {
    return createResult({
      action: 'silent_reject',
      reason: 'blocked_keyword',
      matchedRuleId: ruleId(rule),
      shouldForward: false,
    });
  }
  if (action === 'notify_only') {
    return createResult({
      reason: 'blocked_keyword_notify_only',
      matchedRuleId: ruleId(rule),
      autoReply: ruleValue(rule, 'responseText', 'response_text') || null,
    });
  }
  return createResult({
    action: 'reject',
    reason: 'blocked_keyword',
    matchedRuleId: ruleId(rule),
    shouldForward: false,
    shouldIncrementViolation: action === 'count_violation',
  });
}

function autoReplyResult(rule) {
  const action = rule.action || 'reply_and_forward';
  const autoReply = ruleValue(rule, 'responseText', 'response_text') || null;
  if (action === 'reply_only') {
    return createResult({
      action: 'auto_reply_only',
      reason: 'auto_reply',
      matchedRuleId: ruleId(rule),
      autoReply,
      shouldForward: false,
    });
  }
  return createResult({
    reason: action === 'forward_only' ? null : 'auto_reply',
    matchedRuleId: ruleId(rule),
    autoReply: action === 'forward_only' ? null : autoReply,
  });
}

export function evaluateMessagePolicy({
  message,
  user = {},
  verification = null,
  rules = [],
}) {
  if (user.status === 'banned') {
    return createResult({
      action: 'silent_reject',
      reason: 'banned',
      shouldForward: false,
    });
  }
  if (user.status === 'closed') {
    return createResult({
      action: 'reject',
      reason: 'closed',
      shouldForward: false,
    });
  }

  const text = extractMessageText(message).slice(0, MAX_INPUT_LENGTH);
  const sortedRules = enabledRules(rules);
  for (const rule of sortedRules) {
    const type = ruleValue(rule, 'ruleType', 'rule_type');
    if (type === 'blocked_keyword' && matchRule(text, rule)) {
      return blockedRuleResult(rule);
    }
  }

  if (user.trustLevel !== 'trusted' && !verification) {
    return createResult({
      action: 'require_verification',
      reason: 'verification_required',
      shouldForward: false,
    });
  }

  for (const rule of sortedRules) {
    const type = ruleValue(rule, 'ruleType', 'rule_type');
    if (type === 'auto_reply' && matchRule(text, rule)) {
      return autoReplyResult(rule);
    }
  }

  return createResult();
}
