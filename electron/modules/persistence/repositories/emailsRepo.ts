import { getDb } from '../db';
import type {
  EmailAddress,
  EmailCategory,
  EmailSummary,
  ImportanceReason,
  NotificationPriority,
} from '@shared/types';
import { NON_IMPORTANT_CATEGORIES } from '@main/modules/rules/categorize';

interface EmailRow {
  id: string;
  thread_id: string;
  from_email: string;
  from_name: string | null;
  to_json: string;
  subject: string;
  snippet: string;
  received_at: number;
  is_unread: number;
  labels_json: string;
  importance_score: number;
  priority: NotificationPriority;
  reasons_json: string;
  seen_by_user: number;
  category: EmailCategory;
  open_count: number;
}

function rowToEmail(r: EmailRow): EmailSummary {
  let to: EmailAddress[] = [];
  let labels: string[] = [];
  let reasons: ImportanceReason[] = [];
  try { to = JSON.parse(r.to_json); } catch { to = []; }
  try { labels = JSON.parse(r.labels_json); } catch { labels = []; }
  try { reasons = JSON.parse(r.reasons_json); } catch { reasons = []; }
  return {
    id: r.id,
    threadId: r.thread_id,
    from: { name: r.from_name, email: r.from_email },
    to,
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.received_at,
    isUnread: r.is_unread === 1,
    labels,
    importanceScore: r.importance_score,
    priority: r.priority,
    reasons,
    category: r.category ?? 'personal',
    openCount: r.open_count ?? 0,
    triageDismissed: r.seen_by_user === 1,
  };
}

const NON_IMPORTANT_LIST = Array.from(NON_IMPORTANT_CATEGORIES);
const NON_IMPORTANT_PLACEHOLDERS = NON_IMPORTANT_LIST.map(() => '?').join(',');

