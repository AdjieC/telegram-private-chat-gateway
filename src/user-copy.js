/**
 * 用户侧与管理侧常用文案（非验证类；验证见 verify-copy.js）
 */

/** 编辑通知正文单侧截断上限：两侧合计须低于 Telegram 4096 字符消息上限 */
export const EDIT_SNIPPET_LIMIT = 1500;

/** 展示用截断：超出上限时保留前段并追加省略号 */
export function truncateText(text, limit = EDIT_SNIPPET_LIMIT) {
  const s = String(text ?? '');
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

/** 策略原因码 → 管理员可读中文（未知码保留原值便于排障） */
export const POLICY_REASON_LABELS = {
  blocked_keyword: '命中屏蔽词或规则',
  blocked_keyword_notify_only: '命中规则（仅通知）',
  auto_reply: '规则自动回复',
  banned: '用户已封禁',
  closed: '会话已关闭',
  verification_required: '需要重新验证',
};

export function policyReasonLabel(reason) {
  return POLICY_REASON_LABELS[reason] || String(reason || 'unknown');
}

const CALLBACK_BUSY_COPY = {
  ban: '正在封禁…',
  banok: '正在封禁…',
  close: '正在关闭…',
  closeok: '正在关闭…',
  reset: '正在重置…',
  resetok: '正在重置…',
};

export const USER_COPY = {
  /** 消息发送限流（minutes 由调用方按 RATE_LIMIT_WINDOW 换算，与验证限流口径一致，防文案漂移） */
  rateLimited(minutes) {
    return `⚠️ 发送过于频繁，本次消息未送达，请约 ${minutes} 分钟后再试。`;
  },
  systemBusy: '⚠️ 系统繁忙，请稍后再试。',
  bannedHourly:
    '🚫 您已被管理员封禁，暂时无法继续发送消息。如有疑问请等待管理员处理。',
  mutedHourly:
    '🔇 您当前处于静音状态，消息不会送达管理员。请等待管理员取消静音。',
  blockedWord:
    '🚫 您的消息包含违规内容，已被拦截。请修改后重新发送。',
  conversationClosed:
    '🚫 当前对话已被管理员关闭。如需继续，请等待管理员重新打开。',
  pendingDelivered(count) {
    return `📩 刚才的 <b>${count}</b> 条消息已帮您送达管理员。`;
  },
  muteUserNotify: '🔇 您已被管理员静音，消息暂时不会送达管理员。',
  unmuteUserNotify: '🔊 您的静音已取消，可以继续联系管理员。',
  banUserNotify:
    '🚫 您已被管理员封禁，暂时无法继续发送消息。如有疑问请等待管理员处理。',
  unbanUserNotify: '✅ 您已被管理员解封，可以继续发送消息了。',
  /** 管理员修改回复后发给用户的编辑通知（纯文本，内容来自消息快照，单侧截断防超长） */
  adminEditedReply(original, updated) {
    return `✏️ 管理员修改了回复\n原内容：${truncateText(original)}\n新内容：${truncateText(updated)}`;
  },
};

export const ADMIN_COPY = {
  spamIntercepted(userId, reasonText, { threadId } = {}) {
    const locateHint = threadId
      ? '已发送到该用户话题，可在本话题内使用 <b>/panel</b> 操作。'
      : '该用户尚无话题，可用 <code>/find UID</code> 定位。';
    return [
      '⚠️ <b>检测到疑似骚扰消息</b>',
      '',
      `👤 用户: <code>${userId}</code>`,
      reasonText,
      '',
      `📝 消息已拦截。${locateHint}`,
    ].join('\n');
  },
  forwardTotalFail(userId, threadId, fwdDesc, copyDesc) {
    return [
      '⚠️ <b>消息转发完全失败</b>',
      '',
      `👤 用户: <code>${userId}</code>`,
      `📝 话题: <code>${threadId}</code>`,
      `❌ forwardMessage: <code>${fwdDesc || 'unknown'}</code>`,
      `❌ copyMessage: <code>${copyDesc || 'unknown'}</code>`,
    ].join('\n');
  },
  wordUsageAdd: '⚠️ 用法: <code>/addword 屏蔽词</code>',
  wordUsageDel: '⚠️ 用法: <code>/delword 屏蔽词</code>',
  wordExists(word) {
    return `⚠️ 屏蔽词「${word}」已存在。`;
  },
  wordAdded(word, count) {
    return `✅ 已添加屏蔽词「${word}」\n当前动态词库共 <b>${count}</b> 个词`;
  },
  wordHardcoded(word) {
    return `⚠️「${word}」是硬编码屏蔽词，无法通过命令删除，请直接修改代码中的 BLOCKED_WORDS。`;
  },
  wordMissing(word) {
    return `⚠️ 屏蔽词「${word}」不存在于动态词库中。`;
  },
  wordDeleted(word, count) {
    return `✅ 已删除屏蔽词「${word}」\n当前动态词库共 <b>${count}</b> 个词`;
  },
  /** 用户编辑消息被策略拦截后发给管理员的提示（纯文本，reason 为策略原因标识） */
  userEditBlocked(reason) {
    return `🚫 用户编辑已拦截：${policyReasonLabel(reason)}`;
  },
  /** 用户编辑消息后发给管理员的变更通知（纯文本，内容来自消息快照，单侧截断防超长） */
  userEditedMessage(original, updated) {
    return `✏️ 用户修改了消息\n原内容：${truncateText(original)}\n新内容：${truncateText(updated)}`;
  },
  /** 群内状态操作反馈（HTML） */
  mutedInGroup: '🔇 <b>已静音</b>：用户消息不再转发到本群',
  unmutedInGroup: '🔊 <b>已取消静音</b>',
  noteEmpty: '📝 暂无备注。用法: <code>/note 内容</code>',
  noteCleared: '✅ 备注已清除',
  noteSaved(content) {
    return `✅ 备注已保存：\n${content}`;
  },
  noteView(existing) {
    return `📝 <b>当前备注</b>\n${existing}\n\n用法: <code>/note 新备注</code>（发 <code>/note clear</code> 清空）`;
  },
  conversationClosedInGroup: '🚫 <b>对话已强制关闭</b>',
  conversationOpenedInGroup: '✅ <b>对话已恢复</b>',
  verificationReset: '🔄 <b>验证重置</b>（已取消永久信任，下次需重新验证）',
  trusted: '🌟 <b>已设置永久信任</b>',
  bannedInGroup: '🚫 <b>用户已封禁</b>（已尝试通知对方）',
  unbannedInGroup: '✅ <b>用户已解封</b>（已尝试通知对方）',
  banNotifyFailed(desc) {
    return `⚠️ 已封禁，但通知用户失败（可能对方未私聊过机器人或已拉黑）：${desc}`;
  },
  /** 批量清理流程提示（HTML） */
  cleanupBusy: '⏳ <b>已有清理任务正在运行，请稍后再试。</b>',
  cleanupScanning: '🔄 <b>正在扫描需要清理的用户...</b>',
  cleanupFailed(msg) {
    return `❌ <b>清理过程出错</b>\n\n错误信息: <code>${msg}</code>`;
  },
  /** 管理 UI 回调 toast 与通用错误提示 */
  cbNoPermission: '无权限',
  cbUpdated: '已更新',
  cbCleanupStarted: '开始清理',
  cbCancelled: '已取消',
  cleanupCancelled: '已取消清理。',
  cbUnknownNav: '未知导航',
  cbInvalidUserId: '无效用户 ID',
  cbNoUserTopic: '找不到用户话题',
  cbUnknownAction: '未知操作',
  cbUnknownCallback: '未知回调',
  callbackBusy(action) {
    return CALLBACK_BUSY_COPY[action] || '处理中…';
  },
  cbOperationFailed: '操作失败，请重试',
  kvNotBoundNotes: '❌ KV 未绑定，无法搜索备注',
  d1NotBoundFind: '❌ D1 未绑定，无法搜索',
  notesSearchFailed(msg) {
    return `❌ 备注搜索失败: ${msg}`;
  },
  searchFailed(msg) {
    return `❌ 搜索失败: ${msg}`;
  },
  /** v1:* 资料卡回调与后台菜单文案 */
  adminMenuTitle: '管理后台',
  cbInvalidOperation: '无效操作',
  userNotFound: '用户不存在',
  processed: '已处理',
  backendConnected: '后台连接正常',
  permissionExpired: '权限已失效',
};
