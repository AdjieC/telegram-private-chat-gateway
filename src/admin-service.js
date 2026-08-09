import { validateRuleInput } from './message-policy.js';
import { ADMIN_COPY } from './user-copy.js';

const ROLE_PERMISSIONS = {
  owner: new Set(['*']),
  operator: new Set([
    'admin.menu',
    'user.view',
    'user.reply',
    'user.ban',
    'user.mute',
    'user.close',
    'user.trust',
  ]),
  rules_manager: new Set(['admin.menu', 'rule.view', 'rule.create', 'rule.update', 'rule.delete']),
};

const USER_CALLBACK_ACTIONS = {
  trust: 'user.trust',
  ban: 'user.ban',
  close: 'user.close',
  mute: 'user.mute',
};

function buildAdminMenu() {
  return {
    inline_keyboard: [
      [{ text: '检查后台连接', callback_data: 'v1:admin:status' }],
    ],
  };
}

export function createAdminService({
  storage,
  ephemeralStore,
  telegram,
  ownerIds = [],
  randomId = () => crypto.randomUUID(),
  now = Date.now,
  onRulesChanged = () => {},
}) {
  const owners = new Set(ownerIds.map(String));

  async function authorize(adminId, action) {
    if (owners.has(String(adminId))) return true;
    const admin = await storage.getAdminUser?.(adminId);
    if (!admin?.enabled) return false;
    const permissions = ROLE_PERMISSIONS[admin.role];
    return Boolean(permissions?.has('*') || permissions?.has(action));
  }

  async function handlePrivateAdminMessage(message) {
    const adminId = message.from?.id;
    if (!adminId || !(await authorize(adminId, 'admin.menu'))) {
      return { status: 'unauthorized' };
    }
    const text = (message.text || '').trim();
    if (text === '/cancel') {
      await ephemeralStore?.clearAdminState?.(adminId);
      return { status: 'cancelled' };
    }
    if (text !== '/start') return { status: 'ignored' };
    await telegram.call('sendMessage', {
      chat_id: message.chat.id,
      text: ADMIN_COPY.adminMenuTitle,
      reply_markup: buildAdminMenu(),
    });
    return { status: 'menu' };
  }

  async function handleCallbackQuery(query) {
    const adminId = query.from?.id;
    const parts = String(query.data || '').split(':');
    let permission = null;
    let resourceId = null;
    if (parts.length === 3 && parts[0] === 'v1' && parts[1] === 'admin' && parts[2] === 'status') {
      permission = 'admin.menu';
    } else if (
      parts.length === 4
      && parts[0] === 'v1'
      && parts[1] === 'user'
      && /^\d{1,20}$/.test(parts[3])
    ) {
      permission = USER_CALLBACK_ACTIONS[parts[2]] || null;
      resourceId = parts[3];
    }

    if (!permission) {
      await telegram.call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: ADMIN_COPY.cbInvalidOperation,
        show_alert: true,
      });
      return { status: 'invalid' };
    }

    const allowed = adminId && await authorize(adminId, permission);
    let before = null;
    if (allowed && resourceId) {
      before = await storage.getUser(resourceId);
      if (!before) {
        await telegram.call('answerCallbackQuery', {
          callback_query_id: query.id,
          text: ADMIN_COPY.userNotFound,
          show_alert: true,
        });
        return { status: 'missing_user' };
      }
      const action = parts[2];
      const changes = action === 'trust'
        ? { trustLevel: before.trustLevel === 'trusted' ? 'normal' : 'trusted' }
        : action === 'ban'
          ? { status: before.status === 'banned' ? 'active' : 'banned' }
          : action === 'close'
            ? { status: before.status === 'closed' ? 'active' : 'closed' }
            : { isMuted: !before.isMuted };
      const after = await storage.updateUserState(resourceId, changes);
      await storage.appendAudit?.({
        id: randomId(),
        adminId: String(adminId),
        action: permission,
        resourceType: 'user',
        resourceId,
        beforeState: before,
        afterState: after,
        createdAt: now(),
      });
    }
    const responseText = resourceId
      ? ADMIN_COPY.v1ActionResult(parts[2], before)
      : ADMIN_COPY.backendConnected;
    await telegram.call('answerCallbackQuery', {
      callback_query_id: query.id,
      text: allowed ? responseText : ADMIN_COPY.permissionExpired,
      show_alert: !allowed,
    });
    return { status: allowed ? 'handled' : 'unauthorized' };
  }

  async function createRule(adminId, rule) {
    if (!(await authorize(adminId, 'rule.create'))) throw new Error('Forbidden');
    validateRuleInput(rule);
    const created = {
      ...rule,
      ruleId: rule.ruleId || randomId(),
      enabled: rule.enabled !== false,
      createdBy: String(adminId),
      createdAt: now(),
      updatedAt: now(),
    };
    await storage.upsertRule(created);
    onRulesChanged();
    return created;
  }

  async function listRules(adminId, offset = 0, limit = 20) {
    if (!(await authorize(adminId, 'rule.view'))) throw new Error('Forbidden');
    return storage.listRules(offset, limit);
  }

  async function deleteRule(adminId, ruleId) {
    if (!(await authorize(adminId, 'rule.delete'))) throw new Error('Forbidden');
    const deleted = await storage.deleteRule(ruleId);
    if (deleted) onRulesChanged();
    return deleted;
  }

  async function setRuleEnabled(adminId, ruleId, enabled) {
    if (!(await authorize(adminId, 'rule.update'))) throw new Error('Forbidden');
    const updated = await storage.setRuleEnabled(ruleId, enabled, now());
    if (updated) onRulesChanged();
    return updated;
  }

  return {
    authorize,
    handlePrivateAdminMessage,
    handleCallbackQuery,
    createRule,
    listRules,
    deleteRule,
    setRuleEnabled,
  };
}
