import { describe, it, expect } from 'vitest';
import { createMockD1 } from '../helpers/mock-d1.js';
import { ensureMigrations } from '../../src/storage/migrations.js';
import { createD1Storage } from '../../src/storage/d1-storage.js';

describe('D1 system stats', () => {
  it('汇总用户与最近对话信息', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    await storage.upsertUser({
      userId: '1',
      username: 'alice',
      firstName: 'Alice',
      topicId: '10',
      lastMessageAt: 1000,
    });
    await storage.upsertUser({
      userId: '2',
      username: 'bob',
      firstName: 'Bob',
      topicId: '20',
      status: 'banned',
      lastMessageAt: 5000,
    });
    await storage.upsertUser({
      userId: '3',
      firstName: 'Carol',
      lastMessageAt: 3000,
    });

    const stats = await storage.getSystemStats();
    expect(stats.usersTotal).toBe(3);
    expect(stats.usersWithTopic).toBe(2);
    expect(stats.usersBanned).toBe(1);
    expect(stats.lastActiveUser).toMatchObject({
      userId: '2',
      username: 'bob',
      firstName: 'Bob',
      lastMessageAt: 5000,
    });
    expect(stats.recentActiveUsers?.map(u => u.userId)).toEqual(['2', '3', '1']);
  });

  it('searchUsers 支持 UID 与用户名', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    await storage.upsertUser({ userId: '99', username: 'findme', firstName: 'Find' });
    await expect(storage.searchUsers('99')).resolves.toHaveLength(1);
    await expect(storage.searchUsers('findme')).resolves.toEqual([
      expect.objectContaining({ userId: '99', username: 'findme' }),
    ]);
  });

  it('searchUsers 将 _ 与 % 视为字面量而非通配符', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    await storage.upsertUser({ userId: '10', username: 'a_b', firstName: '甲' });
    await storage.upsertUser({ userId: '11', username: 'axb', firstName: '乙' });

    // 搜索含下划线的用户名：只命中字面量 a_b，不因 _ 通配误匹配 axb
    const hits = await storage.searchUsers('a_b');
    expect(hits.map(u => u.userId)).toEqual(['10']);

    // 搜索含百分号的用户名：% 视为字面量
    await storage.upsertUser({ userId: '12', username: 'rate100%', firstName: '丙' });
    const percentHits = await storage.searchUsers('rate100%');
    expect(percentHits.map(u => u.userId)).toEqual(['12']);
  });

  it('活跃查询：since 用户与入站 message_links 行', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    const day = Date.UTC(2026, 6, 11, 0, 0, 0);
    await storage.upsertUser({
      userId: '10', username: 'hot', firstName: 'Hot', topicId: '1', lastMessageAt: day + 1000,
    });
    await storage.upsertUser({
      userId: '11', username: 'old', firstName: 'Old', lastMessageAt: day - 86400_000,
    });
    await storage.saveMessageLink({
      direction: 'user_to_admin',
      sourceChatId: '10',
      sourceMessageId: '1',
      targetChatId: '-100',
      targetMessageId: '100',
      topicId: '1',
      userId: '10',
      createdAt: day + 3600_000,
    });
    await storage.saveMessageLink({
      direction: 'user_to_admin',
      sourceChatId: '10',
      sourceMessageId: '2',
      targetChatId: '-100',
      targetMessageId: '101',
      topicId: '1',
      userId: '10',
      createdAt: day + 2 * 3600_000,
    });
    await storage.saveMessageLink({
      direction: 'admin_to_user',
      sourceChatId: '-100',
      sourceMessageId: '9',
      targetChatId: '10',
      targetMessageId: '3',
      topicId: '1',
      userId: '10',
      createdAt: day + 3 * 3600_000,
    });

    const active = await storage.getUsersActiveSince(day, 10);
    expect(active.map(u => u.userId)).toEqual(['10']);

    const rows = await storage.getInboundMessageRows(day, 100);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.userId === '10')).toBe(true);

    const map = await storage.getUsersByIds(['10', 'missing']);
    expect(map.get('10')?.username).toBe('hot');
    expect(map.has('missing')).toBe(false);
  });

  it('getUsersByIds 空列表返回空 Map，超限去重后按 30 个上限查询', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);

    await expect(storage.getUsersByIds([])).resolves.toEqual(new Map());

    // 预置 0/29/30 三个用户，验证前 30 个被查询、第 31 个被截断
    await storage.upsertUser({ userId: '0', username: 'u0' });
    await storage.upsertUser({ userId: '29', username: 'u29' });
    await storage.upsertUser({ userId: '30', username: 'u30' });

    // 超限 + 重复：只保留去重后的前 30 个，查询不报错
    const ids = Array.from({ length: 40 }, (_, i) => String(i));
    ids.push('0'); // 重复项
    const map = await storage.getUsersByIds(ids);
    expect(map.size).toBeLessThanOrEqual(30);
    expect(map.get('0')?.username).toBe('u0');
    expect(map.get('29')?.username).toBe('u29');
    expect(map.has('30')).toBe(false);
  });

  it('保留期清理边界：恰好等于阈值的记录保留，早于阈值删除', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    const now = 100 * 86400_000;

    // 恰好等于阈值（保留）与超过阈值（删除）各一条
    await storage.claimUpdate('kept', 'message', now - 7 * 86400_000);
    await storage.claimUpdate('old', 'message', now - 8 * 86400_000);
    await storage.saveMessageLink({
      direction: 'u2a', sourceChatId: '1', sourceMessageId: '1',
      targetChatId: '2', targetMessageId: '3', userId: '9',
      createdAt: now - 30 * 86400_000,
    });
    await storage.saveMessageLink({
      direction: 'u2a', sourceChatId: '1', sourceMessageId: '2',
      targetChatId: '2', targetMessageId: '4', userId: '9',
      createdAt: now - 31 * 86400_000,
    });

    const result = await storage.cleanupRetention({
      updatesBefore: now - 7 * 86400_000,
      linksBefore: now - 30 * 86400_000,
      auditsBefore: now - 90 * 86400_000,
    });

    expect(result.updates).toBe(1);
    expect(result.links).toBe(1);
    expect(await storage.getProcessedUpdate('kept')).toBeTruthy();
    expect(await storage.getProcessedUpdate('old')).toBeNull();
  });
});

