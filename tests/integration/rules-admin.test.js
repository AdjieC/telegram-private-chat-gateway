import { describe, expect, it } from 'vitest';
import { createD1Storage } from '../../src/storage/d1-storage.js';
import { ensureMigrations } from '../../src/storage/migrations.js';
import { createAdminService } from '../../src/admin-service.js';
import { classifyContentType } from '../../src/message-policy.js';
import { createMockD1 } from '../helpers/mock-d1.js';

describe('规则后台', () => {
  it('创建、分页列出、禁用和删除规则', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    const service = createAdminService({ storage, ownerIds: ['1'], randomId: () => 'r1', now: () => 2000 });
    await service.createRule('1', {
      ruleType: 'auto_reply', matchType: 'contains', pattern: 'hello',
      responseText: 'world', action: 'reply_and_forward', priority: 10,
    });
    await expect(service.listRules('1', 0, 20)).resolves.toMatchObject({ total: 1 });
    await service.setRuleEnabled('1', 'r1', false);
    await expect(storage.getRule('r1')).resolves.toMatchObject({ enabled: false });
    await service.deleteRule('1', 'r1');
    await expect(storage.getRule('r1')).resolves.toBe(null);
  });

  it('拒绝不安全正则规则', async () => {
    const service = createAdminService({ storage: {}, ownerIds: ['1'] });
    await expect(service.createRule('1', {
      ruleType: 'blocked_keyword', matchType: 'regex', pattern: '(a+)+$', action: 'reject',
    })).rejects.toThrow('unsafe nested quantifiers');
  });

  it('分页总数来自独立 COUNT 查询而不是当前页长度', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    for (let index = 0; index < 21; index += 1) {
      await storage.upsertRule({
        ruleId: `r${index}`, ruleType: 'blocked_keyword', matchType: 'contains',
        pattern: `p${index}`, action: 'reject', priority: index,
      });
    }
    await expect(storage.listRules(20, 20)).resolves.toMatchObject({
      total: 21,
      items: [expect.objectContaining({ ruleId: 'r20' })],
    });
  });

  it('策略加载返回全部启用规则且不受后台分页大小限制', async () => {
    const db = createMockD1();
    await ensureMigrations(db, 1000);
    const storage = createD1Storage(db);
    for (let index = 0; index < 101; index += 1) {
      await storage.upsertRule({
        ruleId: `r${index}`, ruleType: 'blocked_keyword', matchType: 'contains',
        pattern: `p${index}`, action: 'reject', priority: index,
      });
    }
    await storage.upsertRule({
      ruleId: 'disabled', ruleType: 'blocked_keyword', matchType: 'contains',
      pattern: 'disabled', action: 'reject', priority: 999, enabled: false,
    });

    const rules = await storage.listEnabledRules();

    expect(rules).toHaveLength(101);
    expect(rules.at(-1)).toMatchObject({ ruleId: 'r100' });
    expect(rules.some(rule => rule.ruleId === 'disabled')).toBe(false);
  });
});

describe('内容类型识别', () => {
  it('识别媒体 Caption、转发来源和未知类型', () => {
    expect(classifyContentType({ photo: [{}], caption: 'x' })).toBe('media_caption');
    expect(classifyContentType({ text: 'x', forward_origin: {} })).toBe('forwarded_message');
    expect(classifyContentType({ dice: {} })).toBe('unknown');
  });
});
