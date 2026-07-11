import { describe, expect, it, vi } from 'vitest';
import { createMaintenanceService } from '../../src/maintenance-service.js';

describe('维护服务', () => {
  it('按 7/30/90 天清理且不删除用户', async () => {
    const storage = { cleanupRetention: vi.fn().mockResolvedValue({ updates: 2, links: 3, audits: 4 }) };
    const service = createMaintenanceService({ storage });
    await expect(service.runRetentionCleanup(100 * 86400000)).resolves.toEqual({
      processedUpdates: 2, messageLinks: 3, adminAudits: 4,
    });
    expect(storage.cleanupRetention).toHaveBeenCalledWith(expect.objectContaining({
      updatesBefore: 93 * 86400000,
      linksBefore: 70 * 86400000,
      auditsBefore: 10 * 86400000,
    }));
  });
});
