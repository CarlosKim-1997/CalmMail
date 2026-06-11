import { getDb } from '../db';
import type { CategorySuggestionResolution } from '@shared/types';

export type VipSuggestionResolution = CategorySuggestionResolution;

interface DbRow {
  id: number;
  contact_email: string;
  awaited_count: number;
  created_at: number;
  resolved_at: number | null;
  resolution: VipSuggestionResolution | null;
}

export const vipSuggestionsRepo = {
  upsertOpen(contactEmail: string, awaitedCount: number): void {
    const email = contactEmail.toLowerCase();
    const db = getDb();
    const existing = db
      .prepare<[string], DbRow | undefined>(
        'SELECT * FROM vip_suggestions WHERE contact_email = ?',
      )
      .get(email);
    if (existing) {
      if (existing.resolved_at != null) return;
      db.prepare(
        `UPDATE vip_suggestions SET awaited_count = ? WHERE id = ?`,
      ).run(awaitedCount, existing.id);
      return;
    }
    db.prepare(
      `INSERT INTO vip_suggestions (contact_email, awaited_count, created_at)
       VALUES (?, ?, ?)`,
    ).run(email, awaitedCount, Date.now());
  },

  listOpen(): DbRow[] {
    return getDb()
      .prepare<[], DbRow>(
        `SELECT * FROM vip_suggestions
         WHERE resolved_at IS NULL
         ORDER BY awaited_count DESC, created_at ASC`,
      )
      .all();
  },

  resolve(id: number, resolution: VipSuggestionResolution): void {
    getDb()
      .prepare(
        `UPDATE vip_suggestions
         SET resolved_at = ?, resolution = ?
         WHERE id = ? AND resolved_at IS NULL`,
      )
      .run(Date.now(), resolution, id);
  },
};