describe('D1 migrations', () => {
  it('迁移重复执行不会重复应用版本', async () => {
    const db = createMockD1();

    await ensureMigrations(db, 1000);
    await ensureMigrations(db, 2000);

    expect(db._table('schema_migrations')).toHaveLength(1);
    expect(db._table('schema_migrations')[0]).toMatchObject({
      version: 1,
      name: 'initial_schema',
      applied_at: 1000,
    });
  });

  it('初始迁移创建全部长期状态表', async () => {
    const db = createMockD1();

    await ensureMigrations(db, 1000);

    expect(db._tableNames()).toEqual(expect.arrayContaining([
      'schema_migrations',
      'users',
      'processed_updates',
      'message_links',
      'rules',
      'settings',
      'admin_users',
      'admin_audit_log',
    ]));
  });

  it('初始迁移创建查询和清理所需索引', async () => {
    const db = createMockD1();

    await ensureMigrations(db, 1000);

    expect(db._indexNames()).toEqual(expect.arrayContaining([
      'idx_users_topic_id',
      'idx_users_status',
      'idx_users_last_message_at',
      'idx_rules_type_enabled_priority',
      'idx_processed_updates_claimed_at',
      'idx_message_links_created_at',
      'idx_admin_audit_created_at',
    ]));
  });
});

