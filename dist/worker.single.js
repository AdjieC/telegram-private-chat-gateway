// src/config.js
var KNOWN_ENV_KEYS = Object.freeze([
  "BOT_TOKEN",
  "WEBHOOK_SECRET",
  "SUPERGROUP_ID",
  "OWNER_IDS",
  "ADMIN_IDS",
  "SPAM_KEYWORDS",
  "API_BASE",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "VERIFICATION_PAGE_URL",
  "TOPIC_MAP",
  "TG_BOT_DB"
]);
var STRING_ENV_KEYS = Object.freeze([
  "BOT_TOKEN",
  "WEBHOOK_SECRET",
  "SUPERGROUP_ID",
  "OWNER_IDS",
  "ADMIN_IDS",
  "SPAM_KEYWORDS",
  "API_BASE",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "VERIFICATION_PAGE_URL"
]);
function listEnvKeys(env = {}) {
  try {
    return Object.keys(env);
  } catch {
    return [];
  }
}
function readEnvValue(env, key) {
  if (env == null) return void 0;
  if (Object.prototype.hasOwnProperty.call(env, key) || env[key] !== void 0) {
    const direct = env[key];
    if (direct !== void 0 && direct !== null) {
      if (typeof direct !== "string" || direct.trim().length > 0) {
        return direct;
      }
    }
  }
  const target = String(key);
  for (const actual of listEnvKeys(env)) {
    if (actual !== key && actual.trim() === target) {
      return env[actual];
    }
  }
  return env[key];
}
function normalizeEnv(env = {}) {
  const normalized = { ...env };
  for (const key of STRING_ENV_KEYS) {
    const value = readEnvValue(env, key);
    normalized[key] = value === void 0 || value === null ? "" : String(value).trim();
  }
  for (const key of ["TOPIC_MAP", "TG_BOT_DB"]) {
    const value = readEnvValue(env, key);
    if (value !== void 0 && value !== null) {
      normalized[key] = value;
    }
  }
  return normalized;
}
function describeBindingShape(value) {
  if (value === void 0 || value === null) {
    return { present: false, jsType: "nullish" };
  }
  const jsType = typeof value;
  if (jsType === "string") {
    return {
      present: value.trim().length > 0,
      jsType: "string",
      // 字符串说明多半是 Text/Secret 变量，不是 D1/KV Binding
      looksLikeBinding: false,
      hasPrepare: false,
      hasGet: false,
      hasPut: false
    };
  }
  if (jsType !== "object" && jsType !== "function") {
    return { present: true, jsType, looksLikeBinding: false };
  }
  return {
    present: true,
    jsType: "object",
    looksLikeBinding: true,
    hasPrepare: typeof value.prepare === "function",
    hasBatch: typeof value.batch === "function",
    hasGet: typeof value.get === "function",
    hasPut: typeof value.put === "function"
  };
}
function inspectEnvPresence(env = {}) {
  const presence = {};
  for (const key of KNOWN_ENV_KEYS) {
    const value = readEnvValue(env, key);
    if (value === void 0 || value === null) {
      presence[key] = false;
    } else if (typeof value === "string") {
      presence[key] = value.trim().length > 0;
    } else {
      presence[key] = true;
    }
  }
  const keys = listEnvKeys(env).sort();
  const mistypedKeys = keys.filter((name) => {
    const trimmed = name.trim();
    return name !== trimmed && KNOWN_ENV_KEYS.includes(trimmed);
  });
  const bindings = {
    TOPIC_MAP: describeBindingShape(readEnvValue(env, "TOPIC_MAP")),
    TG_BOT_DB: describeBindingShape(readEnvValue(env, "TG_BOT_DB"))
  };
  return { presence, keys, mistypedKeys, bindings };
}
function formatEnvPresenceDetail(env = {}) {
  const { presence, keys, mistypedKeys, bindings } = inspectEnvPresence(env);
  const present = Object.entries(presence).filter(([, ok]) => ok).map(([name]) => name);
  const missing = Object.entries(presence).filter(([, ok]) => !ok).map(([name]) => name);
  const mistyped = mistypedKeys.length ? ` | mistypedKeys=${mistypedKeys.map((k) => JSON.stringify(k)).join(",")}` : "";
  const d1 = bindings?.TG_BOT_DB;
  const kv = bindings?.TOPIC_MAP;
  const bindingHint = ` | d1=${d1?.jsType || "none"}/prepare=${Boolean(d1?.hasPrepare)} | kv=${kv?.jsType || "none"}/get=${Boolean(kv?.hasGet)}`;
  return ` | present=${present.join(",") || "none"} | missing=${missing.join(",") || "none"} | keys=${keys.join(",") || "none"}${mistyped}${bindingHint}`;
}
function assertD1Binding(db, name = "TG_BOT_DB") {
  if (db == null) {
    throw new Error(`D1 '${name}' not bound`);
  }
  if (typeof db === "string") {
    throw new Error(
      `D1 '${name}' is a string variable, not a D1 Database binding. Delete the Text/Secret named TG_BOT_DB and add Bindings \u2192 D1 Database with variable name TG_BOT_DB.`
    );
  }
  if (typeof db.prepare !== "function") {
    throw new Error(
      `D1 '${name}' is bound but has no prepare() (got ${typeof db}). In Cloudflare Dashboard: Settings \u2192 Bindings \u2192 add D1 Database, variable name must be exactly TG_BOT_DB.`
    );
  }
  return db;
}
function validateBaseEnv(env) {
  if (!env.TOPIC_MAP) throw new Error("KV 'TOPIC_MAP' not bound");
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN not set");
  if (!env.SUPERGROUP_ID) throw new Error("SUPERGROUP_ID not set");
  if (!env.SUPERGROUP_ID.startsWith("-100")) {
    throw new Error("SUPERGROUP_ID must start with -100");
  }
}
function validateWebhookEnv(env) {
  if (!env.WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET not set");
  if (new TextEncoder().encode(env.WEBHOOK_SECRET).length < 32) {
    throw new Error("WEBHOOK_SECRET must be at least 32 bytes");
  }
}

// src/storage/migrations.js
var migrationPromises = /* @__PURE__ */ new WeakMap();
var SCHEMA_MIGRATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;
var VERSION_1_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    trust_level TEXT NOT NULL DEFAULT 'normal',
    is_muted INTEGER NOT NULL DEFAULT 0,
    violation_count INTEGER NOT NULL DEFAULT 0,
    topic_id TEXT,
    info_card_message_id TEXT,
    profile_snapshot TEXT,
    topic_lock_token TEXT,
    topic_lock_until INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_message_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS processed_updates (
    update_id TEXT PRIMARY KEY,
    update_type TEXT,
    claimed_at INTEGER NOT NULL,
    completed_at INTEGER,
    status TEXT NOT NULL DEFAULT 'processing',
    error_code TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS message_links (
    direction TEXT NOT NULL,
    source_chat_id TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    target_chat_id TEXT NOT NULL,
    target_message_id TEXT NOT NULL,
    topic_id TEXT,
    user_id TEXT NOT NULL,
    content_snapshot TEXT,
    content_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (direction, source_chat_id, source_message_id)
  )`,
  `CREATE TABLE IF NOT EXISTS rules (
    rule_id TEXT PRIMARY KEY,
    rule_type TEXT NOT NULL,
    pattern TEXT,
    response_text TEXT,
    action TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 1,
    metadata TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string',
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_users (
    user_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    granted_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    before_state TEXT,
    after_state TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_topic_id
    ON users(topic_id) WHERE topic_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`,
  `CREATE INDEX IF NOT EXISTS idx_users_last_message_at ON users(last_message_at)`,
  `CREATE INDEX IF NOT EXISTS idx_rules_type_enabled_priority
    ON rules(rule_type, enabled, priority)`,
  `CREATE INDEX IF NOT EXISTS idx_processed_updates_claimed_at
    ON processed_updates(claimed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_message_links_created_at
    ON message_links(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at
    ON admin_audit_log(created_at)`
];
async function runMigrations(db, now) {
  await db.prepare(SCHEMA_MIGRATIONS_SQL).run();
  const applied = await db.prepare(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
  ).first();
  if (Number(applied?.version ?? 0) >= 1) return;
  await db.batch(VERSION_1_STATEMENTS.map((sql) => db.prepare(sql)));
  await db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
  ).bind(1, "initial_schema", now).run();
}
function ensureMigrations(db, now = Date.now()) {
  if (!migrationPromises.has(db)) {
    const promise = runMigrations(db, now).catch((error) => {
      migrationPromises.delete(db);
      throw error;
    });
    migrationPromises.set(db, promise);
  }
  return migrationPromises.get(db);
}

// src/storage/d1-storage.js
var UPDATE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1e3;
var USER_UPDATE_COLUMNS = {
  username: "username",
  firstName: "first_name",
  lastName: "last_name",
  status: "status",
  trustLevel: "trust_level",
  isMuted: "is_muted",
  violationCount: "violation_count",
  topicId: "topic_id",
  infoCardMessageId: "info_card_message_id",
  profileSnapshot: "profile_snapshot",
  lastMessageAt: "last_message_at"
};
function storageValue(key, value) {
  if (key === "isMuted") return value ? 1 : 0;
  if (key === "violationCount") return Number(value || 0);
  if (key === "topicId" || key === "infoCardMessageId") {
    return value == null ? null : String(value);
  }
  return value ?? null;
}
function createD1Storage(db) {
  function mapUser(row) {
    if (!row) return null;
    return {
      userId: String(row.user_id),
      username: row.username ?? null,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      status: row.status,
      trustLevel: row.trust_level,
      isMuted: Boolean(row.is_muted),
      violationCount: Number(row.violation_count || 0),
      topicId: row.topic_id == null ? null : String(row.topic_id),
      infoCardMessageId: row.info_card_message_id == null ? null : String(row.info_card_message_id),
      profileSnapshot: row.profile_snapshot ?? null,
      topicLockToken: row.topic_lock_token ?? null,
      topicLockUntil: row.topic_lock_until ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at ?? null
    };
  }
  function mapRule(row) {
    if (!row) return null;
    let metadata = {};
    try {
      metadata = row.metadata ? JSON.parse(row.metadata) : {};
    } catch {
      metadata = {};
    }
    return {
      ruleId: row.rule_id,
      ruleType: row.rule_type,
      matchType: metadata.matchType || "contains",
      pattern: row.pattern,
      responseText: row.response_text,
      action: row.action,
      priority: Number(row.priority ?? 100),
      enabled: Boolean(row.enabled),
      createdBy: row.created_by
    };
  }
  const storage = {
    async getUser(userId) {
      const row = await db.prepare(`
        SELECT * FROM users WHERE user_id = ?
      `).bind(String(userId)).first();
      return mapUser(row);
    },
    async ensureUser(user) {
      const now = Date.now();
      await db.prepare(`
        INSERT OR IGNORE INTO users (
          user_id, username, first_name, last_name, status, trust_level,
          is_muted, violation_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', 'normal', 0, 0, ?, ?)
      `).bind(
        String(user.userId),
        user.username ?? null,
        user.firstName ?? null,
        user.lastName ?? null,
        user.createdAt ?? now,
        user.updatedAt ?? now
      ).run();
      return storage.getUser(user.userId);
    },
    async upsertUser(user) {
      const now = Date.now();
      await db.prepare(`
        INSERT INTO users (
          user_id, username, first_name, last_name, status, trust_level,
          is_muted, violation_count, topic_id, info_card_message_id,
          profile_snapshot, created_at, updated_at, last_message_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          status = excluded.status,
          trust_level = excluded.trust_level,
          is_muted = excluded.is_muted,
          violation_count = excluded.violation_count,
          topic_id = excluded.topic_id,
          info_card_message_id = excluded.info_card_message_id,
          profile_snapshot = excluded.profile_snapshot,
          updated_at = excluded.updated_at,
          last_message_at = excluded.last_message_at
      `).bind(
        String(user.userId),
        user.username ?? null,
        user.firstName ?? null,
        user.lastName ?? null,
        user.status ?? "active",
        user.trustLevel ?? "normal",
        user.isMuted ? 1 : 0,
        Number(user.violationCount || 0),
        user.topicId == null ? null : String(user.topicId),
        user.infoCardMessageId == null ? null : String(user.infoCardMessageId),
        user.profileSnapshot ?? null,
        user.createdAt ?? now,
        user.updatedAt ?? now,
        user.lastMessageAt ?? null
      ).run();
    },
    async findUserByTopic(topicId) {
      const row = await db.prepare(`
        SELECT * FROM users WHERE topic_id = ?
      `).bind(String(topicId)).first();
      return mapUser(row);
    },
    async updateUserState(userId, changes) {
      const entries = Object.entries(changes).filter(([key]) => USER_UPDATE_COLUMNS[key]);
      if (entries.length === 0) return storage.getUser(userId);
      const assignments = entries.map(([key]) => `${USER_UPDATE_COLUMNS[key]} = ?`);
      const values = entries.map(([key, value]) => storageValue(key, value));
      await db.prepare(`
        UPDATE users
        SET ${assignments.join(", ")}, updated_at = ?
        WHERE user_id = ?
      `).bind(...values, Date.now(), String(userId)).run();
      return storage.getUser(userId);
    },
    async acquireTopicLock(userId, token, now, ttlMs = 3e4) {
      const result = await db.prepare(`
        UPDATE users
        SET topic_lock_token = ?, topic_lock_until = ?, updated_at = ?
        WHERE user_id = ?
          AND topic_id IS NULL
          AND (
            topic_lock_token IS NULL
            OR topic_lock_until < ?
            OR topic_lock_token = ?
          )
      `).bind(token, now + ttlMs, now, String(userId), now, token).run();
      return result.meta?.changes === 1;
    },
    async releaseTopicLock(userId, token, now = Date.now()) {
      await db.prepare(`
        UPDATE users
        SET topic_lock_token = NULL, topic_lock_until = NULL, updated_at = ?
        WHERE user_id = ? AND topic_lock_token = ?
      `).bind(now, String(userId), token).run();
    },
    async setTopic(userId, topicId, token, now = Date.now()) {
      const result = await db.prepare(`
        UPDATE users
        SET topic_id = ?, topic_lock_token = NULL, topic_lock_until = NULL,
            updated_at = ?
        WHERE user_id = ? AND topic_lock_token = ?
      `).bind(String(topicId), now, String(userId), token).run();
      return result.meta?.changes === 1;
    },
    async clearTopic(userId, topicId, now = Date.now()) {
      const result = await db.prepare(`
        UPDATE users
        SET topic_id = NULL, topic_lock_token = NULL, topic_lock_until = NULL,
            updated_at = ?
        WHERE user_id = ? AND topic_id = ?
      `).bind(now, String(userId), String(topicId)).run();
      return result.meta?.changes === 1;
    },
    async saveMessageLink(link) {
      const now = link.updatedAt ?? Date.now();
      await db.prepare(`
        INSERT INTO message_links (
          direction, source_chat_id, source_message_id, target_chat_id,
          target_message_id, topic_id, user_id, content_snapshot,
          content_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(direction, source_chat_id, source_message_id) DO UPDATE SET
          target_chat_id = excluded.target_chat_id,
          target_message_id = excluded.target_message_id,
          topic_id = excluded.topic_id,
          user_id = excluded.user_id,
          content_snapshot = excluded.content_snapshot,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at
      `).bind(
        link.direction,
        String(link.sourceChatId),
        String(link.sourceMessageId),
        String(link.targetChatId),
        String(link.targetMessageId),
        link.topicId == null ? null : String(link.topicId),
        String(link.userId),
        link.contentSnapshot ?? null,
        link.contentHash ?? null,
        link.createdAt ?? now,
        now
      ).run();
    },
    async getMessageLink(direction, sourceChatId, sourceMessageId) {
      const row = await db.prepare(`
        SELECT * FROM message_links
        WHERE direction = ? AND source_chat_id = ? AND source_message_id = ?
      `).bind(direction, String(sourceChatId), String(sourceMessageId)).first();
      if (!row) return null;
      return {
        direction: row.direction,
        sourceChatId: row.source_chat_id,
        sourceMessageId: row.source_message_id,
        targetChatId: row.target_chat_id,
        targetMessageId: row.target_message_id,
        topicId: row.topic_id,
        userId: row.user_id,
        contentSnapshot: row.content_snapshot,
        contentHash: row.content_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    },
    async getAdminUser(userId) {
      const row = await db.prepare(`
        SELECT * FROM admin_users WHERE user_id = ?
      `).bind(String(userId)).first();
      return row ? {
        userId: row.user_id,
        role: row.role,
        enabled: Boolean(row.enabled),
        grantedBy: row.granted_by
      } : null;
    },
    async upsertAdminUser(admin) {
      const now = admin.updatedAt ?? Date.now();
      await db.prepare(`
        INSERT INTO admin_users (user_id, role, enabled, granted_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          role = excluded.role, enabled = excluded.enabled,
          granted_by = excluded.granted_by, updated_at = excluded.updated_at
      `).bind(
        String(admin.userId),
        admin.role,
        admin.enabled === false ? 0 : 1,
        String(admin.grantedBy),
        admin.createdAt ?? now,
        now
      ).run();
    },
    async appendAudit(entry) {
      await db.prepare(`
        INSERT INTO admin_audit_log (
          id, admin_id, action, resource_type, resource_id,
          before_state, after_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        entry.id,
        String(entry.adminId),
        entry.action,
        entry.resourceType,
        entry.resourceId == null ? null : String(entry.resourceId),
        entry.beforeState == null ? null : JSON.stringify(entry.beforeState),
        entry.afterState == null ? null : JSON.stringify(entry.afterState),
        entry.createdAt ?? Date.now()
      ).run();
    },
    async getRule(ruleId2) {
      const row = await db.prepare("SELECT * FROM rules WHERE rule_id = ?").bind(String(ruleId2)).first();
      return mapRule(row);
    },
    async upsertRule(rule) {
      await db.prepare(`INSERT INTO rules (
        rule_id, rule_type, pattern, response_text, action, priority,
        enabled, metadata, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rule_id) DO UPDATE SET rule_type=excluded.rule_type,
        pattern=excluded.pattern, response_text=excluded.response_text,
        action=excluded.action, priority=excluded.priority, enabled=excluded.enabled,
        metadata=excluded.metadata, updated_at=excluded.updated_at`).bind(
        rule.ruleId,
        rule.ruleType,
        rule.pattern ?? null,
        rule.responseText ?? null,
        rule.action,
        Number(rule.priority ?? 100),
        rule.enabled === false ? 0 : 1,
        JSON.stringify({ matchType: rule.matchType || "contains" }),
        rule.createdBy ?? null,
        rule.createdAt ?? Date.now(),
        rule.updatedAt ?? Date.now()
      ).run();
    },
    async listRules(offset = 0, limit = 20) {
      const [result, count] = await Promise.all([
        db.prepare("SELECT * FROM rules ORDER BY priority, rule_id LIMIT ? OFFSET ?").bind(limit, offset).all(),
        db.prepare("SELECT COUNT(*) AS total FROM rules").first()
      ]);
      const items = (result.results || []).map(mapRule);
      return { items, total: Number(count?.total || 0), offset, limit };
    },
    async listEnabledRules() {
      const result = await db.prepare(`
        SELECT * FROM rules
        WHERE enabled = 1
        ORDER BY priority, rule_id
      `).all();
      return (result.results || []).map(mapRule);
    },
    async deleteRule(ruleId2) {
      const result = await db.prepare("DELETE FROM rules WHERE rule_id = ?").bind(String(ruleId2)).run();
      return result.meta?.changes === 1;
    },
    async setRuleEnabled(ruleId2, enabled, updatedAt = Date.now()) {
      const result = await db.prepare("UPDATE rules SET enabled = ?, updated_at = ? WHERE rule_id = ?").bind(enabled ? 1 : 0, updatedAt, String(ruleId2)).run();
      return result.meta?.changes === 1;
    },
    async cleanupRetention({ updatesBefore, linksBefore, auditsBefore }) {
      const [updates, links, audits] = await db.batch([
        db.prepare("DELETE FROM processed_updates WHERE claimed_at < ?").bind(updatesBefore),
        db.prepare("DELETE FROM message_links WHERE created_at < ?").bind(linksBefore),
        db.prepare("DELETE FROM admin_audit_log WHERE created_at < ?").bind(auditsBefore)
      ]);
      return {
        updates: Number(updates.meta?.changes || 0),
        links: Number(links.meta?.changes || 0),
        audits: Number(audits.meta?.changes || 0)
      };
    },
    async getProcessedUpdate(updateId) {
      return db.prepare(`
        SELECT update_id, update_type, claimed_at, completed_at, status, error_code
        FROM processed_updates
        WHERE update_id = ?
      `).bind(String(updateId)).first();
    },
    async claimUpdate(updateId, updateType, now) {
      const id = String(updateId);
      const inserted = await db.prepare(`
        INSERT OR IGNORE INTO processed_updates (
          update_id, update_type, claimed_at, status
        ) VALUES (?, ?, ?, 'processing')
      `).bind(id, updateType, now).run();
      if (inserted.meta?.changes === 1) return "claimed";
      const existing = await this.getProcessedUpdate(id);
      if (!existing || existing.status === "completed") return "duplicate";
      const reclaimed = await db.prepare(`
        UPDATE processed_updates
        SET status = 'processing', claimed_at = ?, update_type = ?,
            completed_at = NULL, error_code = NULL
        WHERE update_id = ?
          AND (
            status = 'retryable'
            OR (status = 'processing' AND claimed_at < ?)
          )
      `).bind(
        now,
        updateType,
        id,
        now - UPDATE_PROCESSING_TIMEOUT_MS
      ).run();
      return reclaimed.meta?.changes === 1 ? "reclaimed" : "duplicate";
    },
    async completeUpdate(updateId, now) {
      await db.prepare(`
        UPDATE processed_updates
        SET status = 'completed', completed_at = ?, error_code = NULL
        WHERE update_id = ?
      `).bind(now, String(updateId)).run();
    },
    async markUpdateRetryable(updateId, errorCode) {
      await db.prepare(`
        UPDATE processed_updates
        SET status = 'retryable', error_code = ?
        WHERE update_id = ?
      `).bind(String(errorCode || "temporary"), String(updateId)).run();
    }
  };
  return storage;
}

// src/update-router.js
function getUpdateType(update) {
  if (update?.edited_message) return "edited_message";
  if (update?.callback_query) return "callback_query";
  if (update?.message) return "message";
  return "unsupported";
}
function createUpdateHandler({ conversation, supergroupId }) {
  return async function handleUpdate(update) {
    const editedMessage = update?.edited_message;
    if (editedMessage) {
      if (editedMessage.chat?.type === "private") {
        return conversation.handleEditedPrivateMessage(editedMessage);
      }
      if (String(editedMessage.chat?.id) === String(supergroupId)) {
        return conversation.handleEditedAdminMessage(editedMessage);
      }
      return { status: "unsupported" };
    }
    const message = update?.message;
    if (message?.chat?.type === "private") {
      return conversation.handlePrivateMessage(message);
    }
    if (message && String(message.chat?.id) === String(supergroupId)) {
      return conversation.handleAdminMessage(message);
    }
    return { status: "unsupported" };
  };
}
async function routeUpdate(update, {
  storage,
  handleUpdate,
  now = Date.now
}) {
  const updateId = update?.update_id;
  if (updateId === void 0 || updateId === null) {
    return new Response("Bad Request", { status: 400 });
  }
  let claim;
  try {
    claim = await storage.claimUpdate(updateId, getUpdateType(update), now());
  } catch (error) {
    return new Response(
      `Error: claimUpdate failed: ${error?.message || String(error)}`,
      { status: 500 }
    );
  }
  if (claim === "duplicate") return new Response("OK");
  try {
    const response = await handleUpdate(update);
    if (response instanceof Response && response.status >= 500) {
      try {
        await storage.markUpdateRetryable(updateId, `http_${response.status}`);
      } catch {
      }
      return response;
    }
    try {
      await storage.completeUpdate(updateId, now());
    } catch (error) {
      return new Response(
        `Error: completeUpdate failed: ${error?.message || String(error)}`,
        { status: 500 }
      );
    }
    return response instanceof Response ? response : new Response("OK");
  } catch (error) {
    try {
      await storage.markUpdateRetryable(updateId, error?.category || "temporary");
    } catch {
    }
    return new Response(
      `Error: handleUpdate failed: ${error?.message || String(error)}`,
      { status: 500 }
    );
  }
}

// src/maintenance-service.js
var DAY_MS = 24 * 60 * 60 * 1e3;
function createMaintenanceService({ storage }) {
  async function runRetentionCleanup(now) {
    const result = await storage.cleanupRetention({
      updatesBefore: now - 7 * DAY_MS,
      linksBefore: now - 30 * DAY_MS,
      auditsBefore: now - 90 * DAY_MS
    });
    return {
      processedUpdates: result.updates,
      messageLinks: result.links,
      adminAudits: result.audits
    };
  }
  return { runRetentionCleanup };
}

// src/app.js
var MAX_REQUEST_BODY_BYTES = 1024 * 1024;
var HttpRequestError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function readRequestBodyWithLimit(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new HttpRequestError(413, "Payload Too Large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  const maxLength = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}
async function validateTelegramWebhookRequest(request, env) {
  validateWebhookEnv(env);
  const contentType = request.headers.get("content-type") || "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new HttpRequestError(415, "Unsupported Media Type");
  }
  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!constantTimeEqual(providedSecret, env.WEBHOOK_SECRET)) {
    throw new HttpRequestError(401, "Unauthorized");
  }
  try {
    JSON.parse(await readRequestBodyWithLimit(request.clone()));
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    throw new HttpRequestError(400, "Bad Request");
  }
}
async function notFoundHandler() {
  return new Response("Not Found", { status: 404 });
}
function createApp({ handleFetch = notFoundHandler } = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        return new Response("OK");
      }
      if (request.method === "GET" && url.pathname === "/health/env") {
        const { presence, keys, mistypedKeys, bindings } = inspectEnvPresence(env);
        return Response.json({
          ok: true,
          presence,
          keys,
          mistypedKeys,
          bindings,
          note: mistypedKeys.length ? "Some variable names have leading/trailing spaces; rename them exactly (e.g. SUPERGROUP_ID)." : "values are never included; TG_BOT_DB must be a D1 Binding with prepare(), not a Text variable"
        });
      }
      if (request.method === "GET" && url.pathname === "/health/d1") {
        try {
          const shape = inspectEnvPresence(env).bindings.TG_BOT_DB;
          const db = assertD1Binding(env?.TG_BOT_DB, "TG_BOT_DB");
          await ensureMigrations(db);
          const row = await db.prepare("SELECT 1 AS ok").first();
          const version = await db.prepare(
            "SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1"
          ).first();
          return Response.json({
            ok: true,
            select1: row?.ok ?? null,
            schemaVersion: version?.version ?? null,
            schemaName: version?.name ?? null,
            binding: shape
          });
        } catch (error) {
          return Response.json({
            ok: false,
            error: error?.message || String(error),
            name: error?.name || "Error",
            binding: inspectEnvPresence(env).bindings.TG_BOT_DB
          }, { status: 500 });
        }
      }
      try {
        const normalizedEnv = normalizeEnv(env);
        if (request.method === "POST" && url.pathname !== "/") {
          try {
            await readRequestBodyWithLimit(request.clone());
          } catch (error) {
            if (error instanceof HttpRequestError) {
              return new Response(error.message, { status: error.status });
            }
            throw error;
          }
        }
        if (request.method === "POST" && url.pathname === "/") {
          try {
            await validateTelegramWebhookRequest(request, normalizedEnv);
          } catch (error) {
            if (error instanceof HttpRequestError) {
              return new Response(error.message, { status: error.status });
            }
            return new Response(`Error: ${error.message}`, { status: 500 });
          }
        }
        try {
          validateBaseEnv(normalizedEnv);
        } catch (error) {
          return new Response(
            `Error: ${error.message}${formatEnvPresenceDetail(normalizedEnv)}`,
            { status: 500 }
          );
        }
        if (request.method === "POST" && url.pathname === "/") {
          try {
            assertD1Binding(normalizedEnv.TG_BOT_DB, "TG_BOT_DB");
          } catch (error) {
            return new Response(`Error: ${error.message}`, { status: 500 });
          }
          try {
            await ensureMigrations(normalizedEnv.TG_BOT_DB);
          } catch (error) {
            return new Response(
              `Error: D1 migration failed: ${error?.message || String(error)}`,
              { status: 500 }
            );
          }
          let update;
          try {
            update = await request.clone().json();
          } catch (error) {
            return new Response("Bad Request", { status: 400 });
          }
          try {
            return await routeUpdate(update, {
              storage: createD1Storage(normalizedEnv.TG_BOT_DB),
              handleUpdate: () => handleFetch(request, normalizedEnv, ctx)
            });
          } catch (error) {
            return new Response(
              `Error: update routing failed: ${error?.message || String(error)}`,
              { status: 500 }
            );
          }
        }
        return await handleFetch(request, normalizedEnv, ctx);
      } catch (error) {
        return new Response(
          `Error: unhandled ${error?.name || "Error"}: ${error?.message || String(error)}`,
          { status: 500 }
        );
      }
    },
    async scheduled(_event, env) {
      const normalizedEnv = normalizeEnv(env);
      if (!normalizedEnv.TG_BOT_DB) throw new Error("D1 'TG_BOT_DB' not bound");
      await ensureMigrations(normalizedEnv.TG_BOT_DB);
      return createMaintenanceService({
        storage: createD1Storage(normalizedEnv.TG_BOT_DB)
      }).runRetentionCleanup(Date.now());
    }
  };
}
var defaultApp = createApp();

// src/utils.js
function extractMessageText(message) {
  if (!message || typeof message !== "object") return "";
  return [message.text, message.caption].filter((value) => typeof value === "string" && value.trim().length > 0).join(" ").trim();
}

// src/message-policy.js
var MAX_PATTERN_LENGTH = 200;
var MAX_RESPONSE_LENGTH = 4e3;
var MAX_INPUT_LENGTH = 5e3;
var MATCH_TYPES = /* @__PURE__ */ new Set(["contains", "equals", "regex"]);
var RULE_ACTIONS = {
  blocked_keyword: /* @__PURE__ */ new Set(["reject", "silent_reject", "count_violation", "notify_only"]),
  auto_reply: /* @__PURE__ */ new Set(["reply_and_forward", "reply_only", "forward_only"]),
  content_type: /* @__PURE__ */ new Set(["reject", "silent_reject", "allow"])
};
function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}
function ruleValue(rule, camelName, snakeName) {
  return rule?.[camelName] ?? rule?.[snakeName];
}
function hasUnsafeNestedQuantifier(pattern) {
  return /\((?:[^()\\]|\\.)*(?:[+*?]|\{\d*,?\d*\})(?:[^()\\]|\\.)*\)\s*(?:[+*?]|\{\d*,?\d*\})/.test(pattern);
}
function hasOverlappingQuantifiedAlternatives(pattern) {
  const quantifiedGroup = /\(([^()]*)\)\s*(?:[+*]|\{\d*,?\d*\})/g;
  for (const match of pattern.matchAll(quantifiedGroup)) {
    const alternatives = match[1].split("|").filter(Boolean);
    for (let leftIndex = 0; leftIndex < alternatives.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < alternatives.length; rightIndex += 1) {
        const left = alternatives[leftIndex];
        const right = alternatives[rightIndex];
        if (left.startsWith(right) || right.startsWith(left)) return true;
      }
    }
  }
  return false;
}
function validateRuleInput(rule) {
  const matchType = ruleValue(rule, "matchType", "match_type") || "contains";
  const pattern = String(rule?.pattern ?? "");
  const responseText = String(ruleValue(rule, "responseText", "response_text") ?? "");
  const ruleType = ruleValue(rule, "ruleType", "rule_type");
  if (!MATCH_TYPES.has(matchType)) throw new Error(`unsupported matchType: ${matchType}`);
  if (!pattern) throw new Error("pattern is required");
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error("pattern must not exceed 200 characters");
  }
  if (responseText.length > MAX_RESPONSE_LENGTH) {
    throw new Error("responseText must not exceed 4000 characters");
  }
  if (ruleType && !RULE_ACTIONS[ruleType]) throw new Error(`unsupported ruleType: ${ruleType}`);
  if (ruleType && rule.action && !RULE_ACTIONS[ruleType].has(rule.action)) {
    throw new Error(`unsupported action: ${rule.action}`);
  }
  if (ruleType === "auto_reply" && rule.action !== "forward_only" && responseText.length === 0) {
    throw new Error("responseText is required for auto reply");
  }
  if (matchType !== "regex") return;
  if (hasUnsafeNestedQuantifier(pattern)) {
    throw new Error("regex contains unsafe nested quantifiers");
  }
  if (hasOverlappingQuantifiedAlternatives(pattern)) {
    throw new Error("regex contains unsafe overlapping alternatives");
  }
  let expression;
  try {
    expression = new RegExp(pattern, "i");
  } catch {
    throw new Error("regex is invalid");
  }
  if (expression.test("")) throw new Error("regex must not match empty text");
}
function matchRule(text, rule) {
  validateRuleInput(rule);
  const input = String(text ?? "").slice(0, MAX_INPUT_LENGTH);
  const pattern = String(rule.pattern);
  const matchType = ruleValue(rule, "matchType", "match_type") || "contains";
  if (matchType === "regex") return new RegExp(pattern, "i").test(input);
  const normalizedInput = normalizeText(input);
  const normalizedPattern = normalizeText(pattern);
  if (matchType === "equals") return normalizedInput === normalizedPattern;
  return normalizedInput.includes(normalizedPattern);
}
function createResult(overrides = {}) {
  return {
    action: "allow",
    reason: null,
    matchedRuleId: null,
    autoReply: null,
    shouldForward: true,
    shouldIncrementViolation: false,
    ...overrides
  };
}
function ruleId(rule) {
  const value = ruleValue(rule, "ruleId", "rule_id");
  return value == null ? null : String(value);
}
function enabledRules(rules) {
  return [...Array.isArray(rules) ? rules : []].filter((rule) => rule && rule.enabled !== false && rule.enabled !== 0).sort((left, right) => Number(left.priority ?? 100) - Number(right.priority ?? 100));
}
function blockedRuleResult(rule) {
  const action = rule.action || "count_violation";
  if (action === "silent_reject") {
    return createResult({
      action: "silent_reject",
      reason: "blocked_keyword",
      matchedRuleId: ruleId(rule),
      shouldForward: false
    });
  }
  if (action === "notify_only") {
    return createResult({
      reason: "blocked_keyword_notify_only",
      matchedRuleId: ruleId(rule),
      autoReply: ruleValue(rule, "responseText", "response_text") || null
    });
  }
  return createResult({
    action: "reject",
    reason: "blocked_keyword",
    matchedRuleId: ruleId(rule),
    shouldForward: false,
    shouldIncrementViolation: action === "count_violation"
  });
}
function autoReplyResult(rule) {
  const action = rule.action || "reply_and_forward";
  const autoReply = ruleValue(rule, "responseText", "response_text") || null;
  if (action === "reply_only") {
    return createResult({
      action: "auto_reply_only",
      reason: "auto_reply",
      matchedRuleId: ruleId(rule),
      autoReply,
      shouldForward: false
    });
  }
  return createResult({
    reason: action === "forward_only" ? null : "auto_reply",
    matchedRuleId: ruleId(rule),
    autoReply: action === "forward_only" ? null : autoReply
  });
}
function evaluateMessagePolicy({
  message,
  user = {},
  verification = null,
  rules = []
}) {
  if (user.status === "banned") {
    return createResult({
      action: "silent_reject",
      reason: "banned",
      shouldForward: false
    });
  }
  if (user.status === "closed") {
    return createResult({
      action: "reject",
      reason: "closed",
      shouldForward: false
    });
  }
  const text = extractMessageText(message).slice(0, MAX_INPUT_LENGTH);
  const sortedRules = enabledRules(rules);
  for (const rule of sortedRules) {
    const type = ruleValue(rule, "ruleType", "rule_type");
    if (type === "blocked_keyword" && matchRule(text, rule)) {
      return blockedRuleResult(rule);
    }
  }
  if (user.trustLevel !== "trusted" && !verification) {
    return createResult({
      action: "require_verification",
      reason: "verification_required",
      shouldForward: false
    });
  }
  for (const rule of sortedRules) {
    const type = ruleValue(rule, "ruleType", "rule_type");
    if (type === "auto_reply" && matchRule(text, rule)) {
      return autoReplyResult(rule);
    }
  }
  return createResult();
}

// src/admin-service.js
var ROLE_PERMISSIONS = {
  owner: /* @__PURE__ */ new Set(["*"]),
  operator: /* @__PURE__ */ new Set([
    "admin.menu",
    "user.view",
    "user.reply",
    "user.ban",
    "user.mute",
    "user.close",
    "user.trust"
  ]),
  rules_manager: /* @__PURE__ */ new Set(["admin.menu", "rule.view", "rule.create", "rule.update", "rule.delete"])
};
var USER_CALLBACK_ACTIONS = {
  trust: "user.trust",
  ban: "user.ban",
  close: "user.close",
  mute: "user.mute"
};
function buildAdminMenu() {
  return {
    inline_keyboard: [
      [{ text: "\u68C0\u67E5\u540E\u53F0\u8FDE\u63A5", callback_data: "v1:admin:status" }]
    ]
  };
}
function createAdminService({
  storage,
  ephemeralStore: ephemeralStore2,
  telegram,
  ownerIds = [],
  randomId = () => crypto.randomUUID(),
  now = Date.now,
  onRulesChanged = () => {
  }
}) {
  const owners = new Set(ownerIds.map(String));
  async function authorize(adminId, action) {
    if (owners.has(String(adminId))) return true;
    const admin = await storage.getAdminUser?.(adminId);
    if (!admin?.enabled) return false;
    const permissions = ROLE_PERMISSIONS[admin.role];
    return Boolean(permissions?.has("*") || permissions?.has(action));
  }
  async function handlePrivateAdminMessage(message) {
    const adminId = message.from?.id;
    if (!adminId || !await authorize(adminId, "admin.menu")) {
      return { status: "unauthorized" };
    }
    const text = (message.text || "").trim();
    if (text === "/cancel") {
      await ephemeralStore2?.clearAdminState?.(adminId);
      return { status: "cancelled" };
    }
    if (text !== "/start") return { status: "ignored" };
    await telegram.call("sendMessage", {
      chat_id: message.chat.id,
      text: "\u7BA1\u7406\u540E\u53F0",
      reply_markup: buildAdminMenu()
    });
    return { status: "menu" };
  }
  async function handleCallbackQuery2(query) {
    const adminId = query.from?.id;
    const parts = String(query.data || "").split(":");
    let permission = null;
    let resourceId = null;
    if (parts.length === 3 && parts[0] === "v1" && parts[1] === "admin" && parts[2] === "status") {
      permission = "admin.menu";
    } else if (parts.length === 4 && parts[0] === "v1" && parts[1] === "user" && /^\d{1,20}$/.test(parts[3])) {
      permission = USER_CALLBACK_ACTIONS[parts[2]] || null;
      resourceId = parts[3];
    }
    if (!permission) {
      await telegram.call("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "\u65E0\u6548\u64CD\u4F5C",
        show_alert: true
      });
      return { status: "invalid" };
    }
    const allowed = adminId && await authorize(adminId, permission);
    if (allowed && resourceId) {
      const before = await storage.getUser(resourceId);
      if (!before) {
        await telegram.call("answerCallbackQuery", {
          callback_query_id: query.id,
          text: "\u7528\u6237\u4E0D\u5B58\u5728",
          show_alert: true
        });
        return { status: "missing_user" };
      }
      const action = parts[2];
      const changes = action === "trust" ? { trustLevel: before.trustLevel === "trusted" ? "normal" : "trusted" } : action === "ban" ? { status: before.status === "banned" ? "active" : "banned" } : action === "close" ? { status: before.status === "closed" ? "active" : "closed" } : { isMuted: !before.isMuted };
      const after = await storage.updateUserState(resourceId, changes);
      await storage.appendAudit?.({
        id: randomId(),
        adminId: String(adminId),
        action: permission,
        resourceType: "user",
        resourceId,
        beforeState: before,
        afterState: after,
        createdAt: now()
      });
    }
    const responseText = resourceId ? "\u5DF2\u5904\u7406" : "\u540E\u53F0\u8FDE\u63A5\u6B63\u5E38";
    await telegram.call("answerCallbackQuery", {
      callback_query_id: query.id,
      text: allowed ? responseText : "\u6743\u9650\u5DF2\u5931\u6548",
      show_alert: !allowed
    });
    return { status: allowed ? "handled" : "unauthorized" };
  }
  async function createRule(adminId, rule) {
    if (!await authorize(adminId, "rule.create")) throw new Error("Forbidden");
    validateRuleInput(rule);
    const created = {
      ...rule,
      ruleId: rule.ruleId || randomId(),
      enabled: rule.enabled !== false,
      createdBy: String(adminId),
      createdAt: now(),
      updatedAt: now()
    };
    await storage.upsertRule(created);
    onRulesChanged();
    return created;
  }
  async function listRules(adminId, offset = 0, limit = 20) {
    if (!await authorize(adminId, "rule.view")) throw new Error("Forbidden");
    return storage.listRules(offset, limit);
  }
  async function deleteRule(adminId, ruleId2) {
    if (!await authorize(adminId, "rule.delete")) throw new Error("Forbidden");
    const deleted = await storage.deleteRule(ruleId2);
    if (deleted) onRulesChanged();
    return deleted;
  }
  async function setRuleEnabled(adminId, ruleId2, enabled) {
    if (!await authorize(adminId, "rule.update")) throw new Error("Forbidden");
    const updated = await storage.setRuleEnabled(ruleId2, enabled, now());
    if (updated) onRulesChanged();
    return updated;
  }
  return {
    authorize,
    handlePrivateAdminMessage,
    handleCallbackQuery: handleCallbackQuery2,
    createRule,
    listRules,
    deleteRule,
    setRuleEnabled
  };
}