export const emailsRepo = {
  upsert(email: EmailSummary): EmailSummary {
    getDb()
      .prepare(
        `INSERT INTO emails
           (id, thread_id, from_email, from_name, to_json, subject, snippet,
            received_at, is_unread, labels_json, importance_score, priority,
            reasons_json, seen_by_user, category, open_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           thread_id = excluded.thread_id,
           from_email = excluded.from_email,
           from_name = excluded.from_name,
           to_json = excluded.to_json,
           subject = excluded.subject,
           snippet = excluded.snippet,
           received_at = excluded.received_at,
           is_unread = excluded.is_unread,
           labels_json = excluded.labels_json,
           importance_score = excluded.importance_score,
           priority = excluded.priority,
           reasons_json = excluded.reasons_json,
           category = excluded.category`,
      )
      .run(
        email.id,
        email.threadId,
        email.from.email,
        email.from.name,
        JSON.stringify(email.to),
        email.subject,
        email.snippet,
        email.receivedAt,
        email.isUnread ? 1 : 0,
        JSON.stringify(email.labels),
        email.importanceScore,
        email.priority,
        JSON.stringify(email.reasons),
        email.category,
        email.openCount,
      );
    return email;
  },

  get(id: string): EmailSummary | null {
    const row = getDb()
      .prepare<[string], EmailRow | undefined>(
        'SELECT * FROM emails WHERE id = ?',
      )
      .get(id);
    return row ? rowToEmail(row) : null;
  },

  recent(limit = 50): EmailSummary[] {
    const rows = getDb()
      .prepare<[number], EmailRow>(
        'SELECT * FROM emails ORDER BY received_at DESC LIMIT ?',
      )
      .all(limit);
    return rows.map(rowToEmail);
  },

  /** Unread inbox mail within the last `withinDays` days (newest first). */
  unreadWithinDays(withinDays: number, limit = 80): EmailSummary[] {
    const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
    const rows = getDb()
      .prepare<[number, number], EmailRow>(
        `SELECT * FROM emails
         WHERE is_unread = 1 AND received_at >= ?
         ORDER BY importance_score DESC, received_at DESC
         LIMIT ?`,
      )
      .all(cutoff, limit);
    return rows.map(rowToEmail);
  },

  countUnreadWithinDays(withinDays: number): number {
    const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
    const row = getDb()
      .prepare<[number], { n: number }>(
        `SELECT COUNT(*) AS n FROM emails
         WHERE is_unread = 1 AND received_at >= ?`,
      )
      .get(cutoff);
    return row?.n ?? 0;
  },

  important(limit = 50): EmailSummary[] {
    const rows = getDb()
      .prepare<[number], EmailRow>(
        `SELECT * FROM emails
         WHERE priority IN ('HIGH', 'MEDIUM')
         ORDER BY priority DESC, received_at DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map(rowToEmail);
  },

  /** Low-signal mail (promotions/social/newsletter/notification) for the dashboard fold. */
  nonImportant(limit = 30): EmailSummary[] {
    if (NON_IMPORTANT_LIST.length === 0) return [];
    const sql = `SELECT * FROM emails
       WHERE category IN (${NON_IMPORTANT_PLACEHOLDERS})
       ORDER BY received_at DESC LIMIT ?`;
    const params = [...NON_IMPORTANT_LIST, limit];
    const rows = getDb().prepare(sql).all(params) as EmailRow[];
    return rows.map(rowToEmail);
  },

  /** CalmMail-only: hide from triage without changing Gmail read state. */
  markTriageDismissed(ids: string[]): number {
    if (ids.length === 0) return 0;
    const stmt = getDb().prepare('UPDATE emails SET seen_by_user = 1 WHERE id = ?');
    let n = 0;
    const tx = getDb().transaction((list: string[]) => {
      for (const id of list) {
        const r = stmt.run(id);
        n += r.changes;
      }
    });
    tx(ids);
    return n;
  },

  /** After Gmail mark-read: align local unread + triage dismiss flags. */
  markTriageReadLocally(ids: string[]): number {
    if (ids.length === 0) return 0;
    const stmt = getDb().prepare(
      'UPDATE emails SET seen_by_user = 1, is_unread = 0 WHERE id = ?',
    );
    let n = 0;
    const tx = getDb().transaction((list: string[]) => {
      for (const id of list) {
        const r = stmt.run(id);
        n += r.changes;
      }
    });
    tx(ids);
    return n;
  },

  /** Increment view counter; used when the user clicks through to Gmail. */
  incrementOpenCount(id: string): number {
    const row = getDb()
      .prepare<[string], { open_count: number } | undefined>(
        'SELECT open_count FROM emails WHERE id = ?',
      )
      .get(id);
    if (!row) return 0;
    const next = (row.open_count ?? 0) + 1;
    getDb()
      .prepare('UPDATE emails SET open_count = ? WHERE id = ?')
      .run(next, id);
    return next;
  },

  /** Aggregate opens per sender within a single low-signal category. */
  senderOpenTotals(category: EmailCategory): Array<{
    senderEmail: string;
    senderName: string | null;
    totalOpens: number;
    messageCount: number;
  }> {
    const rows = getDb()
      .prepare<[EmailCategory], {
        from_email: string;
        from_name: string | null;
        total_opens: number;
        message_count: number;
      }>(
        `SELECT from_email, MAX(from_name) AS from_name,
                SUM(open_count) AS total_opens,
                COUNT(*) AS message_count
         FROM emails
         WHERE category = ? AND open_count > 0
         GROUP BY from_email`,
      )
      .all(category);
    return rows.map((r) => ({
      senderEmail: r.from_email,
      senderName: r.from_name,
      totalOpens: r.total_opens,
      messageCount: r.message_count,
    }));
  },

  countByCategory(): Record<EmailCategory, number> {
    const rows = getDb()
      .prepare<[], { category: EmailCategory; n: number }>(
        'SELECT category, COUNT(*) AS n FROM emails GROUP BY category',
      )
      .all();
    const empty: Record<EmailCategory, number> = {
      personal: 0,
      work: 0,
      transactional: 0,
      notification: 0,
      social: 0,
      newsletter: 0,
      promotion: 0,
      other: 0,
    };
    for (const r of rows) empty[r.category] = r.n;
    return empty;
  },

  /** Prune email metadata older than `olderThanMs`. */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const r = getDb()
      .prepare('DELETE FROM emails WHERE received_at < ?')
      .run(cutoff);
    return r.changes;
  },

  lastReceivedAt(): number | null {
    const row = getDb()
      .prepare<[], { v: number | null }>('SELECT MAX(received_at) AS v FROM emails')
      .get();
    return row?.v ?? null;
  },
};
