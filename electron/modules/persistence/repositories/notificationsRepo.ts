import { getDb } from '../db';
import type { AppNotification, NotificationPriority } from '@shared/types';

interface NotificationRow {
  id: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  email_id: string | null;
  created_at: number;
  delivered: number;
  dismissed: number;
}

function rowToNotification(r: NotificationRow): AppNotification {
  return {
    id: r.id,
    priority: r.priority,
    title: r.title,
    body: r.body,
    emailId: r.email_id ?? undefined,
    createdAt: r.created_at,
    delivered: r.delivered === 1,
  };
}

export const notificationsRepo = {
  insert(n: AppNotification): void {
    getDb()
      .prepare(
        `INSERT INTO notifications
           (id, priority, title, body, email_id, created_at, delivered, dismissed)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        n.id,
        n.priority,
        n.title,
        n.body,
        n.emailId ?? null,
        n.createdAt,
        n.delivered ? 1 : 0,
      );
  },

  markDelivered(id: string): void {
    getDb()
      .prepare('UPDATE notifications SET delivered = 1 WHERE id = ?')
      .run(id);
  },

  dismiss(id: string): void {
    getDb()
      .prepare('UPDATE notifications SET dismissed = 1 WHERE id = ?')
      .run(id);
  },

  listActive(limit = 100): AppNotification[] {
    const rows = getDb()
      .prepare<[number], NotificationRow>(
        `SELECT * FROM notifications
         WHERE dismissed = 0
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows.map(rowToNotification);
  },

  recentEmailIds(sinceMs: number): Set<string> {
    const rows = getDb()
      .prepare<[number], { email_id: string | null }>(
        'SELECT email_id FROM notifications WHERE created_at > ?',
      )
      .all(sinceMs);
    return new Set(rows.map((r) => r.email_id).filter((x): x is string => !!x));
  },
};
