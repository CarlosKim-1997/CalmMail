/**
 * Category suggestions surfaced to the user.
 *
 * When the user keeps opening promotional / low-signal mail from the same
 * sender, we surface a one-shot question: "promote this sender to important?"
 * Each (sender, fromCategory) pair gets a single open question.
 */

import { getDb } from '../db';
import type { EmailCategory } from '@shared/types';

export type SuggestionResolution = 'promoted_vip' | 'kept' | 'dismissed';

export interface CategorySuggestionRow {
  id: number;
  senderEmail: string;
  senderName: string | null;
  category: EmailCategory;
  openCount: number;
  createdAt: number;
  resolvedAt: number | null;
  resolution: SuggestionResolution | null;
}

interface DbRow {
  id: number;
  sender_email: string;
  category: EmailCategory;
  open_count: number;
  created_at: number;
  resolved_at: number | null;
  resolution: SuggestionResolution | null;
}

function rowToSuggestion(r: DbRow, senderName: string | null = null): CategorySuggestionRow {
  return {
    id: r.id,
    senderEmail: r.sender_email,
    senderName,
    category: r.category,
    openCount: r.open_count,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolution: r.resolution,
  };
}

export const categorySuggestionsRepo = {
  upsertOpen(senderEmail: string, category: EmailCategory, openCount: number): void {
    const db = getDb();
    const existing = db
      .prepare<[string, EmailCategory], DbRow | undefined>(
        'SELECT * FROM category_suggestions WHERE sender_email = ? AND category = ?',
      )
      .get(senderEmail, category);
    if (existing) {
      if (existing.resolved_at != null) return; // user already answered
      db.prepare(
        `UPDATE category_suggestions SET open_count = ? WHERE id = ?`,
      ).run(openCount, existing.id);
      return;
    }
    db.prepare(
      `INSERT INTO category_suggestions
         (sender_email, category, open_count, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(senderEmail, category, openCount, Date.now());
  },

  listOpen(): DbRow[] {
    return getDb()
      .prepare<[], DbRow>(
        'SELECT * FROM category_suggestions WHERE resolved_at IS NULL ORDER BY open_count DESC, created_at ASC',
      )
      .all();
  },

  resolve(id: number, resolution: SuggestionResolution): void {
    getDb()
      .prepare(
        `UPDATE category_suggestions
         SET resolved_at = ?, resolution = ?
         WHERE id = ? AND resolved_at IS NULL`,
      )
      .run(Date.now(), resolution, id);
  },

  rowToSuggestion,
};
