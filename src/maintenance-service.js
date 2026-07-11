const DAY_MS = 24 * 60 * 60 * 1000;

export function createMaintenanceService({ storage }) {
  async function runRetentionCleanup(now) {
    const result = await storage.cleanupRetention({
      updatesBefore: now - 7 * DAY_MS,
      linksBefore: now - 30 * DAY_MS,
      auditsBefore: now - 90 * DAY_MS,
    });
    return {
      processedUpdates: result.updates,
      messageLinks: result.links,
      adminAudits: result.audits,
    };
  }

  return { runRetentionCleanup };
}
