/**
 * admin-actions 管理动作命令测试：用户状态操作、词库管理、批量清理。
 * 直接调用 createAdminActions 工厂，注入 mock 依赖。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminActions } from '../../src/admin-actions.js';
import { SEP_LINE, formatTimeBoth, formatUserStatusChips } from '../../src/admin-ui-format.js';
import { escapeHtml as escapeHtmlValue } from '../../src/utils.js';
import { createD1Storage } from '../../src/storage/d1-storage.js';
import { ensureMigrations } from '../../src/storage/migrations.js';
import { createMockEnv } from '../helpers/mock-env.js';

function createActions(overrides = {}) {
  const calls = [];
  const keyboardStates = [];
  const env = createMockEnv();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const config = {
    CLEANUP_LOCK_TTL_SECONDS: 1800,
    CLEANUP_BATCH_SIZE: 10,
    MAX_CLEANUP_DISPLAY: 20,
    WORD_MAX_LENGTH: 50,
  };
  const actions = createAdminActions({
    tgCall: async (_env, method, body) => {
      calls.push({ method, body });
      return { ok: true, result: { message_id: 1 } };
    },
    safeGetJSON: async (e, key, fallback = null) => {
      const raw = await e.TOPIC_MAP.get(key);
      if (!raw) return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    },
    escapeHtml: (s) => String(s),
    SEP_LINE,
    formatTimeBoth,
    formatUserStatusChips,
    buildUserActionKeyboard: (userId, state) => {
      keyboardStates.push({ userId, state });
      return { inline_keyboard: [] };
    },
    createD1Storage,
    setPersistentTrust: vi.fn(async () => {}),
    getVerificationState: vi.fn(async () => null),
    resolveUserFromForTopic: vi.fn(async (_e, userId) => ({
      id: Number(userId), first_name: '测试', last_name: '', username: '',
    })),
    buildTopicTitle: vi.fn(() => '测试用户'),
    bumpDailyStat: vi.fn(async () => {}),
    probeForumThread: vi.fn(async () => ({ status: 'ok' })),
    config,
    logger,
    recordSystemError: vi.fn(),
    ...overrides,
  });
  return { actions, calls, env, logger, config, keyboardStates };
}

describe('admin-actions 管理动作', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ban 写入 KV+D1、计数并通知用户', async () => {
    const { actions, calls, env } = createActions();
    const db = createD1Storage(env.TG_BOT_DB);
    await db.upsertUser({ userId: '42', status: 'active' });

    await actions.ban(env, 1, 42);

    expect(await env.TOPIC_MAP.get('banned:42')).toBe('1');
    expect(await db.getUser('42')).toMatchObject({ status: 'banned' });
    const notify = calls.find(c => c.method === 'sendMessage' && c.body.chat_id === 42);
    expect(notify.body.text).toContain('封禁');
    const groupMsg = calls.find(c => c.method === 'sendMessage' && c.body.chat_id === env.SUPERGROUP_ID);
    expect(groupMsg.body.text).toContain('已封禁');
  });

  it('封禁通知失败的动态描述只转义一次', async () => {
    const description = '<bad & reason>';
    const { actions, calls, env } = createActions({
      escapeHtml: escapeHtmlValue,
      tgCall: async (_env, method, body) => {
        calls.push({ method, body });
        if (body.chat_id === 42) return { ok: false, description };
        return { ok: true, result: { message_id: 1 } };
      },
    });

    await actions.ban(env, 1, 42);

    const failure = calls.find(call => (
      call.method === 'sendMessage'
      && call.body.chat_id === env.SUPERGROUP_ID
      && String(call.body.text).includes('通知用户失败')
    ));
    expect(failure.body.text).toContain('&lt;bad &amp; reason&gt;');
    expect(failure.body.text).not.toContain('&amp;lt;');
  });

  it('unban 清除封禁标记并恢复 D1 状态', async () => {
    const { actions, calls, env } = createActions();
    const db = createD1Storage(env.TG_BOT_DB);
    await db.upsertUser({ userId: '42', status: 'banned' });
    await env.TOPIC_MAP.put('banned:42', '1');
    await env.TOPIC_MAP.put('ban_notice:42', '1', { expirationTtl: 3600 });

    await actions.unban(env, 1, 42);

    expect(await env.TOPIC_MAP.get('banned:42')).toBe(null);
    expect(await env.TOPIC_MAP.get('ban_notice:42')).toBe(null);
    expect(await db.getUser('42')).toMatchObject({ status: 'active' });
    expect(calls.some(c => c.method === 'sendMessage' && c.body.chat_id === 42)).toBe(true);
  });

  it('mute/unmute 切换 KV 标记与 D1 静音状态', async () => {
    const { actions, env } = createActions();
    const db = createD1Storage(env.TG_BOT_DB);
    await db.upsertUser({ userId: '42', status: 'active' });

    await actions.mute(env, 1, 42);
    expect(await env.TOPIC_MAP.get('muted:42')).toBe('1');
    expect(await db.getUser('42')).toMatchObject({ isMuted: true });

    await actions.unmute(env, 1, 42);
    expect(await env.TOPIC_MAP.get('muted:42')).toBe(null);
    expect(await db.getUser('42')).toMatchObject({ isMuted: false });
  });

  it('close/open 更新 KV 记录并调用论坛开关', async () => {
    const { actions, calls, env } = createActions();
    await env.TOPIC_MAP.put('user:42', JSON.stringify({ thread_id: 88, title: '测试' }));

    await actions.close(env, 88, 42);
    let rec = JSON.parse(await env.TOPIC_MAP.get('user:42'));
    expect(rec.closed).toBe(true);
    expect(calls.some(c => c.method === 'closeForumTopic')).toBe(true);

    await actions.open(env, 88, 42);
    rec = JSON.parse(await env.TOPIC_MAP.get('user:42'));
    expect(rec.closed).toBe(false);
    expect(calls.some(c => c.method === 'reopenForumTopic')).toBe(true);
  });

  it('trust/reset 调用 setPersistentTrust 并给出确认文案', async () => {
    const { actions, calls, env } = createActions();

    await actions.trust(env, 1, 42);
    await actions.reset(env, 1, 42);

    const texts = calls.filter(c => c.method === 'sendMessage').map(c => c.body.text);
    expect(texts.some(t => t.includes('永久信任'))).toBe(true);
    expect(texts.some(t => t.includes('验证重置'))).toBe(true);
  });

  it('note 保存/读取/清除备注', async () => {
    const { actions, calls, env } = createActions();

    await actions.note(env, 1, 42, '/note 重要客户');
    expect(await env.TOPIC_MAP.get('note:42')).toBe('重要客户');

    // 无参数时读取已有备注
    calls.length = 0;
    await actions.note(env, 1, 42, '/note');
    expect(calls.find(c => c.method === 'sendMessage').body.text).toContain('当前备注');

    // clear 清除
    await actions.note(env, 1, 42, '/note clear');
    expect(await env.TOPIC_MAP.get('note:42')).toBe(null);
  });

  it('note 超长内容截断到 500 字符，防 KV 备注被撑爆', async () => {
    const { actions, env } = createActions();
    await actions.note(env, 1, 43, `/note ${'长'.repeat(800)}`);
    const saved = await env.TOPIC_MAP.get('note:43');
    expect(saved).toHaveLength(500);
  });

  it('panel 展示用户话题标题与状态', async () => {
    const { actions, calls, env } = createActions();
    await env.TOPIC_MAP.put('user:42', JSON.stringify({ thread_id: 88, title: '测试用户', closed: false }));

    await actions.panel(env, 88, 42);

    const msg = calls.find(c => c.method === 'sendMessage');
    expect(msg.body.text).toContain('用户面板');
    expect(msg.body.text).toContain('话题: 测试用户');
    expect(msg.body.text).toContain('状态正常');
  });

  it('panel 将当前用户状态传给动态操作键盘', async () => {
    const { actions, env, keyboardStates } = createActions();
    const db = createD1Storage(env.TG_BOT_DB);
    await db.upsertUser({ userId: '42', status: 'banned', trustLevel: 'trusted' });
    await env.TOPIC_MAP.put('banned:42', '1');
    await env.TOPIC_MAP.put('muted:42', '1');
    await env.TOPIC_MAP.put('user:42', JSON.stringify({ thread_id: 88, closed: true }));

    await actions.panel(env, 88, 42);

    expect(keyboardStates.at(-1)).toEqual({
      userId: 42,
      state: {
        banned: true,
        muted: true,
        closed: true,
        trusted: true,
      },
    });
  });

  it('info 将 legacy_trusted 视为已信任并显示重置操作', async () => {
    const { actions, env, keyboardStates } = createActions({
      getVerificationState: vi.fn(async () => ({ type: 'legacy_trusted' })),
    });
    env.TG_BOT_DB = undefined;
    await env.TOPIC_MAP.put('user:42', JSON.stringify({ thread_id: 88, title: '测试用户' }));

    await actions.info(env, 88, 42);

    expect(keyboardStates.at(-1).state.trusted).toBe(true);
  });

  it('panel 并行启动互不依赖的状态读取', async () => {
    const { actions, calls, env } = createActions();
    const gatedKeys = new Set(['banned:42', 'muted:42', 'user:42', 'note:42']);
    const started = [];
    const releases = new Map();
    const originalGet = env.TOPIC_MAP.get.bind(env.TOPIC_MAP);
    env.TOPIC_MAP.get = vi.fn((key, options) => {
      if (!gatedKeys.has(key)) return originalGet(key, options);
      started.push(key);
      return new Promise((resolve) => {
        releases.set(key, () => resolve(null));
      });
    });

    const pending = actions.panel(env, 88, 42);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(started).toEqual(expect.arrayContaining([...gatedKeys]));

    for (const release of releases.values()) release();
    await pending;

    expect(calls.filter(call => call.method === 'sendMessage')).toHaveLength(1);
  });

  it('panel 的单项 KV 读取失败时仍发送可用面板', async () => {
    const { actions, calls, env, keyboardStates } = createActions();
    const originalGet = env.TOPIC_MAP.get.bind(env.TOPIC_MAP);
    env.TOPIC_MAP.get = vi.fn((key, options) => {
      if (key === 'banned:42' || key === 'note:42') {
        return Promise.reject(new Error('KV unavailable'));
      }
      return originalGet(key, options);
    });

    await expect(actions.panel(env, 88, 42)).resolves.toBeUndefined();

    const msg = calls.find(call => call.method === 'sendMessage');
    expect(msg).toBeDefined();
    expect(msg.body.text).not.toContain('undefined');
    expect(keyboardStates.at(-1).state).toMatchObject({ banned: false, muted: false });
  });

  it('panel 的 D1 用户读取失败时仍发送面板', async () => {
    const { actions, calls, env } = createActions();
    env.TG_BOT_DB = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    };

    await expect(actions.panel(env, 88, 42)).resolves.toBeUndefined();

    expect(calls.filter(call => call.method === 'sendMessage')).toHaveLength(1);
  });

  it('addWord/delWord 写 KV 词库并强制刷新缓存', async () => {
    const { actions, env } = createActions();
    await actions.addWord(env, 1, '/addword 测试词', 777);
    expect(JSON.parse(await env.TOPIC_MAP.get('blocked_words_kv'))).toEqual(['测试词']);

    await actions.delWord(env, 1, '/delword 测试词', 777);
    expect(JSON.parse(await env.TOPIC_MAP.get('blocked_words_kv'))).toEqual([]);
  });

  it('addWord 拒绝超长词，不写入词库', async () => {
    const { actions, calls, env } = createActions();
    const longWord = '超'.repeat(51);
    await actions.addWord(env, 1, `/addword ${longWord}`, 777);

    expect(await env.TOPIC_MAP.get('blocked_words_kv')).toBe(null);
    const msg = calls.find(c => c.method === 'sendMessage');
    expect(msg.body.text).toContain('词过长');
  });

  it('cleanup 仅清理话题缺失的用户记录', async () => {
    const { actions, env } = createActions({
      probeForumThread: vi.fn(async (_e, threadId) => ({
        status: threadId === 88 ? 'missing' : 'ok',
      })),
    });
    await env.TOPIC_MAP.put('user:42', JSON.stringify({ thread_id: 88, title: '失效' }));
    await env.TOPIC_MAP.put('user:43', JSON.stringify({ thread_id: 99, title: '有效' }));
    await env.TOPIC_MAP.put('thread:88', '42');
    await env.TOPIC_MAP.put('thread:99', '43');

    await actions.cleanup(1, env);

    expect(await env.TOPIC_MAP.get('user:42')).toBe(null);
    expect(await env.TOPIC_MAP.get('user:43')).not.toBe(null);
    expect(await env.TOPIC_MAP.get('thread:88')).toBe(null);
    expect(await env.TOPIC_MAP.get('cleanup:lock')).toBe(null);
  });

  it('cleanup 过程消息统一 HTML，无 Markdown 星号/反引号残留', async () => {
    const { actions, calls, env } = createActions();
    await env.TOPIC_MAP.put('user:42', JSON.stringify({ thread_id: 88, title: '失效' }));
    await env.TOPIC_MAP.put('thread:88', '42');

    await actions.cleanup(1, env);

    const cleanupMsgs = calls.filter(c => c.method === 'sendMessage');
    expect(cleanupMsgs.length).toBeGreaterThanOrEqual(2);
    for (const m of cleanupMsgs) {
      expect(m.body.parse_mode).toBe('HTML');
      expect(String(m.body.text)).not.toMatch(/\*\*|`/);
    }
    // 报告包含统计行
    const report = cleanupMsgs.map(m => m.body.text).join('\n');
    expect(report).toContain('清理完成');
    expect(report).toContain('已清理');
  });
});