// src/conversation-service.js
var SNAPSHOT_LIMIT = 5e3;
var TOPIC_LOCK_TTL_MS = 3e4;
var TOPIC_TITLE_LIMIT = 128;
var TOPIC_UPDATE_INTERVAL_MS = 60 * 60 * 1e3;
function cleanProfileText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}
function buildTopicTitle(user) {
  const userId = cleanProfileText(user.userId) || "unknown";
  const username = cleanProfileText(user.username).replace(/[^\w]/g, "");
  const displayName = cleanProfileText(
    [user.firstName, user.lastName].filter(Boolean).join(" ")
  ) || "User";
  const suffix = `${username ? ` \xB7 @${username}` : ""} \xB7 ${userId}`;
  return `${displayName.slice(0, Math.max(0, TOPIC_TITLE_LIMIT - suffix.length))}${suffix}`;
}
function buildProfileCard(user) {
  const status = user.status === "banned" ? "\u5DF2\u5C01\u7981" : user.status === "closed" ? "\u5DF2\u5173\u95ED" : "\u6B63\u5E38";
  const trust = user.trustLevel === "trusted" ? "\u6C38\u4E45\u4FE1\u4EFB" : "\u666E\u901A";
  const muted = user.isMuted ? "\u5DF2\u9759\u97F3" : "\u672A\u9759\u97F3";
  const username = user.username ? `@${user.username}` : "\u65E0";
  return {
    text: [
      "\u{1F464} \u7528\u6237\u8D44\u6599",
      `UID: ${user.userId}`,
      `\u7528\u6237\u540D: ${username}`,
      `\u59D3\u540D: ${cleanProfileText([user.firstName, user.lastName].filter(Boolean).join(" ")) || "\u672A\u77E5"}`,
      `\u4F1A\u8BDD\u72B6\u6001: ${status}`,
      `\u4FE1\u4EFB\u72B6\u6001: ${trust}`,
      `\u9759\u97F3\u72B6\u6001: ${muted}`,
      `\u8FDD\u89C4\u6B21\u6570: ${Number(user.violationCount || 0)}`
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "\u4FE1\u4EFB/\u53D6\u6D88", callback_data: `v1:user:trust:${user.userId}` },
          { text: "\u5C01\u7981/\u89E3\u5C01", callback_data: `v1:user:ban:${user.userId}` }
        ],
        [
          { text: "\u5173\u95ED/\u6253\u5F00", callback_data: `v1:user:close:${user.userId}` },
          { text: "\u9759\u97F3/\u53D6\u6D88", callback_data: `v1:user:mute:${user.userId}` }
        ]
      ]
    }
  };
}
async function syncUserProfile(user, {
  storage,
  telegram,
  logger,
  now = Date.now,
  supergroupId
}) {
  try {
    let previous = {};
    try {
      previous = user.profileSnapshot ? JSON.parse(user.profileSnapshot) : {};
    } catch {
      previous = {};
    }
    const profile = {
      username: user.username ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null
    };
    const profileChanged = JSON.stringify(previous.profile || null) !== JSON.stringify(profile);
    if (!profileChanged && user.infoCardMessageId) return { status: "unchanged" };
    const titleUpdateDue = user.topicId && profileChanged && (!previous.titleUpdatedAt || now() - previous.titleUpdatedAt >= TOPIC_UPDATE_INTERVAL_MS);
    if (titleUpdateDue) {
      await telegram.call("editForumTopic", {
        chat_id: supergroupId,
        message_thread_id: user.topicId,
        name: buildTopicTitle(user)
      });
    }
    const card = buildProfileCard(user);
    let infoCardMessageId = user.infoCardMessageId;
    if (user.topicId && !infoCardMessageId) {
      const response = await telegram.call("sendMessage", {
        chat_id: supergroupId,
        message_thread_id: user.topicId,
        text: card.text,
        reply_markup: card.replyMarkup
      });
      infoCardMessageId = telegramResultValue(response, "message_id") ?? null;
    } else if (user.topicId && infoCardMessageId && profileChanged) {
      await telegram.call("editMessageText", {
        chat_id: supergroupId,
        message_id: infoCardMessageId,
        text: card.text,
        reply_markup: card.replyMarkup
      });
    }
    await storage.updateUserState(user.userId, {
      username: profile.username,
      firstName: profile.firstName,
      lastName: profile.lastName,
      infoCardMessageId,
      profileSnapshot: JSON.stringify({
        profile,
        titleUpdatedAt: titleUpdateDue ? now() : previous.titleUpdatedAt ?? null
      })
    });
    return { status: "synced" };
  } catch (error) {
    logger?.warn?.("profile_sync_failed", {
      userId: user.userId,
      error: error?.message || "unknown"
    });
    return { status: "failed" };
  }
}
function snapshotMessage(message) {
  return extractMessageText(message).slice(0, SNAPSHOT_LIMIT);
}
function hashContent(content) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
function telegramResultValue(response, key) {
  return response?.result?.[key] ?? response?.[key];
}
function createRetryableError(message, category) {
  return Object.assign(new Error(message), { category, retryable: true });
}
function createConversationService({
  storage,
  telegram,
  policy,
  logger,
  now = Date.now,
  randomId = () => crypto.randomUUID(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  supergroupId,
  syncProfiles = true
}) {
  async function evaluate(message, user) {
    return policy ? policy({ message, user }) : {
      action: "allow",
      reason: null,
      shouldForward: true,
      shouldIncrementViolation: false
    };
  }
  async function ensureUser(message) {
    const userId = String(message.from?.id ?? message.chat?.id);
    const existing = await storage.getUser(userId);
    if (existing) return existing;
    const user = {
      userId,
      username: message.from?.username ?? null,
      firstName: message.from?.first_name ?? null,
      lastName: message.from?.last_name ?? null,
      status: "active",
      trustLevel: "normal"
    };
    if (storage.ensureUser) return storage.ensureUser(user);
    await storage.upsertUser(user);
    return storage.getUser(userId);
  }
  async function createTopic2(user, token) {
    const response = await telegram.call("createForumTopic", {
      chat_id: supergroupId,
      name: buildTopicTitle(user)
    });
    const topicId = telegramResultValue(response, "message_thread_id");
    if (topicId == null) throw createRetryableError("createForumTopic missing topic id", "temporary");
    const saved = await storage.setTopic(user.userId, topicId, token, now());
    if (!saved) throw createRetryableError("topic lock ownership lost", "topic_lock_lost");
    return String(topicId);
  }
  async function getOrCreateTopic(user) {
    const current = await storage.getUser(user.userId);
    if (current?.topicId) return current.topicId;
    const token = randomId();
    const acquired = await storage.acquireTopicLock(
      user.userId,
      token,
      now(),
      TOPIC_LOCK_TTL_MS
    );
    if (acquired) {
      try {
        return await createTopic2(current || user, token);
      } finally {
        await storage.releaseTopicLock(user.userId, token, now());
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(150 + attempt * 75);
      const refreshed = await storage.getUser(user.userId);
      if (refreshed?.topicId) return refreshed.topicId;
    }
    throw createRetryableError("topic creation is locked", "topic_lock_busy");
  }
  async function saveLink({ direction, message, response, userId, topicId, targetChatId }) {
    const contentSnapshot = snapshotMessage(message);
    await storage.saveMessageLink({
      direction,
      sourceChatId: message.chat.id,
      sourceMessageId: message.message_id,
      targetChatId,
      targetMessageId: telegramResultValue(response, "message_id"),
      topicId,
      userId,
      contentSnapshot,
      contentHash: hashContent(contentSnapshot),
      createdAt: now(),
      updatedAt: now()
    });
  }
  async function copyPrivateMessage(message, user, topicId) {
    try {
      const response = await telegram.call("copyMessage", {
        chat_id: supergroupId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
        message_thread_id: topicId
      });
      await saveLink({
        direction: "user_to_admin",
        message,
        response,
        userId: user.userId,
        topicId,
        targetChatId: supergroupId
      });
      return { status: "forwarded", topicId };
    } catch (error) {
      if (error?.category !== "topic_missing") throw error;
      await storage.clearTopic(user.userId, topicId, now());
      const replacementTopicId = await getOrCreateTopic(user);
      return copyPrivateMessage(message, user, replacementTopicId);
    }
  }
  async function handlePrivateMessage2(message) {
    const user = await ensureUser(message);
    const policyResult = await evaluate(message, user);
    if (!policyResult.shouldForward) {
      return { status: policyResult.action, reason: policyResult.reason };
    }
    const topicId = await getOrCreateTopic(user);
    if (syncProfiles) {
      await syncUserProfile({
        ...user,
        topicId,
        username: message.from?.username ?? user.username,
        firstName: message.from?.first_name ?? user.firstName,
        lastName: message.from?.last_name ?? user.lastName
      }, {
        storage,
        telegram,
        logger,
        now,
        supergroupId
      });
    }
    return copyPrivateMessage(message, user, topicId);
  }
  async function handleAdminMessage(message) {
    const user = await storage.findUserByTopic(message.message_thread_id);
    if (!user) return { status: "missing_user" };
    const response = await telegram.call("copyMessage", {
      chat_id: user.userId,
      from_chat_id: message.chat.id,
      message_id: message.message_id
    });
    await saveLink({
      direction: "admin_to_user",
      message,
      response,
      userId: user.userId,
      topicId: user.topicId,
      targetChatId: user.userId
    });
    return { status: "forwarded" };
  }
  async function updateLinkSnapshot(link, message, contentSnapshot) {
    await storage.saveMessageLink({
      ...link,
      contentSnapshot,
      contentHash: hashContent(contentSnapshot),
      updatedAt: now()
    });
  }
  async function handleEditedPrivateMessage(message) {
    const link = await storage.getMessageLink(
      "user_to_admin",
      message.chat.id,
      message.message_id
    );
    if (!link) return { status: "missing_link" };
    const user = await storage.getUser(link.userId);
    const policyResult = await evaluate(message, user || { userId: link.userId });
    if (!policyResult.shouldForward) {
      await telegram.call("sendMessage", {
        chat_id: link.targetChatId,
        message_thread_id: link.topicId,
        text: `\u{1F6AB} \u7528\u6237\u7F16\u8F91\u5DF2\u62E6\u622A\uFF1A${policyResult.reason || policyResult.action}`
      });
      return { status: "blocked", reason: policyResult.reason };
    }
    const contentSnapshot = snapshotMessage(message);
    if (hashContent(contentSnapshot) === link.contentHash) return { status: "unchanged" };
    await telegram.call("sendMessage", {
      chat_id: link.targetChatId,
      message_thread_id: link.topicId,
      text: `\u270F\uFE0F \u7528\u6237\u4FEE\u6539\u4E86\u6D88\u606F
\u539F\u5185\u5BB9\uFF1A${link.contentSnapshot || "(\u7A7A)"}
\u65B0\u5185\u5BB9\uFF1A${contentSnapshot || "(\u7A7A)"}`
    });
    await updateLinkSnapshot(link, message, contentSnapshot);
    return { status: "notified" };
  }
  async function handleEditedAdminMessage(message) {
    const link = await storage.getMessageLink(
      "admin_to_user",
      message.chat.id,
      message.message_id
    );
    if (!link) return { status: "missing_link" };
    const contentSnapshot = snapshotMessage(message);
    if (hashContent(contentSnapshot) === link.contentHash) return { status: "unchanged" };
    await telegram.call("sendMessage", {
      chat_id: link.userId,
      text: `\u270F\uFE0F \u7BA1\u7406\u5458\u4FEE\u6539\u4E86\u56DE\u590D
\u539F\u5185\u5BB9\uFF1A${link.contentSnapshot || "(\u7A7A)"}
\u65B0\u5185\u5BB9\uFF1A${contentSnapshot || "(\u7A7A)"}`
    });
    await updateLinkSnapshot(link, message, contentSnapshot);
    return { status: "notified" };
  }
  return {
    handlePrivateMessage: handlePrivateMessage2,
    handleAdminMessage,
    handleEditedPrivateMessage,
    handleEditedAdminMessage
  };
}

// src/logger.js
var REDACTED_KEYS = /* @__PURE__ */ new Set([
  "BOT_TOKEN",
  "TURNSTILE_SECRET_KEY",
  "WEBHOOK_SECRET",
  "botToken",
  "turnstileToken",
  "webhookSecret",
  "verifyCode",
  "verifyId",
  "text",
  "caption"
]);
function redactValue(key, value, seen) {
  if (REDACTED_KEYS.has(key)) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((item) => redactValue("", item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const redacted = Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childKey, childValue, seen)
      ])
    );
    seen.delete(value);
    return redacted;
  }
  return value;
}
function redactLogData(data = {}) {
  return redactValue("", data, /* @__PURE__ */ new WeakSet());
}
function createLogger(baseContext = {}, sink = console) {
  function emit(level, action, data = {}) {
    const method = level.toLowerCase();
    const log = redactLogData({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      action,
      ...baseContext,
      ...data
    });
    const output = JSON.stringify(log);
    (sink[method] || sink.log).call(sink, output);
  }
  return {
    info(action, data = {}) {
      emit("INFO", action, data);
    },
    warn(action, data = {}) {
      emit("WARN", action, data);
    },
    error(action, error, data = {}) {
      emit("ERROR", action, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0,
        ...data
      });
    },
    debug(action, data = {}) {
      emit("DEBUG", action, data);
    }
  };
}

