import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { ContactMemory } from '@shared/types';

interface ContactRow {
  email: string;
  display_name: string | null;
  is_vip: number;
  importance: number;
  avg_reply_minutes: number | null;
  last_interaction_at: number | null;
  topic_tags: string;
  notes: string | null;
  updated_at: number;
}

function rowToContact(r: ContactRow): ContactMemory {
  let tags: string[] = [];
  try {
    tags = JSON.parse(r.topic_tags) as string[];
  } catch {
    tags = [];
  }
  return {
    email: r.email,
    displayName: r.display_name,
    isVip: r.is_vip === 1,
    importance: r.importance,
    averageReplyMinutes: r.avg_reply_minutes,
    lastInteractionAt: r.last_interaction_at,
    topicTags: tags,
    notes: r.notes,
  };
}

export const contactsRepo = {
  list(): ContactMemory[] {
    const rows = getDb()
      .prepare<[], ContactRow>(
        'SELECT * FROM contacts ORDER BY is_vip DESC, importance DESC, email ASC',
      )
      .all();
    return rows.map(rowToContact);
  },

  get(email: string): ContactMemory | null {
    const row = getDb()
      .prepare<[string], ContactRow | undefined>(
        'SELECT * FROM contacts WHERE email = ?',
      )
      .get(email);
    return row ? rowToContact(row) : null;
  },

  upsert(input: Partial<ContactMemory> & { email: string }): ContactMemory {
    const db = getDb();
    const existing = this.get(input.email);
    const merged: ContactMemory = {
      email: input.email,
      displayName: input.displayName ?? existing?.displayName ?? null,
      isVip: input.isVip ?? existing?.isVip ?? false,
      importance: clamp(input.importance ?? existing?.importance ?? 0, 0, 100),
      averageReplyMinutes:
        input.averageReplyMinutes ?? existing?.averageReplyMinutes ?? null,
      lastInteractionAt:
        input.lastInteractionAt ?? existing?.lastInteractionAt ?? null,
      topicTags: dedupTags(input.topicTags ?? existing?.topicTags ?? []),
      notes: input.notes ?? existing?.notes ?? null,
    };

    db.prepare(
      `INSERT INTO contacts
         (email, display_name, is_vip, importance, avg_reply_minutes,
          last_interaction_at, topic_tags, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         display_name = excluded.display_name,
         is_vip = excluded.is_vip,
         importance = excluded.importance,
         avg_reply_minutes = excluded.avg_reply_minutes,
         last_interaction_at = excluded.last_interaction_at,
         topic_tags = excluded.topic_tags,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
    ).run(
      merged.email,
      merged.displayName,
      merged.isVip ? 1 : 0,
      merged.importance,
      merged.averageReplyMinutes,
      merged.lastInteractionAt,
      JSON.stringify(merged.topicTags),
      merged.notes,
      Date.now(),
    );

    return merged;
  },

  /**
   * Apply a decay sweep. Used by the memory decay system; the rule engine is
   * the only allowed caller in normal operation.
   */
  applyDecay(decayPerContact: (c: ContactMemory) => Partial<ContactMemory> | null): number {
    const db = getDb();
    const rows = db.prepare<[], ContactRow>('SELECT * FROM contacts').all();
    let changed = 0;
    const txn = db.transaction(() => {
      for (const row of rows) {
        const c = rowToContact(row);
        const patch = decayPerContact(c);
        if (!patch) continue;
        this.upsert({ email: c.email, ...patch });
        changed += 1;
      }
    });
    txn();
    return changed;
  },
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dedupTags(tags: string[]): string[] {
  const set = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t || set.has(t)) continue;
    set.add(t);
    out.push(t);
    if (out.length >= 20) break; // hard cap
  }
  return out;
}
