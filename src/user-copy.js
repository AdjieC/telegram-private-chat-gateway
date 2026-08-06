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
  /** 管理员修改回复后发给用户的编辑通知（纯文本，内容来自消息快照） */
  adminEditedReply(original, updated) {
    return `✏️ 管理员修改了回复\n原内容：${original}\n新内容：${updated}`;
  },
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
  /** 用户编辑消息被策略拦截后发给管理员的提示（纯文本，reason 为策略原因标识） */
  userEditBlocked(reason) {
    return `🚫 用户编辑已拦截：${reason || 'unknown'}`;
  },
  /** 用户编辑消息后发给管理员的变更通知（纯文本，内容来自消息快照） */
  userEditedMessage(original, updated) {
    return `✏️ 用户修改了消息\n原内容：${original}\n新内容：${updated}`;
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