// src/telegram-client.js
var DEFAULT_API_BASE = "https://api.telegram.org";
var API_BASE_WHITELIST = /* @__PURE__ */ new Set([
  DEFAULT_API_BASE,
  "https://api.telegram.dev"
]);
var DEFAULT_SLEEP = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var TelegramApiError = class extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TelegramApiError";
    Object.assign(this, details);
  }
};
function classifyTelegramError({ status, description = "", retryAfter }) {
  const normalized = String(description).toLowerCase();
  if (status === 429) {
    return { category: "rate_limited", retryable: true, retryAfter };
  }
  if (status >= 500) return { category: "server_error", retryable: true };
  if (status === 401) return { category: "unauthorized", retryable: false };
  if (status === 403) {
    const category = normalized.includes("bot was blocked by the user") ? "user_unreachable" : "forbidden";
    return { category, retryable: false };
  }
  if (normalized.includes("thread not found") || normalized.includes("topic not found") || normalized.includes("message thread not found") || normalized.includes("topic deleted")) {
    return { category: "topic_missing", retryable: false };
  }
  return { category: "invalid_request", retryable: false };
}
function resolveApiBase(apiBase, logger) {
  if (!apiBase || API_BASE_WHITELIST.has(apiBase)) {
    return apiBase || DEFAULT_API_BASE;
  }
  logger?.warn?.("api_base_rejected", { attemptedBase: apiBase });
  return DEFAULT_API_BASE;
}
function retryDelay(attempt, random) {
  const base = attempt === 1 ? 250 : 750;
  const jitter = attempt === 1 ? 250 : 750;
  return base + Math.floor(random() * jitter);
}
function createTelegramClient({
  botToken,
  apiBase,
  fetchImpl = fetch,
  sleep = DEFAULT_SLEEP,
  random = Math.random,
  timeoutMs = 8e3,
  maxTotalMs = 2e4,
  logger
} = {}) {
  const base = resolveApiBase(apiBase, logger);
  return {
    async call(method, body) {
      const startedAt = Date.now();
      let attempt = 0;
      while (attempt < 3) {
        attempt += 1;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(`${base}/bot${botToken}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          let result;
          try {
            result = await response.json();
          } catch (cause) {
            const error2 = new TelegramApiError("Invalid Telegram API response", {
              category: "parse_error",
              retryable: true,
              status: response.status,
              method,
              attempts: attempt,
              cause
            });
            if (attempt >= 2) throw error2;
            const delay2 = retryDelay(attempt, random);
            if (Date.now() - startedAt + delay2 > maxTotalMs) throw error2;
            logger?.warn?.("telegram_api_retry", {
              method,
              category: "parse_error",
              attempt,
              delay: delay2
            });
            await sleep(delay2);
            continue;
          }
          if (result.ok) return result;
          const status = Number(result.error_code || response.status || 0);
          const retryAfter = status === 429 ? Number(result.parameters?.retry_after || 0) || 5 : void 0;
          const classification = classifyTelegramError({
            status,
            description: result.description,
            retryAfter
          });
          const error = new TelegramApiError(
            result.description || `Telegram API ${status}`,
            {
              ...classification,
              status,
              method,
              attempts: attempt,
              response: result
            }
          );
          const maxAttempts = classification.category === "rate_limited" ? 2 : 3;
          if (!classification.retryable || attempt >= maxAttempts) throw error;
          const delay = classification.category === "rate_limited" ? retryAfter * 1e3 : retryDelay(attempt, random);
          if (Date.now() - startedAt + delay > maxTotalMs) throw error;
          logger?.warn?.("telegram_api_retry", {
            method,
            category: classification.category,
            attempt,
            delay
          });
          await sleep(delay);
        } catch (caught) {
          if (caught instanceof TelegramApiError) throw caught;
          const category = caught?.name === "AbortError" ? "timeout" : "network";
          const error = new TelegramApiError(
            category === "timeout" ? "Request timeout" : String(caught?.message || caught),
            {
              category,
              retryable: true,
              status: 0,
              method,
              attempts: attempt
            }
          );
          if (attempt >= 3) throw error;
          const delay = retryDelay(attempt, random);
          if (Date.now() - startedAt + delay > maxTotalMs) throw error;
          logger?.warn?.("telegram_api_retry", { method, category, attempt, delay });
          await sleep(delay);
        } finally {
          clearTimeout(timeoutId);
        }
      }
      throw new TelegramApiError("Telegram API retry limit reached", {
        category: "network",
        retryable: true,
        status: 0,
        method,
        attempts: attempt
      });
    }
  };
}

// src/storage/kv-ephemeral-store.js
function createEphemeralStore(kv) {
  return {
    async getVerification(userId) {
      const value = await kv.get(`verified:${userId}`);
      if (!value) return null;
      if (value === "trusted") return { type: "legacy_trusted" };
      return { type: "temporary" };
    },
    async getVerificationTimestamp(userId) {
      const value = await kv.get(`verified_ts:${userId}`);
      return value == null ? null : Number(value);
    },
    async setVerification(userId, {
      type = "temporary",
      ttl,
      verifiedAt = Date.now()
    }) {
      if (type !== "temporary") {
        throw new Error("Permanent trust must use persistent storage");
      }
      await Promise.all([
        kv.put(`verified:${userId}`, "1", { expirationTtl: ttl }),
        kv.put(`verified_ts:${userId}`, String(verifiedAt), { expirationTtl: ttl })
      ]);
    },
    async clearVerification(userId) {
      await Promise.all([
        kv.delete(`verified:${userId}`),
        kv.delete(`verified_ts:${userId}`)
      ]);
    },
    async checkRateLimit(userId, action, limit, windowSeconds) {
      const key = `ratelimit:${action}:${userId}`;
      const count = Number(await kv.get(key) || 0);
      if (count >= limit) return { allowed: false, remaining: 0 };
      const next = count + 1;
      await kv.put(key, String(next), { expirationTtl: windowSeconds });
      return { allowed: true, remaining: Math.max(0, limit - next) };
    },
    async getAdminCache(userId) {
      const value = await kv.get(`admin:${userId}`);
      if (value == null) return null;
      return value === "1";
    },
    async setAdminCache(userId, isAdmin, ttl) {
      await kv.put(`admin:${userId}`, isAdmin ? "1" : "0", { expirationTtl: ttl });
    },
    async getAdminState(userId) {
      return kv.get(`admin_state:${userId}`, { type: "json" });
    },
    async setAdminState(userId, state, ttl = 600) {
      await kv.put(`admin_state:${userId}`, JSON.stringify(state), { expirationTtl: ttl });
    },
    async clearAdminState(userId) {
      await kv.delete(`admin_state:${userId}`);
    },
    async getTopicHealth(topicId) {
      const value = await kv.get(`thread_ok:${topicId}`);
      if (value == null) return null;
      return value === "1";
    },
    async setTopicHealth(topicId, healthy, ttl) {
      await kv.put(`thread_ok:${topicId}`, healthy ? "1" : "0", { expirationTtl: ttl });
    },
    async clearTopicHealth(topicId) {
      await kv.delete(`thread_ok:${topicId}`);
    }
  };
}

// src/storage/kv-storage.js
async function readJson(kv, key) {
  const value = await kv.get(key, { type: "json" });
  return value && typeof value === "object" ? value : null;
}
function createKVStorage(kv) {
  const storage = {
    async getUser(userId) {
      const id = String(userId);
      const record = await readJson(kv, `user:${id}`);
      if (!record) return null;
      const [banned, verification] = await Promise.all([
        kv.get(`banned:${id}`),
        kv.get(`verified:${id}`)
      ]);
      return {
        userId: id,
        username: record.username || null,
        firstName: record.first_name || null,
        lastName: record.last_name || null,
        status: banned ? "banned" : record.closed ? "closed" : "active",
        trustLevel: verification === "trusted" ? "trusted" : "normal",
        isMuted: Boolean(record.is_muted),
        violationCount: Number(record.violation_count || 0),
        topicId: record.thread_id == null ? null : String(record.thread_id),
        infoCardMessageId: record.info_card_message_id == null ? null : String(record.info_card_message_id),
        profileSnapshot: record.user_info_json || null,
        title: record.title || null,
        createdAt: record.created_at || null,
        updatedAt: record.updated_at || null,
        lastMessageAt: record.last_message_at || null
      };
    },
    async upsertUser(user) {
      const id = String(user.userId);
      const existing = await readJson(kv, `user:${id}`) || {};
      const record = {
        ...existing,
        thread_id: user.topicId ?? existing.thread_id ?? null,
        title: user.title ?? existing.title ?? null,
        closed: user.status === "closed",
        username: user.username ?? existing.username ?? null,
        first_name: user.firstName ?? existing.first_name ?? null,
        last_name: user.lastName ?? existing.last_name ?? null,
        is_muted: user.isMuted ?? existing.is_muted ?? false,
        violation_count: user.violationCount ?? existing.violation_count ?? 0,
        info_card_message_id: user.infoCardMessageId ?? existing.info_card_message_id ?? null,
        user_info_json: user.profileSnapshot ?? existing.user_info_json ?? null,
        created_at: user.createdAt ?? existing.created_at ?? Date.now(),
        updated_at: user.updatedAt ?? Date.now(),
        last_message_at: user.lastMessageAt ?? existing.last_message_at ?? null
      };
      await kv.put(`user:${id}`, JSON.stringify(record));
      if (record.thread_id != null) {
        await kv.put(`thread:${record.thread_id}`, id);
      }
      if (user.status === "banned") await kv.put(`banned:${id}`, "1");
      else await kv.delete(`banned:${id}`);
      if (user.trustLevel !== "trusted" && await kv.get(`verified:${id}`) === "trusted") {
        await kv.delete(`verified:${id}`);
      }
    },
    async findUserByTopic(topicId) {
      const userId = await kv.get(`thread:${topicId}`);
      return userId ? storage.getUser(userId) : null;
    },
    async updateUserState(userId, changes) {
      const existing = await storage.getUser(userId);
      if (!existing) return null;
      const updated = { ...existing, ...changes, userId: String(userId) };
      await storage.upsertUser(updated);
      return updated;
    }
  };
  return storage;
}

// worker.js
function containsLink(text) {
  if (!text) return false;
  const patterns = [
    /https?:\/\/\S+/i,
    /[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(\/\S*)?/,
    /t\.me\/\S+/i,
    /telegram\.me\/\S+/i
  ];
  return patterns.some((p) => p.test(text));
}
function buildSpamCheckText(msg) {
  if (!msg || typeof msg !== "object") return "";
  const from = msg.from || {};
  return [
    msg.text,
    msg.caption,
    from.first_name,
    from.last_name,
    from.username
  ].filter((v) => typeof v === "string" && v.trim().length > 0).join(" ");
}
function detectSpamKeywords(text, keywords) {
  if (!text || keywords.length === 0) return { isSpam: false, matchedWord: null };
  const lower = text.toLowerCase();
  for (const word of keywords) {
    if (lower.includes(word)) return { isSpam: true, matchedWord: word };
  }
  return { isSpam: false, matchedWord: null };
}
function computeMessageHash(msg) {
  const text = (msg.text || msg.caption || "").trim().toLowerCase();
  if (!text) return null;
  const fingerprint = `${text.length}|${text.substring(0, 100)}|${text.substring(Math.max(0, text.length - 20))}`;
  return fingerprint;
}
function normalizeTgDescription(description) {
  return (description || "").toString().toLowerCase();
}
function isTopicMissingOrDeleted(description) {
  const desc = normalizeTgDescription(description);
  return desc.includes("thread not found") || desc.includes("topic not found") || desc.includes("message thread not found") || desc.includes("topic deleted") || desc.includes("thread deleted") || desc.includes("forum topic not found") || desc.includes("topic closed permanently");
}
function isTestMessageInvalid(description) {
  const desc = normalizeTgDescription(description);
  return desc.includes("message text is empty") || desc.includes("bad request: message text is empty");
}
function withMessageThreadId(body, threadId) {
  if (threadId === void 0 || threadId === null) return body;
  return { ...body, message_thread_id: threadId };
}
function parseSpamKeywords(raw) {
  if (!raw) return [];
  return raw.toString().trim().split(/[,;，；\n]+/g).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
}
function generateVerifyCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var CONFIG = {
  VERIFY_ID_LENGTH: 12,
  VERIFY_EXPIRE_SECONDS: 300,
  // 5分钟
  VERIFIED_EXPIRE_SECONDS: 2592e3,
  // 30天
  MEDIA_GROUP_EXPIRE_SECONDS: 60,
  MEDIA_GROUP_DELAY_MS: 3e3,
  // 3秒（从2秒增加）
  PENDING_MAX_MESSAGES: 10,
  // 验证期间最多暂存的消息数
  ADMIN_CACHE_TTL_SECONDS: 300,
  // 管理员权限缓存 5 分钟
  NEEDS_REVERIFY_TTL_SECONDS: 600,
  // 标记需重新验证的 TTL（用于并发兜底）
  RATE_LIMIT_MESSAGE: 45,
  RATE_LIMIT_VERIFY: 3,
  RATE_LIMIT_WINDOW: 60,
  BUTTON_COLUMNS: 2,
  MAX_TITLE_LENGTH: 128,
  MAX_NAME_LENGTH: 30,
  API_TIMEOUT_MS: 1e4,
  CLEANUP_BATCH_SIZE: 10,
  MAX_CLEANUP_DISPLAY: 20,
  CLEANUP_LOCK_TTL_SECONDS: 1800,
  // /cleanup 防并发锁 30 分钟
  MAX_RETRY_ATTEMPTS: 3,
  THREAD_HEALTH_TTL_MS: 6e4,
  // PR #12: Turnstile 和垃圾检测配置
  TURNSTILE_VERIFY_TTL: 600,
  // Turnstile 验证 code 有效期 10 分钟
  NEW_USER_LINK_BLOCK_SECONDS: 86400,
  // 新用户 24 小时内禁止发链接
  SPAM_MESSAGE_HASH_TTL: 3600,
  // 消息去重 hash 缓存 1 小时
  SPAM_REPEAT_MESSAGE_LIMIT: 3,
  // 相同内容重复次数阈值
  SPAM_NOTIFY_ADMIN: true,
  // 是否通知管理员有骚扰消息
  SPAM_SILENCE_MODE: false
  // 静默丢弃模式（不通知管理员）
};
var threadHealthCache = /* @__PURE__ */ new Map();
var topicCreateInFlight = /* @__PURE__ */ new Map();
var adminStatusCache = /* @__PURE__ */ new Map();
var spamKeywordsCache = null;
var messageHashCache = /* @__PURE__ */ new Map();
var threadNotFoundCache = /* @__PURE__ */ new Map();
var ruleCache = /* @__PURE__ */ new WeakMap();
var THREAD_NOT_FOUND_TTL_MS = 5 * 60 * 1e3;
var THREAD_NOT_FOUND_MAX_ENTRIES = 1e3;
var ADMIN_STATUS_MAX_ENTRIES = 1e3;
var THREAD_HEALTH_MAX_ENTRIES = 1e3;
var MESSAGE_HASH_MAX_ENTRIES = 5e3;
function setBoundedCache(cache, key, value, maxEntries) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
}
var LOCAL_QUESTIONS = [
  { "question": "\u51B0\u878D\u5316\u540E\u4F1A\u53D8\u6210\u4EC0\u4E48\uFF1F", "correct_answer": "\u6C34", "incorrect_answers": ["\u77F3\u5934", "\u6728\u5934", "\u706B"] },
  { "question": "\u6B63\u5E38\u4EBA\u6709\u51E0\u53EA\u773C\u775B\uFF1F", "correct_answer": "2", "incorrect_answers": ["1", "3", "4"] },
  { "question": "\u4EE5\u4E0B\u54EA\u4E2A\u5C5E\u4E8E\u6C34\u679C\uFF1F", "correct_answer": "\u9999\u8549", "incorrect_answers": ["\u767D\u83DC", "\u732A\u8089", "\u5927\u7C73"] },
  { "question": "1 \u52A0 2 \u7B49\u4E8E\u51E0\uFF1F", "correct_answer": "3", "incorrect_answers": ["2", "4", "5"] },
  { "question": "5 \u51CF 2 \u7B49\u4E8E\u51E0\uFF1F", "correct_answer": "3", "incorrect_answers": ["1", "2", "4"] },
  { "question": "2 \u4E58\u4EE5 3 \u7B49\u4E8E\u51E0\uFF1F", "correct_answer": "6", "incorrect_answers": ["4", "5", "7"] },
  { "question": "10 \u52A0 5 \u7B49\u4E8E\u51E0\uFF1F", "correct_answer": "15", "incorrect_answers": ["10", "12", "20"] },
  { "question": "8 \u51CF 4 \u7B49\u4E8E\u51E0\uFF1F", "correct_answer": "4", "incorrect_answers": ["2", "3", "5"] },
  { "question": "\u5728\u5929\u4E0A\u98DE\u7684\u4EA4\u901A\u5DE5\u5177\u662F\u4EC0\u4E48\uFF1F", "correct_answer": "\u98DE\u673A", "incorrect_answers": ["\u6C7D\u8F66", "\u8F6E\u8239", "\u81EA\u884C\u8F66"] },
  { "question": "\u661F\u671F\u4E00\u7684\u540E\u9762\u662F\u661F\u671F\u51E0\uFF1F", "correct_answer": "\u661F\u671F\u4E8C", "incorrect_answers": ["\u661F\u671F\u65E5", "\u661F\u671F\u4E94", "\u661F\u671F\u4E09"] },
  { "question": "\u9C7C\u901A\u5E38\u751F\u6D3B\u5728\u54EA\u91CC\uFF1F", "correct_answer": "\u6C34\u91CC", "incorrect_answers": ["\u6811\u4E0A", "\u571F\u91CC", "\u706B\u91CC"] },
  { "question": "\u6211\u4EEC\u7528\u4EC0\u4E48\u5668\u5B98\u6765\u542C\u58F0\u97F3\uFF1F", "correct_answer": "\u8033\u6735", "incorrect_answers": ["\u773C\u775B", "\u9F3B\u5B50", "\u5634\u5DF4"] },
  { "question": "\u6674\u6717\u7684\u5929\u7A7A\u901A\u5E38\u662F\u4EC0\u4E48\u989C\u8272\u7684\uFF1F", "correct_answer": "\u84DD\u8272", "incorrect_answers": ["\u7EFF\u8272", "\u7EA2\u8272", "\u7D2B\u8272"] },
  { "question": "\u592A\u9633\u4ECE\u54EA\u4E2A\u65B9\u5411\u5347\u8D77\uFF1F", "correct_answer": "\u4E1C\u65B9", "incorrect_answers": ["\u897F\u65B9", "\u5357\u65B9", "\u5317\u65B9"] },
  { "question": "\u5C0F\u72D7\u53D1\u51FA\u7684\u53EB\u58F0\u901A\u5E38\u662F\uFF1F", "correct_answer": "\u6C6A\u6C6A", "incorrect_answers": ["\u55B5\u55B5", "\u54A9\u54A9", "\u5471\u5471"] }
];
var BLOCKED_WORDS = [
  "\u8D4C\u535A",
  "\u8272\u60C5",
  "\u4EE3\u5F00\u53D1",
  "\u52A0\u5FAE\u4FE1"
  // ↑ 在此添加更多屏蔽词，每行一个，用引号包裹、逗号结尾
];
var blockedWordsCache = { data: null, ts: 0, ttl: 6e4 };
async function getBlockedWords(env, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && blockedWordsCache.data && now - blockedWordsCache.ts < blockedWordsCache.ttl) {
    return blockedWordsCache.data;
  }
  let kvWords = [];
  try {
    const raw = await env.TOPIC_MAP.get("blocked_words_kv");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        kvWords = parsed.filter((w) => typeof w === "string" && w.trim().length > 0);
      }
    }
  } catch (e) {
    Logger.warn("blocked_words_kv_parse_error", { error: e.message });
  }
  const merged = [.../* @__PURE__ */ new Set([...BLOCKED_WORDS, ...kvWords])];
  blockedWordsCache.data = merged;
  blockedWordsCache.ts = now;
  return merged;
}
var Logger = createLogger();
function ephemeralStore(env) {
  return createEphemeralStore(env.TOPIC_MAP);
}
async function getVerificationState(env, userId) {
  const temporary = await ephemeralStore(env).getVerification(userId);
  if (temporary?.type === "temporary") return temporary;
  const persistent = env.TG_BOT_DB ? await createD1Storage(env.TG_BOT_DB).getUser(userId) : null;
  if (persistent?.trustLevel === "trusted") return { type: "trusted" };
  if (temporary?.type === "legacy_trusted" && env.TG_BOT_DB) {
    await setPersistentTrust(env, userId, "trusted");
    return { type: "trusted" };
  }
  return temporary;
}
async function getStoredRules(env) {
  if (!env.TG_BOT_DB) return [];
  const cached = ruleCache.get(env.TG_BOT_DB);
  const now = Date.now();
  if (cached && now - cached.ts < 3e4) return cached.rules;
  const rules = await createD1Storage(env.TG_BOT_DB).listEnabledRules();
  ruleCache.set(env.TG_BOT_DB, { ts: now, rules });
  return rules;
}
async function evaluateLegacyPolicy(env, message, user = {}) {
  const [blockedWords, verification, storedRules] = await Promise.all([
    getBlockedWords(env),
    getVerificationState(env, user.userId ?? message.chat?.id),
    getStoredRules(env)
  ]);
  const rules = blockedWords.filter(Boolean).map((pattern, index) => ({
    ruleId: `legacy_blocked:${index}`,
    ruleType: "blocked_keyword",
    matchType: "contains",
    pattern,
    action: "reject",
    priority: index
  }));
  return evaluateMessagePolicy({
    message,
    user: {
      ...user,
      status: user.status || "active",
      trustLevel: user.trustLevel || (verification?.type === "trusted" ? "trusted" : "normal")
    },
    verification,
    rules: [...rules, ...storedRules]
  });
}
function createLegacyConversationService(env) {
  return createConversationService({
    storage: createD1Storage(env.TG_BOT_DB),
    telegram: { call: (method, body) => tgCall(env, method, body) },
    policy: ({ message, user }) => evaluateLegacyPolicy(env, message, user),
    logger: Logger,
    supergroupId: env.SUPERGROUP_ID
  });
}
function parseIdAllowlist(raw) {
  return String(raw || "").split(/[,;\s]+/g).map((value) => value.trim()).filter((value) => /^\d{1,20}$/.test(value));
}
function createLegacyAdminService(env) {
  return createAdminService({
    storage: createD1Storage(env.TG_BOT_DB),
    ephemeralStore: ephemeralStore(env),
    telegram: { call: (method, body) => tgCall(env, method, body) },
    ownerIds: parseIdAllowlist(env.OWNER_IDS),
    onRulesChanged: () => ruleCache.delete(env.TG_BOT_DB)
  });
}
async function setPersistentTrust(env, userId, trustLevel) {
  if (!env.TG_BOT_DB) throw new Error("D1 'TG_BOT_DB' not bound");
  const d1Storage = createD1Storage(env.TG_BOT_DB);
  const existing = await d1Storage.getUser(userId) || await createKVStorage(env.TOPIC_MAP).getUser(userId) || { userId: String(userId) };
  await d1Storage.upsertUser({ ...existing, userId: String(userId), trustLevel });
  await ephemeralStore(env).clearVerification(userId);
}
async function saveLegacyMessageLink(env, link) {
  if (!env.TG_BOT_DB || link.targetMessageId == null) return;
  const contentSnapshot = snapshotMessage(link.message);
  await createD1Storage(env.TG_BOT_DB).saveMessageLink({
    direction: link.direction,
    sourceChatId: link.message.chat.id,
    sourceMessageId: link.message.message_id,
    targetChatId: link.targetChatId,
    targetMessageId: link.targetMessageId,
    topicId: link.topicId,
    userId: link.userId,
    contentSnapshot,
    contentHash: hashContent(contentSnapshot),
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}
function secureRandomInt(min, max) {
  const range = max - min;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return min + bytes[0] % range;
}
function secureRandomId(length = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}
async function safeGetJSON(env, key, defaultValue = null) {
  try {
    const data = await env.TOPIC_MAP.get(key, { type: "json" });
    if (data === null || data === void 0) {
      return defaultValue;
    }
    if (typeof data !== "object") {
      Logger.warn("kv_invalid_type", { key, type: typeof data });
      return defaultValue;
    }
    return data;
  } catch (e) {
    Logger.error("kv_parse_failed", e, { key });
    return defaultValue;
  }
}
async function getOrCreateUserTopicRec(from, key, env, userId) {
  const existing = await safeGetJSON(env, key, null);
  if (existing && existing.thread_id) return existing;
  const inflight = topicCreateInFlight.get(String(userId));
  if (inflight) return await inflight;
  const p = (async () => {
    const again = await safeGetJSON(env, key, null);
    if (again && again.thread_id) return again;
    const storage = createD1Storage(env.TG_BOT_DB);
    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.ensureUser({
        userId: String(userId),
        username: from?.username ?? null,
        firstName: from?.first_name ?? null,
        lastName: from?.last_name ?? null
      });
    }
    if (user?.topicId) {
      const rec = { thread_id: user.topicId, title: buildTopicTitle2(from), closed: false };
      await env.TOPIC_MAP.put(key, JSON.stringify(rec));
      await env.TOPIC_MAP.put(`thread:${user.topicId}`, String(userId));
      return rec;
    }
    const token = secureRandomId(20);
    const acquired = await storage.acquireTopicLock(userId, token, Date.now(), 3e4);
    if (acquired) {
      try {
        const rec = await createTopic(from, key, env, userId);
        const saved = await storage.setTopic(userId, rec.thread_id, token, Date.now());
        if (!saved) throw new Error("Topic \u9501\u6240\u6709\u6743\u5DF2\u4E22\u5931");
        return rec;
      } finally {
        await storage.releaseTopicLock(userId, token, Date.now());
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150 + attempt * 75));
      const refreshed = await storage.getUser(userId);
      if (refreshed?.topicId) {
        const rec = { thread_id: refreshed.topicId, title: buildTopicTitle2(from), closed: false };
        await env.TOPIC_MAP.put(key, JSON.stringify(rec));
        await env.TOPIC_MAP.put(`thread:${refreshed.topicId}`, String(userId));
        return rec;
      }
    }
    throw Object.assign(new Error("Topic \u521B\u5EFA\u9501\u7E41\u5FD9"), {
      category: "topic_lock_busy",
      retryable: true
    });
  })();
  topicCreateInFlight.set(String(userId), p);
  try {
    return await p;
  } finally {
    if (topicCreateInFlight.get(String(userId)) === p) {
      topicCreateInFlight.delete(String(userId));
    }
  }
}
async function probeForumThread(env, expectedThreadId, { userId, reason, doubleCheckOnMissingThreadId = true } = {}) {
  const attemptOnce = async () => {
    const res = await tgCall(env, "sendMessage", {
      chat_id: env.SUPERGROUP_ID,
      message_thread_id: expectedThreadId,
      text: "\u{1F50E}"
    });
    const actualThreadId = res.result?.message_thread_id;
    const probeMessageId = res.result?.message_id;
    if (res.ok && probeMessageId) {
      try {
        await tgCall(env, "deleteMessage", {
          chat_id: env.SUPERGROUP_ID,
          message_id: probeMessageId
        });
      } catch (e) {
      }
    }
    if (!res.ok) {
      if (isTopicMissingOrDeleted(res.description)) {
        return { status: "missing", description: res.description };
      }
      if (isTestMessageInvalid(res.description)) {
        return { status: "probe_invalid", description: res.description };
      }
      return { status: "unknown_error", description: res.description };
    }
    if (actualThreadId === void 0 || actualThreadId === null) {
      return { status: "missing_thread_id" };
    }
    if (Number(actualThreadId) !== Number(expectedThreadId)) {
      return { status: "redirected", actualThreadId };
    }
    return { status: "ok" };
  };
  const first = await attemptOnce();
  if (first.status !== "missing_thread_id" || !doubleCheckOnMissingThreadId) return first;
  const second = await attemptOnce();
  if (second.status === "missing_thread_id") {
    Logger.warn("thread_probe_missing_thread_id", { userId, expectedThreadId, reason });
  }
  return second;
}
async function resetUserVerificationAndRequireReverify(env, { userId, userKey, oldThreadId, pendingMsgId, reason }) {
  await setPersistentTrust(env, userId, "normal");
  await env.TOPIC_MAP.put(`needs_verify:${userId}`, "1", { expirationTtl: CONFIG.NEEDS_REVERIFY_TTL_SECONDS });
  await env.TOPIC_MAP.delete(`retry:${userId}`);
  if (userKey) {
    await env.TOPIC_MAP.delete(userKey);
  }
  if (oldThreadId !== void 0 && oldThreadId !== null) {
    await env.TOPIC_MAP.delete(`thread:${oldThreadId}`);
    await ephemeralStore(env).clearTopicHealth(oldThreadId);
    threadHealthCache.delete(oldThreadId);
  }
  Logger.info("verification_reset_due_to_topic_loss", {
    userId,
    oldThreadId,
    pendingMsgId,
    reason
  });
  await sendVerificationChallenge(userId, env, pendingMsgId || null);
}
function parseAdminIdAllowlist(env) {
  const set = new Set(parseIdAllowlist(env.ADMIN_IDS));
  return set.size > 0 ? set : null;
}
async function isAdminUser(env, userId) {
  const allowlist = parseAdminIdAllowlist(env);
  if (allowlist && allowlist.has(String(userId))) return true;
  const cacheKey = String(userId);
  const now = Date.now();
  const cached = adminStatusCache.get(cacheKey);
  if (cached && now - cached.ts < CONFIG.ADMIN_CACHE_TTL_SECONDS * 1e3) {
    return cached.isAdmin;
  }
  const kvVal = await ephemeralStore(env).getAdminCache(userId);
  if (kvVal !== null) {
    const isAdmin = kvVal;
    setBoundedCache(adminStatusCache, cacheKey, { ts: now, isAdmin }, ADMIN_STATUS_MAX_ENTRIES);
    return isAdmin;
  }
  try {
    const res = await tgCall(env, "getChatMember", {
      chat_id: env.SUPERGROUP_ID,
      user_id: userId
    });
    const status = res.result?.status;
    const isAdmin = res.ok && (status === "creator" || status === "administrator");
    await ephemeralStore(env).setAdminCache(userId, isAdmin, CONFIG.ADMIN_CACHE_TTL_SECONDS);
    setBoundedCache(adminStatusCache, cacheKey, { ts: now, isAdmin }, ADMIN_STATUS_MAX_ENTRIES);
    return isAdmin;
  } catch (e) {
    Logger.warn("admin_check_failed", { userId });
    return false;
  }
}
async function getAllKeys(env, prefix) {
  const allKeys = [];
  let cursor = void 0;
  do {
    const result = await env.TOPIC_MAP.list({ prefix, cursor });
    allKeys.push(...result.keys);
    cursor = result.list_complete ? void 0 : result.cursor;
  } while (cursor);
  return allKeys;
}
function shuffleArray(arr) {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
async function checkRateLimit(userId, env, action = "message", limit = 20, window = 60) {
  return ephemeralStore(env).checkRateLimit(userId, action, limit, window);
}
async function verifyTurnstileToken(token, secretKey, remoteIp) {
  const formData = new URLSearchParams();
  formData.append("secret", secretKey);
  formData.append("response", token);
  if (remoteIp) {
    formData.append("remoteip", remoteIp);
  }
  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString()
    });
    const result = await resp.json();
    return { success: result.success === true, error: result["error-codes"]?.join(", ") };
  } catch (e) {
    Logger.error("turnstile_verify_error", e);
    return { success: false, error: e.message };
  }
}
function getSpamKeywords(env) {
  if (spamKeywordsCache) return spamKeywordsCache;
  const raw = (env.SPAM_KEYWORDS || "").toString().trim();
  spamKeywordsCache = parseSpamKeywords(raw);
  if (spamKeywordsCache.length > 0) {
    Logger.info("spam_keywords_loaded", { count: spamKeywordsCache.length });
  }
  return spamKeywordsCache;
}
async function detectRepeatMessage(userId, msg) {
  const hash = computeMessageHash(msg);
  if (!hash) return { isRepeat: false, count: 0 };
  const cacheKey = `msghash:${userId}:${hash}`;
  const now = Date.now();
  const cached = messageHashCache.get(cacheKey);
  if (cached && now - cached.ts > CONFIG.SPAM_MESSAGE_HASH_TTL * 1e3) {
    messageHashCache.delete(cacheKey);
    const count2 = 1;
    setBoundedCache(messageHashCache, cacheKey, { count: count2, ts: now }, MESSAGE_HASH_MAX_ENTRIES);
    return { isRepeat: false, count: count2 };
  }
  const count = (cached?.count || 0) + 1;
  setBoundedCache(messageHashCache, cacheKey, { count, ts: now }, MESSAGE_HASH_MAX_ENTRIES);
  if (count >= CONFIG.SPAM_REPEAT_MESSAGE_LIMIT) {
    return { isRepeat: true, count };
  }
  return { isRepeat: false, count };
}
function pruneMessageHashCache(now) {
  const ttl = CONFIG.SPAM_MESSAGE_HASH_TTL * 1e3;
  for (const [key, value] of messageHashCache) {
    if (now - value.ts > ttl) {
      messageHashCache.delete(key);
    }
  }
}
async function spamCheck(msg, userId, env) {
  const reasons = [];
  const details = {};
  const text = buildSpamCheckText(msg).trim();
  const keywords = getSpamKeywords(env);
  const keywordResult = detectSpamKeywords(text, keywords);
  if (keywordResult.isSpam) {
    reasons.push("keyword");
    details.keyword = keywordResult.matchedWord;
  }
  if (containsLink(text)) {
    const verifyTs = await ephemeralStore(env).getVerificationTimestamp(userId);
    if (!verifyTs) {
      reasons.push("new_user_link");
      details.linkBlockRemainingHours = Math.ceil(CONFIG.NEW_USER_LINK_BLOCK_SECONDS / 3600);
    } else {
      const elapsed = (Date.now() - parseInt(verifyTs)) / 1e3;
      if (elapsed < CONFIG.NEW_USER_LINK_BLOCK_SECONDS) {
        const remainingHours = Math.ceil((CONFIG.NEW_USER_LINK_BLOCK_SECONDS - elapsed) / 3600);
        reasons.push("new_user_link");
        details.linkBlockRemainingHours = remainingHours;
      }
    }
  }
  const repeatResult = await detectRepeatMessage(userId, msg);
  if (repeatResult.isRepeat) {
    reasons.push("repeat_message");
    details.repeatCount = repeatResult.count;
  }
  return {
    isSpam: reasons.length > 0,
    reasons,
    details
  };
}
async function notifyAdmin(env, alertType, message, threadId) {
  Logger.warn("admin_alert", { alertType, messageLength: message.length });
  const body = threadId ? { message_thread_id: threadId } : {};
  try {
    await tgCall(env, "sendMessage", {
      chat_id: env.SUPERGROUP_ID,
      text: message,
      parse_mode: "Markdown",
      ...body
    });
  } catch (e) {
    Logger.error("admin_alert_failed", e, { alertType });
  }
}
async function updateSpamStats(env, reasons) {
  try {
    for (const reason of reasons) {
      const countKey = `stats:spam:${reason}`;
      const current = parseInt(await env.TOPIC_MAP.get(countKey) || "0");
      await env.TOPIC_MAP.put(countKey, String(current + 1), { expirationTtl: 2592e3 });
    }
    const totalKey = "stats:spam:total";
    const total = parseInt(await env.TOPIC_MAP.get(totalKey) || "0");
    await env.TOPIC_MAP.put(totalKey, String(total + 1), { expirationTtl: 2592e3 });
  } catch (e) {
    Logger.warn("spam_stats_update_failed", { error: e.message });
  }
}
async function handleSpamMessage(env, userId, msg, spamResult, threadId, ctx) {
  Logger.warn("spam_detected", {
    userId,
    reasons: spamResult.reasons,
    details: spamResult.details
  });
  if (ctx?.waitUntil) {
    ctx.waitUntil(updateSpamStats(env, spamResult.reasons));
  }
  if (CONFIG.SPAM_NOTIFY_ADMIN && !CONFIG.SPAM_SILENCE_MODE) {
    const reasonText = spamResult.reasons.map((r) => {
      switch (r) {
        case "keyword":
          return `\u{1F511} \u5173\u952E\u8BCD: \`${spamResult.details.keyword}\``;
        case "new_user_link":
          return `\u{1F517} \u65B0\u7528\u6237\u94FE\u63A5 (\u5269\u4F59 ${spamResult.details.linkBlockRemainingHours}h)`;
        case "repeat_message":
          return `\u{1F504} \u91CD\u590D\u6D88\u606F (${spamResult.details.repeatCount}\u6B21)`;
        default:
          return r;
      }
    }).join("\n");
    const body = threadId ? { message_thread_id: threadId } : {};
    await tgCall(env, "sendMessage", {
      chat_id: env.SUPERGROUP_ID,
      text: `\u26A0\uFE0F **\u68C0\u6D4B\u5230\u7591\u4F3C\u9A9A\u6270\u6D88\u606F**

\u{1F464} \u7528\u6237: \`${userId}\`
${reasonText}

\u{1F4DD} \u6D88\u606F\u5DF2\u62E6\u622A\u3002\u4F7F\u7528 /ban \u5C01\u7981\u8BE5\u7528\u6237\u3002`,
      parse_mode: "Markdown",
      ...body
    });
  }
}
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var VERIFY_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u4EBA\u673A\u9A8C\u8BC1</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:16px;padding:32px 24px;max-width:400px;width:100%;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,0.08)}
.icon{font-size:48px;margin-bottom:12px}
h2{color:#1a1a1a;margin-bottom:8px;font-size:20px}
p.desc{color:#666;font-size:14px;margin-bottom:24px;line-height:1.6}
.turnstile-container{display:flex;justify-content:center;margin-bottom:20px;min-height:65px}
#status{font-size:13px;color:#999;margin-top:12px;min-height:20px}
.success{color:#22c55e}
.error{color:#ef4444}
.footer{margin-top:20px;font-size:11px;color:#bbb}
.footer span{font-family:monospace;color:#999}
</style>
</head>
<body>
<div class="card">
  <div class="icon">\u{1F6E1}\uFE0F</div>
  <h2>\u4EBA\u673A\u9A8C\u8BC1</h2>
  <p class="desc">\u8BF7\u5B8C\u6210\u4E0B\u65B9\u9A8C\u8BC1\u4EE5\u786E\u8BA4\u60A8\u4E0D\u662F\u673A\u5668\u4EBA\u3002<br>\u9A8C\u8BC1\u901A\u8FC7\u540E\u60A8\u7684\u6D88\u606F\u5C06\u81EA\u52A8\u9001\u8FBE\u3002</p>
  <div class="turnstile-container">
    <div class="cf-turnstile" data-sitekey="{{SITE_KEY}}" data-callback="onTurnstileSuccess" data-error-callback="onTurnstileError" data-theme="light"></div>
  </div>
  <div id="status">\u6B63\u5728\u52A0\u8F7D\u9A8C\u8BC1\u7EC4\u4EF6...</div>
  <a id="back-btn" href="tg://resolve" style="display:none;margin-top:16px;background:#0088cc;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:16px;text-decoration:none;">\u{1F4F1} \u8FD4\u56DE Telegram</a>
  <div class="footer">
    User: <span>{{USER_ID}}</span> \xB7 Code: <span>{{CODE}}</span>
  </div>
</div>
<script>
var submitted = false;
function showStatus(msg, cls) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = cls || '';
}
function onTurnstileSuccess(token) {
  if (submitted) return;
  submitted = true;
  showStatus('\u2705 \u9A8C\u8BC1\u901A\u8FC7\uFF01\u6B63\u5728\u901A\u77E5\u673A\u5668\u4EBA...', 'success');
  fetch('{{WORKER_URL}}/verify-callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token, code: '{{CODE}}', userId: '{{USER_ID}}' })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      var msg = '\u2705 \u9A8C\u8BC1\u6210\u529F\uFF01\u673A\u5668\u4EBA\u5DF2\u6536\u5230\u60A8\u7684\u6D88\u606F\u3002';
      if (data.pendingCount > 0) {
        msg += '\uFF08' + data.pendingCount + ' \u6761\u6D88\u606F\u5C06\u4E8E\u6570\u79D2\u5185\u9001\u8FBE\uFF09';
      }
      showStatus(msg, 'success');
      document.querySelector('.desc').textContent = '\u8BF7\u8FD4\u56DE Telegram\uFF0C\u673A\u5668\u4EBA\u5DF2\u5411\u60A8\u53D1\u9001\u4E86\u9A8C\u8BC1\u901A\u8FC7\u901A\u77E5\u3002';
      // \u663E\u793A\u8FD4\u56DE Telegram \u6309\u94AE
      var btn = document.getElementById('back-btn');
      if (btn) {
        btn.style.display = 'inline-block';
      }
    } else {
      var errMap = {
        'turnstile_failed': '\u4EBA\u673A\u9A8C\u8BC1\u672A\u901A\u8FC7\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u91CD\u8BD5',
        'code_invalid_or_expired': '\u9A8C\u8BC1\u94FE\u63A5\u5DF2\u8FC7\u671F\uFF08\u6709\u6548\u671F10\u5206\u949F\uFF09\uFF0C\u8BF7\u8FD4\u56DE Telegram \u91CD\u65B0\u53D1\u9001\u6D88\u606F\u83B7\u53D6\u65B0\u7684\u9A8C\u8BC1\u94FE\u63A5',
        'server_not_configured': '\u670D\u52A1\u5668\u672A\u5B8C\u6210\u914D\u7F6E\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458'
      };
      var errMsg = errMap[data.error] || ('\u9A8C\u8BC1\u5931\u8D25: ' + (data.detail || data.error || '\u672A\u77E5\u9519\u8BEF'));
      showStatus(errMsg, 'error');
      submitted = false;
      if (window.turnstile) {
        window.turnstile.reset();
      }
    }
  })
  .catch(function(e) {
    showStatus('\u274C \u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u5237\u65B0\u9875\u9762\u91CD\u8BD5', 'error');
    submitted = false;
    if (window.turnstile) {
      window.turnstile.reset();
    }
  });
}
function onTurnstileError(errorCode) {
  // Turnstile \u5BA2\u6237\u7AEF\u9519\u8BEF\u7801\uFF1Ahttps://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
  var code = (errorCode == null || errorCode === '') ? '' : String(errorCode);
  var hint = '';
  if (code === '110200') {
    hint = '\uFF08\u57DF\u540D\u672A\u6388\u6743\uFF1A\u8BF7\u5728 Cloudflare Turnstile \u2192 Hostname \u4E2D\u6DFB\u52A0\u5F53\u524D Worker \u57DF\u540D\uFF0C\u5982 xxx.workers.dev\uFF09';
  } else if (code === '110110') {
    hint = '\uFF08Site Key \u65E0\u6548\uFF1A\u8BF7\u68C0\u67E5 Dashboard \u4E2D\u7684 TURNSTILE_SITE_KEY\uFF09';
  } else if (code === '110600') {
    hint = '\uFF08\u6311\u6218\u8D85\u65F6\uFF1A\u8BF7\u5237\u65B0\u9875\u9762\u91CD\u8BD5\uFF1B\u82E5\u5728 Telegram \u5185\u7F6E\u6D4F\u89C8\u5668\u5931\u8D25\uFF0C\u53EF\u6539\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u6253\u5F00\u94FE\u63A5\uFF09';
  } else if (code === '300030' || code === '300031') {
    hint = '\uFF08\u7EC4\u4EF6\u521D\u59CB\u5316\u5931\u8D25\uFF1A\u591A\u4E3A CSP/\u7F51\u7EDC\u62E6\u622A challenges.cloudflare.com\uFF09';
  } else if (!code) {
    hint = '\uFF08\u65E0\u6CD5\u52A0\u8F7D challenges.cloudflare.com\uFF1A\u8BF7\u68C0\u67E5\u7F51\u7EDC/\u4EE3\u7406/\u5730\u533A\u8BBF\u95EE\uFF09';
  }
  showStatus('\u26A0\uFE0F \u9A8C\u8BC1\u7EC4\u4EF6\u5931\u8D25' + (code ? ' [' + code + ']' : '') + '\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5' + hint, 'error');
}
// \u811A\u672C\u957F\u65F6\u95F4\u672A\u5C31\u7EEA\u65F6\u7ED9\u51FA\u63D0\u793A\uFF08\u533A\u5206\u811A\u672C\u88AB\u5899\u4E0E widget \u914D\u7F6E\u9519\u8BEF\uFF09
setTimeout(function() {
  if (!window.turnstile && !submitted) {
    showStatus('\u26A0\uFE0F \u672A\u80FD\u52A0\u8F7D Turnstile \u811A\u672C\uFF08challenges.cloudflare.com\uFF09\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\uFF0C\u6216\u8BA9\u7BA1\u7406\u5458\u6682\u65F6\u5173\u95ED TURNSTILE_* \u53D8\u91CF\u4EE5\u4F7F\u7528\u672C\u5730\u9898\u5E93\u9A8C\u8BC1\u3002', 'error');
  }
}, 8000);
</script>
</body>
</html>`;
var legacyApp = {
  async fetch(request, env, ctx) {
    if (!env.TOPIC_MAP) return new Response("Error: KV 'TOPIC_MAP' not bound.");
    if (!env.BOT_TOKEN) return new Response("Error: BOT_TOKEN not set.");
    if (!env.SUPERGROUP_ID) return new Response("Error: SUPERGROUP_ID not set.");
    const normalizedEnv = {
      ...env,
      SUPERGROUP_ID: String(env.SUPERGROUP_ID),
      BOT_TOKEN: String(env.BOT_TOKEN)
    };
    if (!normalizedEnv.SUPERGROUP_ID.startsWith("-100")) {
      return new Response("Error: SUPERGROUP_ID must start with -100");
    }
    const url = new URL(request.url);
    if (request.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/health") {
        return new Response("OK");
      }
      if (url.pathname === "/verify" || url.pathname.endsWith("/verify")) {
        const code = url.searchParams.get("code");
        const userId = url.searchParams.get("uid");
        const siteKey = (env.TURNSTILE_SITE_KEY || "").toString().trim();
        if (!code || !userId || !siteKey) {
          return new Response(
            '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h2>\u274C \u53C2\u6570\u65E0\u6548</h2><p>\u7F3A\u5C11\u9A8C\u8BC1\u4FE1\u606F\u6216\u7CFB\u7EDF\u672A\u914D\u7F6E Turnstile\u3002</p></body></html>',
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        const workerUrl = url.origin;
        const csp = [
          "default-src 'none'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
          "style-src 'unsafe-inline'",
          "img-src https://challenges.cloudflare.com data:",
          "connect-src 'self' https://challenges.cloudflare.com",
          "frame-src https://challenges.cloudflare.com",
          "child-src https://challenges.cloudflare.com",
          "worker-src blob:",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'"
        ].join("; ");
        return new Response(
          VERIFY_PAGE_HTML.replace(/{{SITE_KEY}}/g, escapeHtml(siteKey)).replace(/{{CODE}}/g, escapeHtml(code)).replace(/{{USER_ID}}/g, escapeHtml(userId)).replace(/{{WORKER_URL}}/g, escapeHtml(workerUrl)),
          { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp } }
        );
      }
      return new Response("Not Found", { status: 404 });
    }
    if ((url.pathname === "/verify-callback" || url.pathname.endsWith("/verify-callback")) && request.method === "POST") {
      try {
        const body = await request.json();
        const { token, code, userId } = body || {};
        if (!token || !code || !userId) {
          return new Response(JSON.stringify({ success: false, error: "missing_params" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }
        const turnstileSecret = (env.TURNSTILE_SECRET_KEY || "").toString().trim();
        if (!turnstileSecret) {
          return new Response(JSON.stringify({ success: false, error: "server_not_configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
        const verifyResult = await verifyTurnstileToken(token, turnstileSecret);
        if (!verifyResult.success) {
          Logger.warn("turnstile_token_invalid", { userId, error: verifyResult.error });
          return new Response(JSON.stringify({ success: false, error: "turnstile_failed", detail: verifyResult.error }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }
        const storedUserId = await env.TOPIC_MAP.get(`turnstile_code:${code}`);
        if (!storedUserId || storedUserId !== String(userId)) {
          return new Response(JSON.stringify({ success: false, error: "code_invalid_or_expired" }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }
        await ephemeralStore(env).setVerification(userId, {
          ttl: CONFIG.VERIFIED_EXPIRE_SECONDS,
          verifiedAt: Date.now()
        });
        await env.TOPIC_MAP.delete(`needs_verify:${userId}`);
        await env.TOPIC_MAP.delete(`turnstile_code:${code}`);
        await env.TOPIC_MAP.delete(`user_challenge:${userId}`);
        Logger.info("turnstile_verification_success", { userId });
        const verifyMsgId = await env.TOPIC_MAP.get(`turnstile_msg:${code}`);
        ctx.waitUntil((async () => {
          if (verifyMsgId) {
            try {
              await tgCall(normalizedEnv, "deleteMessage", {
                chat_id: Number(userId),
                message_id: parseInt(verifyMsgId)
              });
            } catch (e) {
            }
            await env.TOPIC_MAP.delete(`turnstile_msg:${code}`);
          }
          await tgCall(normalizedEnv, "sendMessage", {
            chat_id: Number(userId),
            text: "\u2726 \u9A8C\u8BC1\u901A\u8FC7\n\n\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u4F60\u7684\uFF1F\u76F4\u63A5\u53D1\u6D88\u606F\u5C31\u597D\u3002",
            parse_mode: "Markdown"
          });
        })());
        const pendingKey = `pending_turnstile:${userId}`;
        const pendingIdsStr = await env.TOPIC_MAP.get(pendingKey);
        let pendingCount = 0;
        if (pendingIdsStr) {
          try {
            const pendingIds = JSON.parse(pendingIdsStr);
            if (Array.isArray(pendingIds) && pendingIds.length > 0) {
              pendingCount = Math.min(pendingIds.length, CONFIG.PENDING_MAX_MESSAGES);
              ctx.waitUntil((async () => {
                let forwardedCount = 0;
                const limited = pendingIds.slice(0, CONFIG.PENDING_MAX_MESSAGES);
                for (const pendingId of limited) {
                  if (!pendingId) continue;
                  const fakeMsg = {
                    message_id: pendingId,
                    chat: { id: Number(userId), type: "private" },
                    from: { id: Number(userId) }
                  };
                  try {
                    await forwardToTopic(fakeMsg, userId, `user:${userId}`, normalizedEnv, ctx);
                    forwardedCount++;
                  } catch (e) {
                    Logger.error("pending_turnstile_forward_failed", e, { userId, messageId: pendingId });
                  }
                }
                if (forwardedCount > 0) {
                  await tgCall(normalizedEnv, "sendMessage", {
                    chat_id: Number(userId),
                    text: `\u{1F4E9} \u521A\u624D\u7684 ${forwardedCount} \u6761\u6D88\u606F\u5DF2\u5E2E\u60A8\u9001\u8FBE\u3002`
                  });
                }
                await env.TOPIC_MAP.delete(pendingKey);
              })());
            }
          } catch (e) {
            Logger.error("pending_turnstile_parse_failed", e, { userId });
          }
        }
        return new Response(JSON.stringify({ success: true, pendingCount }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        Logger.error("verify_callback_error", e);
        return new Response(JSON.stringify({ success: false, error: "server_error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      Logger.warn("invalid_content_type", { contentType });
      return new Response("OK");
    }
    let update;
    try {
      update = await request.json();
      if (!update || typeof update !== "object") {
        Logger.warn("invalid_json_structure", { update: typeof update });
        return new Response("OK");
      }
    } catch (e) {
      Logger.error("json_parse_failed", e);
      return new Response("OK");
    }
    if (update.edited_message) {
      const handleUpdate = createUpdateHandler({
        conversation: createLegacyConversationService(normalizedEnv),
        supergroupId: normalizedEnv.SUPERGROUP_ID
      });
      await handleUpdate(update);
      return new Response("OK");
    }
    if (update.callback_query) {
      if (String(update.callback_query.data || "").startsWith("v1:")) {
        await createLegacyAdminService(normalizedEnv).handleCallbackQuery(update.callback_query);
      } else {
        await handleCallbackQuery(update.callback_query, normalizedEnv, ctx);
      }
      return new Response("OK");
    }
    const msg = update.message;
    if (!msg) return new Response("OK");
    const now = Date.now();
    ctx.waitUntil(flushExpiredMediaGroups(normalizedEnv, now));
    if (Math.random() < 0.01) {
      pruneMessageHashCache(now);
    }
    if (msg.chat && msg.chat.type === "private") {
      try {
        if (msg.text === "/start" || msg.text === "/cancel") {
          const adminResult = await createLegacyAdminService(normalizedEnv).handlePrivateAdminMessage(msg);
          if (adminResult.status === "menu" || adminResult.status === "cancelled") {
            return new Response("OK");
          }
        }
        await handlePrivateMessage(msg, normalizedEnv, ctx);
      } catch (e) {
        const errText = `\u26A0\uFE0F \u7CFB\u7EDF\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002`;
        await tgCall(normalizedEnv, "sendMessage", { chat_id: msg.chat.id, text: errText });
        Logger.error("private_message_failed", e, { userId: msg.chat.id });
      }
      return new Response("OK");
    }
    if (msg.chat && String(msg.chat.id) === normalizedEnv.SUPERGROUP_ID) {
      if (msg.forum_topic_closed && msg.message_thread_id) {
        await updateThreadStatus(msg.message_thread_id, true, normalizedEnv);
        return new Response("OK");
      }
      if (msg.forum_topic_reopened && msg.message_thread_id) {
        await updateThreadStatus(msg.message_thread_id, false, normalizedEnv);
        return new Response("OK");
      }
      const text = (msg.text || "").trim();
      const isCommand = !!text && text.startsWith("/");
      if (msg.message_thread_id || isCommand) {
        await handleAdminReply(msg, normalizedEnv, ctx);
        return new Response("OK");
      }
    }
    return new Response("OK");
  }
};
async function handlePrivateMessage(msg, env, ctx) {
  const userId = msg.chat.id;
  const key = `user:${userId}`;
  const rateLimit = await checkRateLimit(userId, env, "message", CONFIG.RATE_LIMIT_MESSAGE, CONFIG.RATE_LIMIT_WINDOW);
  if (!rateLimit.allowed) {
    await tgCall(env, "sendMessage", {
      chat_id: userId,
      text: "\u26A0\uFE0F \u53D1\u9001\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002"
    });
    return;
  }
  if (msg.text && msg.text.startsWith("/") && msg.text.trim() !== "/start") {
    return;
  }
  const [isBanned, blockedWords, verification] = await Promise.all([
    env.TOPIC_MAP.get(`banned:${userId}`),
    getBlockedWords(env),
    getVerificationState(env, userId)
  ]);
  const blockedRules = blockedWords.map((pattern, index) => ({
    ruleId: `legacy_blocked:${index}`,
    ruleType: "blocked_keyword",
    matchType: "contains",
    pattern,
    action: "reject",
    priority: index
  }));
  const policyResult = evaluateMessagePolicy({
    message: msg,
    user: {
      status: isBanned ? "banned" : "active",
      trustLevel: verification?.type === "trusted" ? "trusted" : "normal"
    },
    verification,
    rules: blockedRules
  });
  if (policyResult.reason === "banned") return;
  if (policyResult.reason === "blocked_keyword") {
    const matchedIndex = Number(policyResult.matchedRuleId?.split(":")[1]);
    Logger.info("message_blocked_by_word", { userId, word: blockedWords[matchedIndex] });
    await tgCall(env, "sendMessage", {
      chat_id: userId,
      text: "\u{1F6AB} \u60A8\u7684\u6D88\u606F\u5305\u542B\u8FDD\u89C4\u5185\u5BB9\uFF0C\u5DF2\u88AB\u62E6\u622A\uFF0C\u8BF7\u4FEE\u6539\u540E\u91CD\u65B0\u53D1\u9001\u3002"
    });
    return;
  }
  const spamResult = await spamCheck(msg, userId, env);
  if (spamResult.isSpam) {
    await handleSpamMessage(env, userId, msg, spamResult, void 0, ctx);
    return;
  }
  if (policyResult.action === "require_verification") {
    const isStart = msg.text && msg.text.trim() === "/start";
    const pendingMsgId = isStart ? null : msg.message_id;
    await sendVerificationChallenge(userId, env, pendingMsgId);
    return;
  }
  if (policyResult.autoReply) {
    try {
      await tgCall(env, "sendMessage", { chat_id: userId, text: policyResult.autoReply });
    } catch (error) {
      Logger.warn("auto_reply_failed", { userId, ruleId: policyResult.matchedRuleId });
      if (policyResult.action === "auto_reply_only") throw error;
    }
  }
  if (policyResult.action === "auto_reply_only") return;
  await forwardToTopic(msg, userId, key, env, ctx);
}
async function forwardToTopic(msg, userId, key, env, ctx) {
  const needsVerify = await env.TOPIC_MAP.get(`needs_verify:${userId}`);
  if (needsVerify) {
    await sendVerificationChallenge(userId, env, msg.message_id || null);
    return;
  }
  let rec = await safeGetJSON(env, key, null);
  if (rec && rec.closed) {
    await tgCall(env, "sendMessage", { chat_id: userId, text: "\u{1F6AB} \u5F53\u524D\u5BF9\u8BDD\u5DF2\u88AB\u7BA1\u7406\u5458\u5173\u95ED\u3002" });
    return;
  }
  const retryKey = `retry:${userId}`;
  let retryCount = parseInt(await env.TOPIC_MAP.get(retryKey) ?? "0", 10);
  if (retryCount > CONFIG.MAX_RETRY_ATTEMPTS) {
    await tgCall(env, "sendMessage", { chat_id: userId, text: "\u274C \u7CFB\u7EDF\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002" });
    await env.TOPIC_MAP.delete(retryKey);
    return;
  }
  if (!rec || !rec.thread_id) {
    rec = await getOrCreateUserTopicRec(msg.from, key, env, userId);
    if (!rec || !rec.thread_id) {
      throw new Error("\u521B\u5EFA\u8BDD\u9898\u5931\u8D25");
    }
  }
  if (rec.thread_id) {
    const mappedUser = await env.TOPIC_MAP.get(`thread:${rec.thread_id}`);
    if (!mappedUser) {
      await env.TOPIC_MAP.put(`thread:${rec.thread_id}`, String(userId));
    }
  }
  if (rec.thread_id) {
    const healthResult = await checkThreadHealth(rec.thread_id, env, { userId, retryKey });
    if (healthResult.action === "reverify") {
      await resetUserVerificationAndRequireReverify(env, {
        userId,
        userKey: key,
        oldThreadId: rec.thread_id,
        pendingMsgId: msg.message_id,
        reason: `health_check:${healthResult.status}`
      });
      return;
    }
  }
  if (msg.media_group_id) {
    await handleMediaGroup(msg, env, ctx, {
      direction: "p2t",
      targetChat: env.SUPERGROUP_ID,
      threadId: rec.thread_id
    });
    return;
  }
  await executeMessageForward(msg, userId, rec.thread_id, env);
}
async function checkThreadHealth(threadId, env, { userId, retryKey }) {
  const cacheKey = threadId;
  const now = Date.now();
  const cached = threadHealthCache.get(cacheKey);
  const withinTTL = cached && now - cached.ts < CONFIG.THREAD_HEALTH_TTL_MS;
  if (withinTTL) {
    return { action: "ok", status: cached.ok ? "ok" : "missing" };
  }
  const kvHealthOk = await ephemeralStore(env).getTopicHealth(threadId);
  if (kvHealthOk === true) {
    setBoundedCache(threadHealthCache, cacheKey, { ts: now, ok: true }, THREAD_HEALTH_MAX_ENTRIES);
    return { action: "ok", status: "ok" };
  }
  const probe = await probeForumThread(env, threadId, { userId, reason: "health_check" });
  if (probe.status === "redirected" || probe.status === "missing" || probe.status === "missing_thread_id") {
    return { action: "reverify", status: probe.status };
  }
  if (probe.status === "probe_invalid") {
    Logger.warn("topic_health_probe_invalid_message", {
      userId,
      threadId,
      errorDescription: probe.description
    });
    setBoundedCache(threadHealthCache, cacheKey, { ts: now, ok: true }, THREAD_HEALTH_MAX_ENTRIES);
    await ephemeralStore(env).setTopicHealth(
      threadId,
      true,
      Math.ceil(CONFIG.THREAD_HEALTH_TTL_MS / 1e3)
    );
    return { action: "ok", status: "ok" };
  }
  if (probe.status === "unknown_error") {
    Logger.warn("topic_test_failed_unknown", {
      userId,
      threadId,
      errorDescription: probe.description
    });
    return { action: "ok", status: "unknown" };
  }
  await env.TOPIC_MAP.delete(retryKey);
  setBoundedCache(threadHealthCache, cacheKey, { ts: now, ok: true }, THREAD_HEALTH_MAX_ENTRIES);
  await ephemeralStore(env).setTopicHealth(
    threadId,
    true,
    Math.ceil(CONFIG.THREAD_HEALTH_TTL_MS / 1e3)
  );
  return { action: "ok", status: "ok" };
}
async function executeMessageForward(msg, userId, threadId, env) {
  const res = await tgCall(env, "forwardMessage", {
    chat_id: env.SUPERGROUP_ID,
    from_chat_id: userId,
    message_id: msg.message_id,
    message_thread_id: threadId
  });
  const resThreadId = res.result?.message_thread_id;
  if (res.ok && resThreadId !== void 0 && resThreadId !== null && Number(resThreadId) !== Number(threadId)) {
    await handleForwardRedirect(res, msg, userId, threadId, env, "forward_redirected_to_general");
    return;
  }
  if (res.ok && (resThreadId === void 0 || resThreadId === null)) {
    const probe = await probeForumThread(env, threadId, { userId, reason: "forward_result_missing_thread_id" });
    if (probe.status !== "ok") {
      await handleForwardRedirect(res, msg, userId, threadId, env, `forward_missing_thread_id:${probe.status}`);
      return;
    }
  }
  if (!res.ok) {
    await handleForwardFailure(res, msg, userId, threadId, env);
    return;
  }
  await saveLegacyMessageLink(env, {
    direction: "user_to_admin",
    message: msg,
    targetChatId: env.SUPERGROUP_ID,
    targetMessageId: res.result?.message_id,
    topicId: threadId,
    userId
  });
}
async function handleForwardRedirect(res, msg, userId, threadId, env, reason) {
  Logger.warn("forward_redirected", { userId, expectedThreadId: threadId, reason });
  if (res.result?.message_id) {
    try {
      await tgCall(env, "deleteMessage", {
        chat_id: env.SUPERGROUP_ID,
        message_id: res.result.message_id
      });
    } catch {
    }
  }
  await resetUserVerificationAndRequireReverify(env, {
    userId,
    userKey: `user:${userId}`,
    oldThreadId: threadId,
    pendingMsgId: msg?.message_id || res.result?.message_id,
    reason
  });
}
async function handleForwardFailure(res, msg, userId, threadId, env) {
  const desc = normalizeTgDescription(res.description);
  if (isTopicMissingOrDeleted(desc)) {
    Logger.warn("forward_failed_topic_missing", {
      userId,
      threadId,
      errorDescription: res.description
    });
    await resetUserVerificationAndRequireReverify(env, {
      userId,
      userKey: `user:${userId}`,
      oldThreadId: threadId,
      pendingMsgId: msg.message_id,
      reason: "forward_failed_topic_missing"
    });
    return;
  }
  if (desc.includes("chat not found")) throw new Error(`\u7FA4\u7EC4ID\u9519\u8BEF: ${env.SUPERGROUP_ID}`);
  if (desc.includes("not enough rights")) throw new Error("\u673A\u5668\u4EBA\u6743\u9650\u4E0D\u8DB3 (\u9700 Manage Topics)");
  Logger.warn("forward_fallback_to_copy", {
    userId,
    threadId,
    originalError: res.description
  });
  const copyRes = await tgCall(env, "copyMessage", {
    chat_id: env.SUPERGROUP_ID,
    from_chat_id: userId,
    message_id: msg.message_id,
    message_thread_id: threadId
  });
  if (!copyRes.ok) {
    Logger.error("forward_and_copy_both_failed", copyRes.description, { userId, threadId });
    await notifyAdmin(
      env,
      "forward_failed",
      `\u26A0\uFE0F **\u6D88\u606F\u8F6C\u53D1\u5B8C\u5168\u5931\u8D25**

\u{1F464} \u7528\u6237: \`${userId}\`
\u{1F4DD} \u8BDD\u9898: \`${threadId}\`
\u274C forwardMessage: \`${res.description}\`
\u274C copyMessage: \`${copyRes.description}\``
    );
  }
}
function removeCommandBotSuffix(text) {
  if (!text || !text.startsWith("/")) return text;
  return text.replace(/^\/([a-zA-Z0-9_]+)@[a-zA-Z0-9_]+/, "/$1");
}
async function handleAdminReply(msg, env, ctx) {
  try {
    await _handleAdminReplyInner(msg, env, ctx);
  } catch (e) {
    Logger.error("admin_reply_failed", e, {
      threadId: msg?.message_thread_id,
      senderId: msg?.from?.id
    });
  }
}
async function handleHelpCommand(env, threadId) {
  const helpText = `\u{1F4CB} **\u6307\u4EE4\u5217\u8868**

**\u7528\u6237\u6307\u4EE4\uFF1A**
/start - \u5F00\u59CB\u5BF9\u8BDD\uFF08\u89E6\u53D1\u9A8C\u8BC1\uFF09
/help - \u663E\u793A\u6B64\u5E2E\u52A9\u4FE1\u606F

**\u7BA1\u7406\u5458\u6307\u4EE4\uFF08\u8BDD\u9898\u5185\uFF09\uFF1A**
/close - \u5173\u95ED\u5BF9\u8BDD
/open - \u6062\u590D\u5BF9\u8BDD
/reset - \u91CD\u7F6E\u7528\u6237\u9A8C\u8BC1
/trust - \u8BBE\u7F6E\u6C38\u4E45\u4FE1\u4EFB
/ban - \u5C01\u7981\u7528\u6237
/unban - \u89E3\u5C01\u7528\u6237
/info - \u67E5\u770B\u7528\u6237\u4FE1\u606F
/cleanup - \u6E05\u7406\u65E0\u6548\u8BDD\u9898

**\u5C4F\u853D\u8BCD\u7BA1\u7406\uFF1A**
/addword \u8BCD - \u6DFB\u52A0\u5C4F\u853D\u8BCD
/delword \u8BCD - \u5220\u9664\u5C4F\u853D\u8BCD
/listwords - \u67E5\u770B\u5C4F\u853D\u8BCD\u5217\u8868

**\u5173\u4E8E\uFF1A**
\u2022 \u79C1\u804A\u673A\u5668\u4EBA\u53D1\u9001\u6D88\u606F\uFF0C\u7BA1\u7406\u5458\u5728\u8BDD\u9898\u5185\u56DE\u590D
\u2022 \u652F\u6301\u6587\u672C\u3001\u56FE\u7247\u3001\u89C6\u9891\u3001\u6587\u6863\u7B49\u591A\u79CD\u6D88\u606F\u7C7B\u578B
\u2022 \u5185\u7F6E\u4EBA\u673A\u9A8C\u8BC1\u548C\u5783\u573E\u5185\u5BB9\u8FC7\u6EE4`;
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: helpText, parse_mode: "Markdown" });
}
async function handleAddWordCommand(env, threadId, text, senderId) {
  const word = text.slice(9).trim();
  if (!word) {
    await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "\u26A0\uFE0F \u7528\u6CD5: `/addword \u5C4F\u853D\u8BCD`", parse_mode: "Markdown" });
    return;
  }
  let kvWords = [];
  try {
    const raw = await env.TOPIC_MAP.get("blocked_words_kv");
    if (raw) kvWords = JSON.parse(raw);
  } catch {
  }
  if (!Array.isArray(kvWords)) kvWords = [];
  const allWords = [.../* @__PURE__ */ new Set([...BLOCKED_WORDS, ...kvWords])];
  if (allWords.map((w) => w.toLowerCase()).includes(word.toLowerCase())) {
    await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: `\u26A0\uFE0F \u5C4F\u853D\u8BCD\u300C${word}\u300D\u5DF2\u5B58\u5728\u3002`, parse_mode: "Markdown" });
    return;
  }
  kvWords.push(word);
  await env.TOPIC_MAP.put("blocked_words_kv", JSON.stringify(kvWords));
  blockedWordsCache.data = null;
  Logger.info("blocked_word_added", { word, by: senderId });
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: `\u2705 \u5DF2\u6DFB\u52A0\u5C4F\u853D\u8BCD\u300C${word}\u300D
\u5F53\u524D\u52A8\u6001\u8BCD\u5E93\u5171 ${kvWords.length} \u4E2A\u8BCD`, parse_mode: "Markdown" });
}
async function handleDelWordCommand(env, threadId, text, senderId) {
  const word = text.slice(9).trim();
  if (!word) {
    await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "\u26A0\uFE0F \u7528\u6CD5: `/delword \u5C4F\u853D\u8BCD`", parse_mode: "Markdown" });
    return;
  }
  if (BLOCKED_WORDS.map((w) => w.toLowerCase()).includes(word.toLowerCase())) {
    await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: `\u26A0\uFE0F\u300C${word}\u300D\u662F\u786C\u7F16\u7801\u5C4F\u853D\u8BCD\uFF0C\u65E0\u6CD5\u901A\u8FC7\u547D\u4EE4\u5220\u9664\uFF0C\u8BF7\u76F4\u63A5\u4FEE\u6539\u4EE3\u7801\u4E2D\u7684 BLOCKED_WORDS \u6570\u7EC4\u3002`, parse_mode: "Markdown" });
    return;
  }
  let kvWords = [];
  try {
    const raw = await env.TOPIC_MAP.get("blocked_words_kv");
    if (raw) kvWords = JSON.parse(raw);
  } catch {
  }
  if (!Array.isArray(kvWords)) kvWords = [];
  const before = kvWords.length;
  kvWords = kvWords.filter((w) => w.toLowerCase() !== word.toLowerCase());
  if (kvWords.length === before) {
    await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: `\u26A0\uFE0F \u5C4F\u853D\u8BCD\u300C${word}\u300D\u4E0D\u5B58\u5728\u4E8E\u52A8\u6001\u8BCD\u5E93\u4E2D\u3002`, parse_mode: "Markdown" });
    return;
  }
  await env.TOPIC_MAP.put("blocked_words_kv", JSON.stringify(kvWords));
  blockedWordsCache.data = null;
  Logger.info("blocked_word_removed", { word, by: senderId });
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: `\u2705 \u5DF2\u5220\u9664\u5C4F\u853D\u8BCD\u300C${word}\u300D
\u5F53\u524D\u52A8\u6001\u8BCD\u5E93\u5171 ${kvWords.length} \u4E2A\u8BCD`, parse_mode: "Markdown" });
}
async function handleListWordsCommand(env, threadId) {
  const allWords = await getBlockedWords(env, true);
  let kvWords = [];
  try {
    const raw = await env.TOPIC_MAP.get("blocked_words_kv");
    if (raw) kvWords = JSON.parse(raw);
  } catch {
  }
  if (!Array.isArray(kvWords)) kvWords = [];
  const hardcoded = BLOCKED_WORDS;
  const dynamic = kvWords.filter((w) => !BLOCKED_WORDS.map((h) => h.toLowerCase()).includes(w.toLowerCase()));
  const spamKeywords = parseSpamKeywords((env.SPAM_KEYWORDS || "").toString());
  const blockedTotal = allWords.length;
  let reply = `\u{1F4DD} **\u5185\u5BB9\u8FC7\u6EE4\u8BCD\u5E93**

`;
  reply += `**\u4E00\u3001\u5C4F\u853D\u8BCD**\uFF08\u547D\u4E2D\u540E\u62E6\u622A\u5E76\u63D0\u793A\u7528\u6237\uFF0C\u5171 ${blockedTotal} \u4E2A\uFF09

`;
  reply += `\u{1F527} **\u786C\u7F16\u7801\u8BCD** (${hardcoded.length} \u4E2A\uFF0C\u4FEE\u6539\u9700\u6539\u4EE3\u7801):
`;
  reply += hardcoded.length > 0 ? hardcoded.map((w) => `  \u2022 ${w}`).join("\n") : "  (\u65E0)";
  reply += `

\u{1F4BE} **\u52A8\u6001\u8BCD** (${dynamic.length} \u4E2A\uFF0C\u53EF\u901A\u8FC7 /addword /delword \u7BA1\u7406):
`;
  reply += dynamic.length > 0 ? dynamic.map((w) => `  \u2022 ${w}`).join("\n") : "  (\u65E0)";
  reply += `

**\u4E8C\u3001\u5783\u573E\u5173\u952E\u8BCD SPAM_KEYWORDS**\uFF08\u73AF\u5883\u53D8\u91CF\uFF0C\u8D70 spam \u68C0\u6D4B\uFF1B\u5171 ${spamKeywords.length} \u4E2A\uFF09
`;
  reply += spamKeywords.length > 0 ? spamKeywords.map((w) => `  \u2022 ${w}`).join("\n") : "  (\u672A\u914D\u7F6E\u6216\u4E3A\u7A7A\uFF1B\u5728 Cloudflare Variables \u4E2D\u8BBE\u7F6E SPAM_KEYWORDS\uFF0C\u9017\u53F7\u5206\u9694)";
  reply += `

\u8BF4\u660E\uFF1A/addword \u53EA\u5199\u5165\u300C\u52A8\u6001\u5C4F\u853D\u8BCD\u300D\uFF0C\u4E0D\u4F1A\u6539 SPAM_KEYWORDS \u73AF\u5883\u53D8\u91CF\u3002`;
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: reply, parse_mode: "Markdown" });
}
async function handleCloseCommand(env, threadId, userId) {
  const key = `user:${userId}`;
  const rec = await safeGetJSON(env, key, null);
  if (rec) {
    rec.closed = true;
    await env.TOPIC_MAP.put(key, JSON.stringify(rec));
    await tgCall(env, "closeForumTopic", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId });
    await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "\u{1F6AB} **\u5BF9\u8BDD\u5DF2\u5F3A\u5236\u5173\u95ED**", parse_mode: "Markdown" });
  }
}
async function handleOpenCommand(env, threadId, userId) {
  const key = `user:${userId}`;
  const rec = await safeGetJSON(env, key, null);
  if (rec) {
    rec.closed = false;
    await env.TOPIC_MAP.put(key, JSON.stringify(rec));
    await tgCall(env, "reopenForumTopic", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId });
    await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "\u2705 **\u5BF9\u8BDD\u5DF2\u6062\u590D**", parse_mode: "Markdown" });
  }
}
async function handleResetCommand(env, threadId, userId) {
  await setPersistentTrust(env, userId, "normal");
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "\u{1F504} **\u9A8C\u8BC1\u91CD\u7F6E**", parse_mode: "Markdown" });
}
async function handleTrustCommand(env, threadId, userId) {
  await setPersistentTrust(env, userId, "trusted");
  await env.TOPIC_MAP.delete(`needs_verify:${userId}`);
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "\u{1F31F} **\u5DF2\u8BBE\u7F6E\u6C38\u4E45\u4FE1\u4EFB**", parse_mode: "Markdown" });
}
async function handleBanCommand(env, threadId, userId) {
  await env.TOPIC_MAP.put(`banned:${userId}`, "1");
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "\u{1F6AB} **\u7528\u6237\u5DF2\u5C01\u7981**", parse_mode: "Markdown" });
}
async function handleUnbanCommand(env, threadId, userId) {
  await env.TOPIC_MAP.delete(`banned:${userId}`);
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "\u2705 **\u7528\u6237\u5DF2\u89E3\u5C01**", parse_mode: "Markdown" });
}
async function handleInfoCommand(env, threadId, userId) {
  const userKey = `user:${userId}`;
  const userRec = await safeGetJSON(env, userKey, null);
  const verifyStatus = await getVerificationState(env, userId);
  const banStatus = await env.TOPIC_MAP.get(`banned:${userId}`);
  const info = `\u{1F464} **\u7528\u6237\u4FE1\u606F**
UID: \`${userId}\`
Topic ID: \`${threadId}\`
\u8BDD\u9898\u6807\u9898: ${userRec?.title || "\u672A\u77E5"}
\u9A8C\u8BC1\u72B6\u6001: ${verifyStatus ? verifyStatus.type === "trusted" ? "\u{1F31F} \u6C38\u4E45\u4FE1\u4EFB" : "\u2705 \u5DF2\u9A8C\u8BC1" : "\u274C \u672A\u9A8C\u8BC1"}
\u5C01\u7981\u72B6\u6001: ${banStatus ? "\u{1F6AB} \u5DF2\u5C01\u7981" : "\u2705 \u6B63\u5E38"}
Link: [\u70B9\u51FB\u79C1\u804A](tg://user?id=${userId})`;
  await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: info, parse_mode: "Markdown" });
}
async function _handleAdminReplyInner(msg, env, ctx) {
  const threadId = msg.message_thread_id;
  const rawText = (msg.text || "").trim();
  const text = removeCommandBotSuffix(rawText);
  const senderId = msg.from?.id;
  if (!senderId || !await isAdminUser(env, senderId)) {
    return;
  }
  if (text === "/cleanup") {
    ctx.waitUntil(handleCleanupCommand(threadId, env));
    return;
  }
  if (text === "/help") {
    await handleHelpCommand(env, threadId);
    return;
  }
  if (text.startsWith("/addword ")) {
    await handleAddWordCommand(env, threadId, text, senderId);
    return;
  }
  if (text.startsWith("/delword ")) {
    await handleDelWordCommand(env, threadId, text, senderId);
    return;
  }
  if (text === "/listwords") {
    await handleListWordsCommand(env, threadId);
    return;
  }
  let userId = null;
  const mappedUser = await env.TOPIC_MAP.get(`thread:${threadId}`);
  if (mappedUser) {
    userId = Number(mappedUser);
  } else if (threadNotFoundCache.has(threadId) && Date.now() - threadNotFoundCache.get(threadId) < THREAD_NOT_FOUND_TTL_MS) {
    return;
  } else {
    const allKeys = await getAllKeys(env, "user:");
    let scanned = 0;
    for (const { name } of allKeys) {
      if (++scanned > 200) break;
      const rec = await safeGetJSON(env, name, null);
      if (rec && Number(rec.thread_id) === Number(threadId)) {
        userId = Number(name.slice(5));
        break;
      }
    }
    if (!userId) {
      if (threadNotFoundCache.size >= THREAD_NOT_FOUND_MAX_ENTRIES) {
        threadNotFoundCache.delete(threadNotFoundCache.keys().next().value);
      }
      threadNotFoundCache.set(threadId, Date.now());
    }
  }
  if (!userId) return;
  if (text === "/close") {
    await handleCloseCommand(env, threadId, userId);
    return;
  }
  if (text === "/open") {
    await handleOpenCommand(env, threadId, userId);
    return;
  }
  if (text === "/reset") {
    await handleResetCommand(env, threadId, userId);
    return;
  }
  if (text === "/trust") {
    await handleTrustCommand(env, threadId, userId);
    return;
  }
  if (text === "/ban") {
    await handleBanCommand(env, threadId, userId);
    return;
  }
  if (text === "/unban") {
    await handleUnbanCommand(env, threadId, userId);
    return;
  }
  if (text === "/info") {
    await handleInfoCommand(env, threadId, userId);
    return;
  }
  if (msg.media_group_id) {
    await handleMediaGroup(msg, env, ctx, { direction: "t2p", targetChat: userId, threadId: void 0 });
    return;
  }
  const response = await tgCall(env, "copyMessage", {
    chat_id: userId,
    from_chat_id: env.SUPERGROUP_ID,
    message_id: msg.message_id
  });
  if (response.ok) {
    await saveLegacyMessageLink(env, {
      direction: "admin_to_user",
      message: msg,
      targetChatId: userId,
      targetMessageId: response.result?.message_id,
      topicId: threadId,
      userId
    });
  }
}
async function sendVerificationChallenge(userId, env, pendingMsgId) {
  const writtenKeys = [];
  try {
    await _sendVerificationChallengeInner(userId, env, pendingMsgId, writtenKeys);
  } catch (e) {
    Logger.error("verification_challenge_failed", e, { userId });
    for (const key of writtenKeys) {
      try {
        await env.TOPIC_MAP.delete(key);
      } catch {
      }
    }
    throw e;
  }
}
async function _sendVerificationChallengeInner(userId, env, pendingMsgId, writtenKeys) {
  const existingChallenge = await env.TOPIC_MAP.get(`user_challenge:${userId}`);
  if (existingChallenge) {
    const chalKey = `chal:${existingChallenge}`;
    const state = await safeGetJSON(env, chalKey, null);
    if (!state || state.userId !== userId) {
      await env.TOPIC_MAP.delete(`user_challenge:${userId}`);
    } else {
      if (pendingMsgId) {
        let pendingIds = [];
        if (Array.isArray(state.pending_ids)) {
          pendingIds = state.pending_ids.slice();
        } else if (state.pending) {
          pendingIds = [state.pending];
        }
        if (!pendingIds.includes(pendingMsgId)) {
          pendingIds.push(pendingMsgId);
          if (pendingIds.length > CONFIG.PENDING_MAX_MESSAGES) {
            pendingIds = pendingIds.slice(pendingIds.length - CONFIG.PENDING_MAX_MESSAGES);
          }
          state.pending_ids = pendingIds;
          delete state.pending;
          await env.TOPIC_MAP.put(chalKey, JSON.stringify(state), { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });
        }
      }
      Logger.debug("verification_duplicate_skipped", { userId, verifyId: existingChallenge, hasPending: !!pendingMsgId });
      return;
    }
  }
  const verifyLimit = await checkRateLimit(userId, env, "verify", CONFIG.RATE_LIMIT_VERIFY, 300);
  if (!verifyLimit.allowed) {
    await tgCall(env, "sendMessage", {
      chat_id: userId,
      text: "\u26A0\uFE0F \u9A8C\u8BC1\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF75\u5206\u949F\u540E\u518D\u8BD5\u3002"
    });
    return;
  }
  const hasTurnstile = !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.VERIFICATION_PAGE_URL);
  if (hasTurnstile) {
    await sendTurnstileChallenge(userId, env, pendingMsgId, writtenKeys);
  } else {
    await sendLocalQuizChallenge(userId, env, pendingMsgId, writtenKeys);
  }
}
async function sendTurnstileChallenge(userId, env, pendingMsgId, writtenKeys) {
  const verifyCode = generateVerifyCode();
  const verifyUrl = `${env.VERIFICATION_PAGE_URL}/verify?code=${verifyCode}&uid=${userId}`;
  await env.TOPIC_MAP.put(`turnstile_code:${verifyCode}`, String(userId), { expirationTtl: CONFIG.TURNSTILE_VERIFY_TTL });
  writtenKeys.push(`turnstile_code:${verifyCode}`);
  if (pendingMsgId) {
    const pendingKey = `pending_turnstile:${userId}`;
    let pendingIds = [];
    try {
      const raw = await env.TOPIC_MAP.get(pendingKey);
      if (raw) pendingIds = JSON.parse(raw);
    } catch {
    }
    if (!Array.isArray(pendingIds)) pendingIds = [];
    if (!pendingIds.includes(pendingMsgId)) {
      pendingIds.push(pendingMsgId);
      if (pendingIds.length > CONFIG.PENDING_MAX_MESSAGES) {
        pendingIds = pendingIds.slice(pendingIds.length - CONFIG.PENDING_MAX_MESSAGES);
      }
      await env.TOPIC_MAP.put(pendingKey, JSON.stringify(pendingIds), { expirationTtl: CONFIG.TURNSTILE_VERIFY_TTL });
      writtenKeys.push(pendingKey);
    }
  }
  await env.TOPIC_MAP.put(`user_challenge:${userId}`, `turnstile:${verifyCode}`, { expirationTtl: CONFIG.TURNSTILE_VERIFY_TTL });
  writtenKeys.push(`user_challenge:${userId}`);
  Logger.info("turnstile_verification_sent", { userId, verifyCode });
  const verifyMsg = await tgCall(env, "sendMessage", {
    chat_id: userId,
    text: `\u{1F6E1}\uFE0F **\u4EBA\u673A\u9A8C\u8BC1**

\u8BF7\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u5B8C\u6210\u9A8C\u8BC1\uFF0C\u9A8C\u8BC1\u901A\u8FC7\u540E\u60A8\u7684\u6D88\u606F\u5C06\u81EA\u52A8\u9001\u8FBE\u3002`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[
        { text: "\u{1F510} \u70B9\u51FB\u9A8C\u8BC1", url: verifyUrl }
      ]]
    }
  });
  if (!verifyMsg.ok) {
    throw new Error(`Turnstile \u9A8C\u8BC1\u6D88\u606F\u53D1\u9001\u5931\u8D25: ${verifyMsg.description || "\u672A\u77E5\u9519\u8BEF"}`);
  }
  if (verifyMsg.result?.message_id) {
    await env.TOPIC_MAP.put(`turnstile_msg:${verifyCode}`, String(verifyMsg.result.message_id), { expirationTtl: CONFIG.TURNSTILE_VERIFY_TTL });
    writtenKeys.push(`turnstile_msg:${verifyCode}`);
  }
}
async function sendLocalQuizChallenge(userId, env, pendingMsgId, writtenKeys) {
  const q = LOCAL_QUESTIONS[secureRandomInt(0, LOCAL_QUESTIONS.length)];
  const challenge = {
    question: q.question,
    correct: q.correct_answer,
    options: shuffleArray([...q.incorrect_answers, q.correct_answer])
  };
  const verifyId = secureRandomId(CONFIG.VERIFY_ID_LENGTH);
  const answerIndex = challenge.options.indexOf(challenge.correct);
  const state = {
    answerIndex,
    options: challenge.options,
    pending_ids: pendingMsgId ? [pendingMsgId] : [],
    userId
  };
  await env.TOPIC_MAP.put(`chal:${verifyId}`, JSON.stringify(state), { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });
  writtenKeys.push(`chal:${verifyId}`);
  await env.TOPIC_MAP.put(`user_challenge:${userId}`, verifyId, { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });
  writtenKeys.push(`user_challenge:${userId}`);
  Logger.info("verification_sent", {
    userId,
    verifyId,
    question: q.question,
    pendingCount: state.pending_ids.length
  });
  const buttons = challenge.options.map((opt, idx) => ({
    text: opt,
    callback_data: `verify:${verifyId}:${idx}`
  }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += CONFIG.BUTTON_COLUMNS) {
    keyboard.push(buttons.slice(i, i + CONFIG.BUTTON_COLUMNS));
  }
  const quizMsg = await tgCall(env, "sendMessage", {
    chat_id: userId,
    text: `\u{1F6E1}\uFE0F **\u4EBA\u673A\u9A8C\u8BC1**

${challenge.question}

\u8BF7\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u56DE\u7B54 (\u56DE\u7B54\u6B63\u786E\u540E\u5C06\u81EA\u52A8\u53D1\u9001\u60A8\u521A\u624D\u7684\u6D88\u606F)\u3002`,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  });
  if (!quizMsg.ok) {
    throw new Error(`\u672C\u5730\u9898\u5E93\u9A8C\u8BC1\u6D88\u606F\u53D1\u9001\u5931\u8D25: ${quizMsg.description || "\u672A\u77E5\u9519\u8BEF"}`);
  }
}
async function handleCallbackQuery(query, env, ctx) {
  try {
    const data = query.data;
    if (!data.startsWith("verify:")) return;
    const parts = data.split(":");
    if (parts.length !== 3) return;
    const verifyId = parts[1];
    const selectedIndex = parseInt(parts[2]);
    const userId = query.from.id;
    const stateStr = await env.TOPIC_MAP.get(`chal:${verifyId}`);
    if (!stateStr) {
      await tgCall(env, "answerCallbackQuery", {
        callback_query_id: query.id,
        text: "\u274C \u9A8C\u8BC1\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u53D1\u6D88\u606F",
        show_alert: true
      });
      return;
    }
    let state;
    try {
      state = JSON.parse(stateStr);
    } catch (e) {
      await tgCall(env, "answerCallbackQuery", {
        callback_query_id: query.id,
        text: "\u274C \u6570\u636E\u9519\u8BEF",
        show_alert: true
      });
      return;
    }
    if (state.userId && state.userId !== userId) {
      await tgCall(env, "answerCallbackQuery", {
        callback_query_id: query.id,
        text: "\u274C \u65E0\u6548\u7684\u9A8C\u8BC1",
        show_alert: true
      });
      return;
    }
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.options.length) {
      await tgCall(env, "answerCallbackQuery", {
        callback_query_id: query.id,
        text: "\u274C \u65E0\u6548\u9009\u9879",
        show_alert: true
      });
      return;
    }
    if (selectedIndex === state.answerIndex) {
      await tgCall(env, "answerCallbackQuery", {
        callback_query_id: query.id,
        text: "\u2705 \u9A8C\u8BC1\u901A\u8FC7"
      });
      Logger.info("verification_passed", {
        userId,
        verifyId,
        selectedOption: state.options[selectedIndex]
      });
      await ephemeralStore(env).setVerification(userId, {
        ttl: CONFIG.VERIFIED_EXPIRE_SECONDS,
        verifiedAt: Date.now()
      });
      await env.TOPIC_MAP.delete(`needs_verify:${userId}`);
      await env.TOPIC_MAP.delete(`chal:${verifyId}`);
      await env.TOPIC_MAP.delete(`user_challenge:${userId}`);
      await tgCall(env, "editMessageText", {
        chat_id: userId,
        message_id: query.message.message_id,
        text: "\u2705 **\u9A8C\u8BC1\u6210\u529F**\n\n\u60A8\u73B0\u5728\u53EF\u4EE5\u81EA\u7531\u5BF9\u8BDD\u4E86\u3002",
        parse_mode: "Markdown"
      });
      const hasPending = Array.isArray(state.pending_ids) && state.pending_ids.length > 0 || !!state.pending;
      if (hasPending) {
        await forwardPendingMessages(state, userId, query, env, ctx);
      }
    } else {
      Logger.info("verification_failed", {
        userId,
        verifyId,
        selectedIndex,
        correctIndex: state.answerIndex
      });
      await tgCall(env, "answerCallbackQuery", {
        callback_query_id: query.id,
        text: "\u274C \u7B54\u6848\u9519\u8BEF",
        show_alert: true
      });
    }
  } catch (e) {
    Logger.error("callback_query_error", e, {
      userId: query.from?.id,
      callbackData: query.data
    });
    await tgCall(env, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: `\u26A0\uFE0F \u7CFB\u7EDF\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5`,
      show_alert: true
    });
  }
}
async function forwardPendingMessages(state, userId, query, env, ctx) {
  try {
    let pendingIds = [];
    if (Array.isArray(state.pending_ids)) {
      pendingIds = state.pending_ids.slice();
    } else if (state.pending) {
      pendingIds = [state.pending];
    }
    if (pendingIds.length > CONFIG.PENDING_MAX_MESSAGES) {
      pendingIds = pendingIds.slice(pendingIds.length - CONFIG.PENDING_MAX_MESSAGES);
    }
    const CONCURRENT_FORWARDS = 3;
    let forwardedCount = 0;
    let skippedCount = 0;
    for (let i = 0; i < pendingIds.length; i += CONCURRENT_FORWARDS) {
      const batch = pendingIds.slice(i, i + CONCURRENT_FORWARDS);
      const results = await Promise.allSettled(batch.map(async (pendingId) => {
        if (!pendingId) return { forwarded: false, reason: "empty_id" };
        const forwardedKey = `forwarded:${userId}:${pendingId}`;
        const alreadyForwarded = await env.TOPIC_MAP.get(forwardedKey);
        if (alreadyForwarded) {
          Logger.info("message_forward_duplicate_skipped", { userId, messageId: pendingId });
          return { forwarded: false, reason: "already_forwarded" };
        }
        const fakeMsg = {
          message_id: pendingId,
          chat: { id: userId, type: "private" },
          from: query.from
        };
        await forwardToTopic(fakeMsg, userId, `user:${userId}`, env, ctx);
        await env.TOPIC_MAP.put(forwardedKey, "1", { expirationTtl: 3600 });
        return { forwarded: true };
      }));
      for (const r of results) {
        if (r.status === "fulfilled" && r.value?.forwarded) {
          forwardedCount++;
        } else if (r.status === "fulfilled" && !r.value?.forwarded) {
          skippedCount++;
        } else if (r.status === "rejected") {
          Logger.warn("pending_forward_item_failed", { userId, error: r.reason?.message });
        }
      }
    }
    if (forwardedCount > 0) {
      await tgCall(env, "sendMessage", {
        chat_id: userId,
        text: `\u{1F4E9} \u521A\u624D\u7684 ${forwardedCount} \u6761\u6D88\u606F\u5DF2\u5E2E\u60A8\u9001\u8FBE\u3002`
      });
    }
  } catch (e) {
    Logger.error("pending_message_forward_failed", e, { userId });
    await tgCall(env, "sendMessage", {
      chat_id: userId,
      text: "\u26A0\uFE0F \u81EA\u52A8\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u60A8\u7684\u6D88\u606F\u3002"
    });
  }
}
async function handleCleanupCommand(threadId, env) {
  const lockKey = "cleanup:lock";
  const locked = await env.TOPIC_MAP.get(lockKey);
  if (locked) {
    await tgCall(env, "sendMessage", withMessageThreadId({
      chat_id: env.SUPERGROUP_ID,
      text: "\u23F3 **\u5DF2\u6709\u6E05\u7406\u4EFB\u52A1\u6B63\u5728\u8FD0\u884C\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002**",
      parse_mode: "Markdown"
    }, threadId));
    return;
  }
  await env.TOPIC_MAP.put(lockKey, "1", { expirationTtl: CONFIG.CLEANUP_LOCK_TTL_SECONDS });
  await tgCall(env, "sendMessage", withMessageThreadId({
    chat_id: env.SUPERGROUP_ID,
    text: "\u{1F504} **\u6B63\u5728\u626B\u63CF\u9700\u8981\u6E05\u7406\u7684\u7528\u6237...**",
    parse_mode: "Markdown"
  }, threadId));
  let cleanedCount = 0;
  let errorCount = 0;
  const cleanedUsers = [];
  let scannedCount = 0;
  try {
    let cursor = void 0;
    do {
      const result = await env.TOPIC_MAP.list({ prefix: "user:", cursor });
      const names = (result.keys || []).map((k) => k.name);
      scannedCount += names.length;
      for (let i = 0; i < names.length; i += CONFIG.CLEANUP_BATCH_SIZE) {
        const batch = names.slice(i, i + CONFIG.CLEANUP_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (name) => {
            const rec = await safeGetJSON(env, name, null);
            if (!rec || !rec.thread_id) return null;
            const userId = name.slice(5);
            const topicThreadId = rec.thread_id;
            const probe = await probeForumThread(env, topicThreadId, {
              userId,
              reason: "cleanup_check",
              doubleCheckOnMissingThreadId: false
            });
            if (probe.status === "redirected" || probe.status === "missing") {
              await env.TOPIC_MAP.delete(name);
              await setPersistentTrust(env, userId, "normal");
              await env.TOPIC_MAP.delete(`thread:${topicThreadId}`);
              return {
                userId,
                threadId: topicThreadId,
                title: rec.title || "\u672A\u77E5"
              };
            } else if (probe.status === "probe_invalid") {
              Logger.warn("cleanup_probe_invalid_message", {
                userId,
                threadId: topicThreadId,
                errorDescription: probe.description
              });
            } else if (probe.status === "unknown_error") {
              Logger.warn("cleanup_probe_failed_unknown", {
                userId,
                threadId: topicThreadId,
                errorDescription: probe.description
              });
            } else if (probe.status === "missing_thread_id") {
              Logger.warn("cleanup_probe_missing_thread_id", { userId, threadId: topicThreadId });
            }
            return null;
          })
        );
        results.forEach((result2) => {
          if (result2.status === "fulfilled" && result2.value) {
            cleanedCount++;
            cleanedUsers.push(result2.value);
            Logger.info("cleanup_user", {
              userId: result2.value.userId,
              threadId: result2.value.threadId
            });
          } else if (result2.status === "rejected") {
            errorCount++;
            Logger.error("cleanup_batch_error", result2.reason);
          }
        });
        if (i + CONFIG.CLEANUP_BATCH_SIZE < names.length) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      cursor = result.list_complete ? void 0 : result.cursor;
      if (cursor) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } while (cursor);
    let reportText = `\u2705 **\u6E05\u7406\u5B8C\u6210**

`;
    reportText += `\u{1F4CA} **\u7EDF\u8BA1\u4FE1\u606F**
`;
    reportText += `- \u626B\u63CF\u7528\u6237\u6570: ${scannedCount}
`;
    reportText += `- \u5DF2\u6E05\u7406\u7528\u6237\u6570: ${cleanedCount}
`;
    reportText += `- \u9519\u8BEF\u6570: ${errorCount}

`;
    if (cleanedCount > 0) {
      reportText += `\u{1F5D1}\uFE0F **\u5DF2\u6E05\u7406\u7684\u7528\u6237** (\u8BDD\u9898\u5DF2\u5220\u9664):
`;
      for (const user of cleanedUsers.slice(0, CONFIG.MAX_CLEANUP_DISPLAY)) {
        reportText += `- UID: \`${user.userId}\` | \u8BDD\u9898: ${user.title}
`;
      }
      if (cleanedUsers.length > CONFIG.MAX_CLEANUP_DISPLAY) {
        reportText += `
...(\u8FD8\u6709 ${cleanedUsers.length - CONFIG.MAX_CLEANUP_DISPLAY} \u4E2A\u7528\u6237)
`;
      }
      reportText += `
\u{1F4A1} \u8FD9\u4E9B\u7528\u6237\u4E0B\u6B21\u53D1\u6D88\u606F\u65F6\u5C06\u91CD\u65B0\u8FDB\u884C\u4EBA\u673A\u9A8C\u8BC1\u5E76\u521B\u5EFA\u65B0\u8BDD\u9898\u3002`;
    } else {
      reportText += `\u2728 \u6CA1\u6709\u53D1\u73B0\u9700\u8981\u6E05\u7406\u7684\u7528\u6237\u8BB0\u5F55\u3002`;
    }
    Logger.info("cleanup_completed", {
      cleanedCount,
      errorCount,
      totalUsers: scannedCount
    });
    await tgCall(env, "sendMessage", withMessageThreadId({
      chat_id: env.SUPERGROUP_ID,
      text: reportText,
      parse_mode: "Markdown"
    }, threadId));
  } catch (e) {
    Logger.error("cleanup_failed", e, { threadId });
    await tgCall(env, "sendMessage", withMessageThreadId({
      chat_id: env.SUPERGROUP_ID,
      text: `\u274C **\u6E05\u7406\u8FC7\u7A0B\u51FA\u9519**

\u9519\u8BEF\u4FE1\u606F: \`${e.message}\``,
      parse_mode: "Markdown"
    }, threadId));
  } finally {
    await env.TOPIC_MAP.delete(lockKey);
  }
}
async function createTopic(from, key, env, userId) {
  const title = buildTopicTitle2(from);
  if (!env.SUPERGROUP_ID.toString().startsWith("-100")) throw new Error("SUPERGROUP_ID\u5FC5\u987B\u4EE5-100\u5F00\u5934");
  const res = await tgCall(env, "createForumTopic", { chat_id: env.SUPERGROUP_ID, name: title });
  if (!res.ok) throw new Error(`\u521B\u5EFA\u8BDD\u9898\u5931\u8D25: ${res.description}`);
  const rec = { thread_id: res.result.message_thread_id, title, closed: false };
  await env.TOPIC_MAP.put(key, JSON.stringify(rec));
  if (userId) {
    await env.TOPIC_MAP.put(`thread:${rec.thread_id}`, String(userId));
  }
  return rec;
}
async function updateThreadStatus(threadId, isClosed, env) {
  try {
    const mappedUser = await env.TOPIC_MAP.get(`thread:${threadId}`);
    if (mappedUser) {
      const userKey = `user:${mappedUser}`;
      const rec = await safeGetJSON(env, userKey, null);
      if (rec && Number(rec.thread_id) === Number(threadId)) {
        rec.closed = isClosed;
        await env.TOPIC_MAP.put(userKey, JSON.stringify(rec));
        Logger.info("thread_status_updated", { threadId, isClosed, updatedCount: 1 });
        return;
      }
      await env.TOPIC_MAP.delete(`thread:${threadId}`);
    }
    const allKeys = await getAllKeys(env, "user:");
    const updates = [];
    for (const { name } of allKeys) {
      const rec = await safeGetJSON(env, name, null);
      if (rec && Number(rec.thread_id) === Number(threadId)) {
        rec.closed = isClosed;
        updates.push(env.TOPIC_MAP.put(name, JSON.stringify(rec)));
      }
    }
    await Promise.all(updates);
    Logger.info("thread_status_updated", { threadId, isClosed, updatedCount: updates.length });
  } catch (e) {
    Logger.error("thread_status_update_failed", e, { threadId, isClosed });
    throw e;
  }
}
function buildTopicTitle2(from) {
  const firstName = (from.first_name || "").trim().substring(0, CONFIG.MAX_NAME_LENGTH);
  const lastName = (from.last_name || "").trim().substring(0, CONFIG.MAX_NAME_LENGTH);
  let username = "";
  if (from.username) {
    username = from.username.replace(/[^\w]/g, "").substring(0, 20);
  }
  const cleanName = (firstName + " " + lastName).replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/\s+/g, " ").trim();
  const name = cleanName || "User";
  const usernameStr = username ? ` @${username}` : "";
  const title = (name + usernameStr).substring(0, CONFIG.MAX_TITLE_LENGTH);
  return title;
}
async function tgCall(env, method, body, timeout = CONFIG.API_TIMEOUT_MS) {
  const client = createTelegramClient({
    botToken: env.BOT_TOKEN,
    apiBase: env.API_BASE,
    timeoutMs: timeout,
    logger: Logger
  });
  try {
    return await client.call(method, body);
  } catch (error) {
    if (error instanceof TelegramApiError) {
      Logger.error("telegram_api_failed", error, {
        method,
        category: error.category,
        attempts: error.attempts
      });
      return error.response || {
        ok: false,
        error_code: error.status || void 0,
        description: error.message,
        parameters: error.retryAfter ? { retry_after: error.retryAfter } : void 0
      };
    }
    throw error;
  }
}
async function handleMediaGroup(msg, env, ctx, { direction, targetChat, threadId }) {
  const groupId = msg.media_group_id;
  const key = `mg:${direction}:${groupId}`;
  const item = extractMedia(msg);
  if (!item) {
    await tgCall(env, "copyMessage", withMessageThreadId({
      chat_id: targetChat,
      from_chat_id: msg.chat.id,
      message_id: msg.message_id
    }, threadId));
    return;
  }
  let rec = await safeGetJSON(env, key, null);
  if (!rec) rec = { direction, targetChat, threadId: threadId === null ? void 0 : threadId, items: [], last_ts: Date.now() };
  rec.items.push({ ...item, msg_id: msg.message_id });
  rec.last_ts = Date.now();
  await env.TOPIC_MAP.put(key, JSON.stringify(rec), { expirationTtl: CONFIG.MEDIA_GROUP_EXPIRE_SECONDS });
  ctx.waitUntil(delaySend(env, key, rec.last_ts));
}
function extractMedia(msg) {
  if (msg.photo && msg.photo.length > 0) {
    const highestResolution = msg.photo[msg.photo.length - 1];
    return {
      type: "photo",
      id: highestResolution.file_id,
      cap: msg.caption || ""
    };
  }
  if (msg.video) {
    return {
      type: "video",
      id: msg.video.file_id,
      cap: msg.caption || ""
    };
  }
  if (msg.document) {
    return {
      type: "document",
      id: msg.document.file_id,
      cap: msg.caption || ""
    };
  }
  if (msg.audio) {
    return {
      type: "audio",
      id: msg.audio.file_id,
      cap: msg.caption || ""
    };
  }
  if (msg.animation) {
    return {
      type: "animation",
      id: msg.animation.file_id,
      cap: msg.caption || ""
    };
  }
  return null;
}
async function flushExpiredMediaGroups(env, now) {
  try {
    const prefix = "mg:";
    const allKeys = await getAllKeys(env, prefix);
    let deletedCount = 0;
    for (const { name } of allKeys) {
      const rec = await safeGetJSON(env, name, null);
      if (rec && rec.last_ts && now - rec.last_ts > 3e5) {
        await env.TOPIC_MAP.delete(name);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      Logger.info("media_groups_cleaned", { deletedCount });
    }
  } catch (e) {
    Logger.error("media_group_cleanup_failed", e);
  }
}
async function delaySend(env, key, ts) {
  await new Promise((r) => setTimeout(r, CONFIG.MEDIA_GROUP_DELAY_MS));
  const rec = await safeGetJSON(env, key, null);
  if (rec && rec.last_ts === ts) {
    if (!rec.items || rec.items.length === 0) {
      Logger.warn("media_group_empty", { key });
      await env.TOPIC_MAP.delete(key);
      return;
    }
    const media = rec.items.map((it, i) => {
      if (!it.type || !it.id) {
        Logger.warn("media_group_invalid_item", { key, item: it });
        return null;
      }
      const caption = i === 0 ? (it.cap || "").substring(0, 1024) : "";
      return {
        type: it.type,
        media: it.id,
        caption
      };
    }).filter(Boolean);
    if (media.length > 0) {
      try {
        const result = await tgCall(env, "sendMediaGroup", withMessageThreadId({
          chat_id: rec.targetChat,
          media
        }, rec.threadId));
        if (!result.ok) {
          Logger.error("media_group_send_failed", result.description, {
            key,
            mediaCount: media.length
          });
        } else {
          Logger.info("media_group_sent", {
            key,
            mediaCount: media.length,
            targetChat: rec.targetChat
          });
        }
      } catch (e) {
        Logger.error("media_group_send_exception", e, { key });
      }
    }
    await env.TOPIC_MAP.delete(key);
  }
}
var workerApp = createApp({
  handleFetch: legacyApp.fetch.bind(legacyApp)
});
var worker_default = {
  fetch: workerApp.fetch.bind(workerApp),
  scheduled(event, env, ctx) {
    ctx.waitUntil(workerApp.scheduled(event, env, ctx));
  }
};
export {
  worker_default as default
};
