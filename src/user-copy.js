/**
 * 用户侧与管理侧常用文案（非验证类；验证见 verify-copy.js）
 */

export const USER_COPY = {
  rateLimited: '⚠️ 发送过于频繁，请稍后再试。',
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
};

export const ADMIN_COPY = {
  spamIntercepted(userId, reasonText) {
    return [
      '⚠️ <b>检测到疑似骚扰消息</b>',
      '',
      `👤 用户: <code>${userId}</code>`,
      reasonText,
      '',
      '📝 消息已拦截。可在用户话题内使用面板 <b>封禁</b>。',
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
};
