import type Database from 'better-sqlite3';

/**
 * Linear migrations. Each migration runs at most once.
 *
 * Schema design notes:
 *  - No raw email bodies are stored — only the small snippet projection.
 *  - `emails` rows are intentionally short-lived. The retention worker prunes
 *    them according to user preference (`retainEmailMetadataDays`).
 *  - Memory data lives in `contacts` / `awaited_replies` and is decayed, not
 *    accumulated forever.
 */

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    id: 4,
    name: 'sender_profiles_and_signals',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sender_profiles (
          email TEXT PRIMARY KEY,
          domain TEXT NOT NULL,
          display_name TEXT,
          kind TEXT NOT NULL DEFAULT 'unknown',
          affiliation TEXT,
          message_count INTEGER NOT NULL DEFAULT 0,
          bulk_signal_count INTEGER NOT NULL DEFAULT 0,
          human_signal_count INTEGER NOT NULL DEFAULT 0,
          confidence INTEGER NOT NULL DEFAULT 0,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          pinned INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sender_profiles_kind ON sender_profiles(kind);
        CREATE INDEX IF NOT EXISTS idx_sender_profiles_domain ON sender_profiles(domain);
      `);
    },
  },
  {
    id: 3,
    name: 'sent_poll_and_vip_suggestions',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS processed_sent_messages (
          message_id TEXT PRIMARY KEY,
          processed_at INTEGER NOT NULL
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS vip_suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_email TEXT NOT NULL UNIQUE,
          awaited_count INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          resolution TEXT
        );
      `);
    },
  },
  {
    id: 2,
    name: 'email_category_and_open_count',
    up: (db) => {
      db.exec(`
        ALTER TABLE emails ADD COLUMN category TEXT NOT NULL DEFAULT 'personal';
      `);
      db.exec(`
        ALTER TABLE emails ADD COLUMN open_count INTEGER NOT NULL DEFAULT 0;
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_emails_category ON emails(category);
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS category_suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_email TEXT NOT NULL,
          category TEXT NOT NULL,
          open_count INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          resolution TEXT,
          UNIQUE(sender_email, category)
        );
      `);
    },
  },
  {
    id: 1,
    name: 'init',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS preferences (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS contacts (
          email TEXT PRIMARY KEY,
          display_name TEXT,
          is_vip INTEGER NOT NULL DEFAULT 0,
          importance INTEGER NOT NULL DEFAULT 0,
          avg_reply_minutes INTEGER,
          last_interaction_at INTEGER,
          topic_tags TEXT NOT NULL DEFAULT '[]',
          notes TEXT,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS awaited_replies (
          thread_id TEXT PRIMARY KEY,
          contact TEXT NOT NULL,
          subject TEXT NOT NULL,
          sent_at INTEGER NOT NULL,
          expected_by_minutes INTEGER,
          status TEXT NOT NULL DEFAULT 'waiting',
          reason TEXT NOT NULL DEFAULT 'user_marked',
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS emails (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          from_email TEXT NOT NULL,
          from_name TEXT,
          to_json TEXT NOT NULL,
          subject TEXT NOT NULL,
          snippet TEXT NOT NULL,
          received_at INTEGER NOT NULL,
          is_unread INTEGER NOT NULL,
          labels_json TEXT NOT NULL,
          importance_score INTEGER NOT NULL DEFAULT 0,
          priority TEXT NOT NULL DEFAULT 'LOW',
          reasons_json TEXT NOT NULL DEFAULT '[]',
          seen_by_user INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at DESC);
        CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
        CREATE INDEX IF NOT EXISTS idx_emails_priority ON emails(priority);

        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          priority TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          email_id TEXT,
          created_at INTEGER NOT NULL,
          delivered INTEGER NOT NULL DEFAULT 0,
          dismissed INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS briefings (
          id TEXT PRIMARY KEY,
          generated_at INTEGER NOT NULL,
          generated_by TEXT NOT NULL,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS proposal_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL,
          action TEXT NOT NULL,
          target_contact TEXT,
          target_thread_id TEXT,
          delta INTEGER,
          topic TEXT,
          reason_type TEXT NOT NULL,
          applied INTEGER NOT NULL,
          rejection_reason TEXT
        );
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    run_at INTEGER NOT NULL
  );`);

  const applied = new Set(
    db
      .prepare<[], { id: number }>('SELECT id FROM migrations')
      .all()
      .map((r) => r.id),
  );

  const insertMigration = db.prepare(
    'INSERT INTO migrations (id, name, run_at) VALUES (?, ?, ?)',
  );

  const ordered = [...MIGRATIONS].sort((a, b) => a.id - b.id);
  for (const m of ordered) {
    if (applied.has(m.id)) continue;
    const txn = db.transaction(() => {
      m.up(db);
      insertMigration.run(m.id, m.name, Date.now());
    });
    txn();
  }
}
