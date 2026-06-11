import { getDb } from '../db';
import type { AwaitedReply } from '@shared/types';

interface AwaitedRow {
  thread_id: string;
  contact: string;
  subject: string;
  sent_at: number;
  expected_by_minutes: number | null;
  status: AwaitedReply['status'];
  reason: AwaitedReply['reason'];
  updated_at: number;
}

function rowToAwaited(r: AwaitedRow): AwaitedReply {
  return {
    threadId: r.thread_id,
    contact: r.contact,
    subject: r.subject,
    sentAt: r.sent_at,
    expectedByMinutes: r.expected_by_minutes,
    status: r.status,
    reason: r.reason,
  };
}

export const awaitedRepo = {
  list(filter?: { status?: AwaitedReply['status'] }): AwaitedReply[] {
    const db = getDb();
    const rows = filter?.status
      ? db
          .prepare<[string], AwaitedRow>(
            'SELECT * FROM awaited_replies WHERE status = ? ORDER BY sent_at DESC',
          )
          .all(filter.status)
      : db
          .prepare<[], AwaitedRow>(
            'SELECT * FROM awaited_replies ORDER BY sent_at DESC',
          )
          .all();
    return rows.map(rowToAwaited);
  },

  get(threadId: string): AwaitedReply | null {
    const row = getDb()
      .prepare<[string], AwaitedRow | undefined>(
        'SELECT * FROM awaited_replies WHERE thread_id = ?',
      )
      .get(threadId);
    return row ? rowToAwaited(row) : null;
  },

  upsert(item: AwaitedReply): AwaitedReply {
    getDb()
      .prepare(
        `INSERT INTO awaited_replies
           (thread_id, contact, subject, sent_at, expected_by_minutes,
            status, reason, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           contact = excluded.contact,
           subject = excluded.subject,
           sent_at = excluded.sent_at,
           expected_by_minutes = excluded.expected_by_minutes,
           status = excluded.status,
           reason = excluded.reason,
           updated_at = excluded.updated_at`,
      )
      .run(
        item.threadId,
        item.contact,
        item.subject,
        item.sentAt,
        item.expectedByMinutes,
        item.status,
        item.reason,
        Date.now(),
      );
    return item;
  },

  setStatus(threadId: string, status: AwaitedReply['status']): void {
    getDb()
      .prepare(
        'UPDATE awaited_replies SET status = ?, updated_at = ? WHERE thread_id = ?',
      )
      .run(status, Date.now(), threadId);
  },

  /**
   * How many auto-inferred "waiting for reply" rows we created for this
   * contact since `sinceMs` (used for VIP candidate suggestions).
   */
  countAutoInferredForContact(contactEmail: string, sinceMs: number): number {
    const row = getDb()
      .prepare<[string, number], { n: number } | undefined>(
        `SELECT COUNT(*) AS n FROM awaited_replies
         WHERE contact = ? AND reason = 'auto_inferred' AND sent_at >= ?`,
      )
      .get(contactEmail.toLowerCase(), sinceMs);
    return row?.n ?? 0;
  },

  /** Drop stale waiting entries older than N days. */
  dropStale(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const r = getDb()
      .prepare(
        `UPDATE awaited_replies SET status = 'dropped', updated_at = ?
         WHERE status = 'waiting' AND sent_at < ?`,
      )
      .run(Date.now(), cutoff);
    return r.changes;
  },
};
