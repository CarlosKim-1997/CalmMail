import { getDb } from '../db';

/** Gmail sent-message ids we already ran through outgoing rules. */
export const processedSentRepo = {
  has(messageId: string): boolean {
    const row = getDb()
      .prepare<[string], { message_id: string } | undefined>(
        'SELECT message_id FROM processed_sent_messages WHERE message_id = ?',
      )
      .get(messageId);
    return !!row;
  },

  mark(messageId: string): void {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO processed_sent_messages (message_id, processed_at)
         VALUES (?, ?)`,
      )
      .run(messageId, Date.now());
  },

  /** Drop ids older than retention to keep the table small. */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const r = getDb()
      .prepare('DELETE FROM processed_sent_messages WHERE processed_at < ?')
      .run(cutoff);
    return r.changes;
  },
};
