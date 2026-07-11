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

  if (!MATCH_TYPES.has(matchType)) throw new Error(`unsupported matchType: ${matchType}`);
  if (!pattern) throw new Error('pattern is required');
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error('pattern must not exceed 200 characters');
  }
  if (responseText.length > MAX_RESPONSE_LENGTH) {
    throw new Error('responseText must not exceed 4000 characters');
  }
  if (ruleType && !RULE_ACTIONS[ruleType]) throw new Error(`unsupported ruleType: ${ruleType}`);
  if (ruleType && rule.action && !RULE_ACTIONS[ruleType].has(rule.action)) {
    throw new Error(`unsupported action: ${rule.action}`);
  }
  if (
    ruleType === 'auto_reply'
    && rule.action !== 'forward_only'
    && responseText.length === 0
  ) {
    throw new Error('responseText is required for auto reply');
  }

  if (matchType !== 'regex') return;
  if (hasUnsafeNestedQuantifier(pattern)) {
    throw new Error('regex contains unsafe nested quantifiers');
  }
  if (hasOverlappingQuantifiedAlternatives(pattern)) {
    throw new Error('regex contains unsafe overlapping alternatives');
  }

  let expression;
  try {
    expression = new RegExp(pattern, 'i');
  } catch {
    throw new Error('regex is invalid');
  }
  if (expression.test('')) throw new Error('regex must not match empty text');
}

export function matchRule(text, rule) {
  validateRuleInput(rule);
  const input = String(text ?? '').slice(0, MAX_INPUT_LENGTH);
  const pattern = String(rule.pattern);
  const matchType = ruleValue(rule, 'matchType', 'match_type') || 'contains';

  if (matchType === 'regex') return new RegExp(pattern, 'i').test(input);

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
