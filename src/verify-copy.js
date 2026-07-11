/**
 * 用户侧人机验证文案（统一口径，纯常量）
 */

export const VERIFY_COPY = {
  /** Turnstile 私聊提示 */
  turnstileChallenge:
    '🛡 <b>人机验证</b>\n\n请点击下方按钮完成验证。\n通过后您刚才的消息会自动送达管理员。',

  /** 本地题库提示 */
  quizChallenge(question) {
    return `🛡 <b>人机验证</b>\n\n${question}\n\n请点击下方按钮作答；答对后消息会自动送达。`;
  },

  buttonTurnstile: '🔐 点击验证',

  /** callback toast / alert */
  expired: '❌ 验证已过期，请重新发一条消息',
  dataError: '❌ 验证数据异常，请重新发消息',
  invalidUser: '❌ 验证无效，请重新发消息',
  invalidOption: '❌ 无效选项',
  wrongAnswer: '❌ 回答错误，请再试一次',
  successToast: '✅ 验证通过',
  systemError: '⚠️ 系统繁忙，请稍后重试',

  /** 编辑/私聊成功正文 */
  successBody:
    '✅ <b>验证成功</b>\n\n您现在可以正常对话了。直接发消息即可联系管理员。',
  successBodyWithPending:
    '✅ <b>验证成功</b>\n\n正在为您送达刚才的消息，请稍候…',

  /** 答错时在题目下追加的提示（编辑消息用） */
  wrongAnswerHint: '\n\n⚠️ 回答不正确，请再选一次。链接未过期前可继续尝试。',
};
