import { getDb } from '../db';
import type { MorningBriefing } from '@shared/types';

interface BriefingRow {
  id: string;
  generated_at: number;
  generated_by: string;
  payload: string;
}

export const briefingsRepo = {
  insert(b: MorningBriefing): string {
    const id = `brief_${b.generatedAt}`;
    getDb()
      .prepare(
        `INSERT INTO briefings (id, generated_at, generated_by, payload)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, b.generatedAt, b.generatedBy, JSON.stringify(b));
    return id;
  },

  latest(): MorningBriefing | null {
    const row = getDb()
      .prepare<[], BriefingRow | undefined>(
        'SELECT * FROM briefings ORDER BY generated_at DESC LIMIT 1',
      )
      .get();
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as MorningBriefing;
    } catch {
      return null;
    }
  },

  /**
   * Count briefings produced by a cloud provider (anything other than `local`)
   * within [fromMs, toMs). Used for free-tier daily quota enforcement.
   */
  countCloudBetween(fromMs: number, toMs: number): number {
    const row = getDb()
      .prepare<[number, number], { n: number } | undefined>(
        `SELECT COUNT(*) AS n FROM briefings
         WHERE generated_at >= ? AND generated_at < ?
           AND generated_by <> 'local'`,
      )
      .get(fromMs, toMs);
    return row?.n ?? 0;
  },
};
