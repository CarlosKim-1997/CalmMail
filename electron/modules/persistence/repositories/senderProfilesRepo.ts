/**
 * Sender profile cache.
 *
 * Two roles:
 *   1. Persistence layer for `SenderProfile` rows (one per from-address).
 *   2. A handful of "shape" queries the briefing reuses (top senders by
 *      activity, domain rollups, etc.) so we don't recompute them every run.
 *
 * The classifier (sibling module `senderClassifier`) is the only place that
 * decides *what* the kind should be. This repo only persists.
 */

import { getDb } from '../db';
import type { SenderKind, SenderProfile } from '@shared/types';

interface SenderProfileRow {
  email: string;
  domain: string;
  display_name: string | null;
  kind: SenderKind;
  affiliation: string | null;
  message_count: number;
  bulk_signal_count: number;
  human_signal_count: number;
  confidence: number;
  first_seen_at: number;
  last_seen_at: number;
  pinned: number;
  notes: string | null;
  updated_at: number;
}

function rowToProfile(r: SenderProfileRow): SenderProfile {
  return {
    email: r.email,
    domain: r.domain,
    displayName: r.display_name,
    kind: r.kind,
    affiliation: r.affiliation,
    messageCount: r.message_count,
    bulkSignalCount: r.bulk_signal_count,
    humanSignalCount: r.human_signal_count,
    confidence: r.confidence,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    pinned: r.pinned === 1,
    notes: r.notes,
  };
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampCount(n: number): number {
  // Hard ceiling so a single noisy sender can't dominate the histogram.
  return Math.max(0, Math.min(10000, Math.round(n)));
}

export const senderProfilesRepo = {
  get(email: string): SenderProfile | null {
    const row = getDb()
      .prepare<[string], SenderProfileRow | undefined>(
        'SELECT * FROM sender_profiles WHERE email = ?',
      )
      .get(email.toLowerCase());
    return row ? rowToProfile(row) : null;
  },

  getMany(emails: string[]): Map<string, SenderProfile> {
    const out = new Map<string, SenderProfile>();
    if (emails.length === 0) return out;
    const placeholders = emails.map(() => '?').join(',');
    const rows = getDb()
      .prepare(
        `SELECT * FROM sender_profiles WHERE email IN (${placeholders})`,
      )
      .all(...emails.map((e) => e.toLowerCase())) as SenderProfileRow[];
    for (const row of rows) out.set(row.email, rowToProfile(row));
    return out;
  },

  /**
   * Insert-or-merge. The classifier owns the policy of *what* `kind` should be
   * — we only write what it gives us. Counts are added cumulatively so the
   * caller may pass per-message deltas (typically 1 / 0).
   *
   * The `pinned` row is never overwritten by an automatic call; pass
   * `{ allowOverwritePinned: true }` only when the user explicitly edits.
   */
  observe(
    input: {
      email: string;
      domain: string;
      displayName: string | null;
      kind: SenderKind;
      affiliation?: string | null;
      bulkSignalDelta: number;
      humanSignalDelta: number;
      confidence: number;
      seenAt: number;
    },
    opts: { allowOverwritePinned?: boolean } = {},
  ): SenderProfile {
    const db = getDb();
    const email = input.email.toLowerCase();
    const existing = this.get(email);

    if (existing?.pinned && !opts.allowOverwritePinned) {
      // Bump bookkeeping fields only.
      const updated: SenderProfile = {
        ...existing,
        messageCount: clampCount(existing.messageCount + 1),
        bulkSignalCount: clampCount(
          existing.bulkSignalCount + (input.bulkSignalDelta ?? 0),
        ),
        humanSignalCount: clampCount(
          existing.humanSignalCount + (input.humanSignalDelta ?? 0),
        ),
        lastSeenAt: Math.max(existing.lastSeenAt, input.seenAt),
        displayName: input.displayName ?? existing.displayName,
      };
      this.persist(updated);
      return updated;
    }

    if (!existing) {
      const fresh: SenderProfile = {
        email,
        domain: input.domain.toLowerCase(),
        displayName: input.displayName ?? null,
        kind: input.kind,
        affiliation: input.affiliation ?? null,
        messageCount: 1,
        bulkSignalCount: clampCount(input.bulkSignalDelta),
        humanSignalCount: clampCount(input.humanSignalDelta),
        confidence: clampScore(input.confidence),
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
        pinned: false,
        notes: null,
      };
      this.persist(fresh);
      return fresh;
    }

    // Merge with hysteresis: switching kind requires the new classification
    // to be at least 12 confidence points higher than the existing one, or
    // the signal counts to clearly favor the new bucket. This avoids
    // ping-ponging on early noisy data.
    const switching = existing.kind !== input.kind;
    let nextKind = existing.kind;
    let nextAffiliation = existing.affiliation;
    let nextConfidence = existing.confidence;

    if (switching) {
      const margin = input.confidence - existing.confidence;
      if (margin >= 12) {
        nextKind = input.kind;
        nextAffiliation = input.affiliation ?? existing.affiliation;
        nextConfidence = clampScore(input.confidence);
      } else {
        // Same kind sticks; small confidence drift toward the new reading.
        nextConfidence = clampScore(
          existing.confidence + Math.sign(margin) * 2,
        );
      }
    } else {
      // Same bucket as before: nudge confidence up.
      nextConfidence = clampScore(
        Math.max(existing.confidence, input.confidence) + 1,
      );
      if (input.affiliation && !existing.affiliation) {
        nextAffiliation = input.affiliation;
      }
    }

    const merged: SenderProfile = {
      ...existing,
      domain: existing.domain || input.domain.toLowerCase(),
      displayName: existing.displayName ?? input.displayName ?? null,
      kind: nextKind,
      affiliation: nextAffiliation,
      messageCount: clampCount(existing.messageCount + 1),
      bulkSignalCount: clampCount(
        existing.bulkSignalCount + (input.bulkSignalDelta ?? 0),
      ),
      humanSignalCount: clampCount(
        existing.humanSignalCount + (input.humanSignalDelta ?? 0),
      ),
      confidence: nextConfidence,
      lastSeenAt: Math.max(existing.lastSeenAt, input.seenAt),
    };
    this.persist(merged);
    return merged;
  },

  /** User explicitly fixes (or unfixes) the profile kind. */
  userEdit(
    email: string,
    patch: { kind?: SenderKind; affiliation?: string | null; notes?: string | null; pinned?: boolean },
  ): SenderProfile {
    const existing = this.get(email);
    const merged: SenderProfile = {
      email: email.toLowerCase(),
      domain:
        existing?.domain ?? email.toLowerCase().split('@')[1] ?? 'unknown',
      displayName: existing?.displayName ?? null,
      kind: patch.kind ?? existing?.kind ?? 'unknown',
      affiliation: patch.affiliation ?? existing?.affiliation ?? null,
      messageCount: existing?.messageCount ?? 0,
      bulkSignalCount: existing?.bulkSignalCount ?? 0,
      humanSignalCount: existing?.humanSignalCount ?? 0,
      // When the user pins something we trust them — high confidence so the
      // hysteresis in observe() can't override it without similarly strong
      // automatic evidence.
      confidence: patch.kind ? 95 : existing?.confidence ?? 0,
      firstSeenAt: existing?.firstSeenAt ?? Date.now(),
      lastSeenAt: existing?.lastSeenAt ?? Date.now(),
      pinned: patch.pinned ?? existing?.pinned ?? true,
      notes: patch.notes ?? existing?.notes ?? null,
    };
    this.persist(merged);
    return merged;
  },

  list(opts: { kind?: SenderKind; limit?: number } = {}): SenderProfile[] {
    const limit = opts.limit ?? 200;
    if (opts.kind) {
      const rows = getDb()
        .prepare<[SenderKind, number], SenderProfileRow>(
          `SELECT * FROM sender_profiles WHERE kind = ?
           ORDER BY last_seen_at DESC, message_count DESC LIMIT ?`,
        )
        .all(opts.kind, limit);
      return rows.map(rowToProfile);
    }
    const rows = getDb()
      .prepare<[number], SenderProfileRow>(
        `SELECT * FROM sender_profiles
         ORDER BY last_seen_at DESC, message_count DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map(rowToProfile);
  },

  /** How many distinct senders we have ever seen. */
  count(): number {
    const row = getDb()
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM sender_profiles')
      .get();
    return row?.n ?? 0;
  },

  persist(p: SenderProfile): void {
    getDb()
      .prepare(
        `INSERT INTO sender_profiles
           (email, domain, display_name, kind, affiliation, message_count,
            bulk_signal_count, human_signal_count, confidence,
            first_seen_at, last_seen_at, pinned, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           domain = excluded.domain,
           display_name = excluded.display_name,
           kind = excluded.kind,
           affiliation = excluded.affiliation,
           message_count = excluded.message_count,
           bulk_signal_count = excluded.bulk_signal_count,
           human_signal_count = excluded.human_signal_count,
           confidence = excluded.confidence,
           first_seen_at = MIN(excluded.first_seen_at, sender_profiles.first_seen_at),
           last_seen_at = MAX(excluded.last_seen_at, sender_profiles.last_seen_at),
           pinned = excluded.pinned,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
      )
      .run(
        p.email,
        p.domain,
        p.displayName,
        p.kind,
        p.affiliation,
        p.messageCount,
        p.bulkSignalCount,
        p.humanSignalCount,
        p.confidence,
        p.firstSeenAt,
        p.lastSeenAt,
        p.pinned ? 1 : 0,
        p.notes,
        Date.now(),
      );
  },
};
