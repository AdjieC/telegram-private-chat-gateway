const migrationPromises = new WeakMap();

const SCHEMA_MIGRATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;

export const VERSION_1_STATEMENTS = [
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
    ON admin_audit_log(created_at)`,
];

async function runMigrations(db, now) {
  await db.prepare(SCHEMA_MIGRATIONS_SQL).run();
  const applied = await db.prepare(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
  ).first();
  if (Number(applied?.version ?? 0) >= 1) return;

  await db.batch(VERSION_1_STATEMENTS.map(sql => db.prepare(sql)));
  await db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  ).bind(1, 'initial_schema', now).run();
}

export function ensureMigrations(db, now = Date.now()) {
  if (!migrationPromises.has(db)) {
    const promise = runMigrations(db, now).catch(error => {
      migrationPromises.delete(db);
      throw error;
    });
    migrationPromises.set(db, promise);
  }
  return migrationPromises.get(db);
}