describe('D1 storage 实例边界', () => {
  it('同一 D1 绑定复用 storage，不同绑定保持隔离', () => {
    const firstDb = createMockD1();
    const secondDb = createMockD1();

    expect(createD1Storage(firstDb)).toBe(createD1Storage(firstDb));
    expect(createD1Storage(firstDb)).not.toBe(createD1Storage(secondDb));
  });

  it('缺少 D1 绑定时实际读取会明确失败', async () => {
    const storage = createD1Storage(undefined);

    await expect(storage.getUser('1')).rejects.toThrow();
  });
});

describe('D1 管理员与审计', () => {
  it('保存管理员角色并记录不含消息正文的审计数据', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    await storage.upsertAdminUser({ userId: '1', role: 'operator', enabled: true, grantedBy: 'owner' });
    await storage.appendAudit({
      id: 'audit-1',
      adminId: 'owner',
      action: 'admin.grant',
      resourceType: 'admin',
      resourceId: '1',
      beforeState: null,
      afterState: { role: 'operator' },
      createdAt: 2000,
    });
    await expect(storage.getAdminUser('1')).resolves.toMatchObject({ role: 'operator', enabled: true });
    expect(db._table('admin_audit_log')[0]).toMatchObject({ action: 'admin.grant', resource_id: '1' });
  });
});

describe('D1 用户并发安全', () => {
  it('重复确保用户存在时不覆盖已有 Topic 和状态', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    await storage.upsertUser({ userId: '1', topicId: '88', status: 'banned' });

    await storage.ensureUser({ userId: '1', firstName: 'Alice' });

    await expect(storage.getUser('1')).resolves.toMatchObject({
      topicId: '88',
      status: 'banned',
    });
  });

  it('资料字段更新不覆盖并发写入的封禁状态', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    await storage.upsertUser({ userId: '1', status: 'active' });
    const originalPrepare = db.prepare.bind(db);
    let injected = false;
    db.prepare = sql => {
      const statement = originalPrepare(sql);
      if (!injected && /^\s*SELECT \* FROM users WHERE user_id/i.test(String(sql))) {
        return {
          bind(...values) {
            const bound = statement.bind(...values);
            return {
              async first() {
                const row = await bound.first();
                db._table('users')[0].status = 'banned';
                injected = true;
                return row;
              },
            };
          },
        };
      }
      if (!injected && /UPDATE users[\s\S]*first_name = \?/i.test(String(sql))) {
        return {
          bind(...values) {
            const bound = statement.bind(...values);
            return {
              async run() {
                db._table('users')[0].status = 'banned';
                injected = true;
                return bound.run();
              },
            };
          },
        };
      }
      return statement;
    };

    await storage.updateUserState('1', { firstName: 'Alice' });

    await expect(storage.getUser('1')).resolves.toMatchObject({
      firstName: 'Alice',
      status: 'banned',
    });
  });
});

describe('D1 保留期清理', () => {
  it('只删除过期幂等、消息映射和审计，不删除用户', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    await storage.upsertUser({ userId: '1' });
    db._table('processed_updates').push(
      { update_id: 'old', claimed_at: 10 },
      { update_id: 'new', claimed_at: 100 },
    );
    db._table('message_links').push(
      { direction: 'x', source_chat_id: '1', source_message_id: '1', created_at: 10 },
      { direction: 'x', source_chat_id: '1', source_message_id: '2', created_at: 100 },
    );
    db._table('admin_audit_log').push(
      { id: 'old', created_at: 10 },
      { id: 'new', created_at: 100 },
    );

    await expect(storage.cleanupRetention({
      updatesBefore: 50,
      linksBefore: 50,
      auditsBefore: 50,
    })).resolves.toEqual({ updates: 1, links: 1, audits: 1 });
    expect(db._table('users')).toHaveLength(1);
    expect(db._table('processed_updates')).toHaveLength(1);
    expect(db._table('message_links')).toHaveLength(1);
    expect(db._table('admin_audit_log')).toHaveLength(1);
  });
});
