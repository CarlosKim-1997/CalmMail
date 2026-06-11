/**
 * Re-classify emails already stored locally (no Gmail refetch).
 *
 * Poller only processes *new* message ids, so categories + sender_profiles
 * stay stale until we run this pass. Triggered on app start (when Gmail is
 * connected) and after OAuth connect.
 */

import { getStoredTokens } from '@main/modules/gmail/auth';
import { getConnectedEmail } from '@main/modules/gmail/client';
import { bootstrapInboxFromGmail } from '@main/modules/gmail/inboxBootstrap';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { ruleEngine } from './engine';
import type { EmailSummary } from '@shared/types';

const DEFAULT_LIMIT = 200;

let inflight: Promise<BackfillReport> | null = null;

export interface BackfillReport {
  ran: boolean;
  reason?: string;
  scanned: number;
  updated: number;
}

export function backfillRecentEmails(opts?: { limit?: number }): Promise<BackfillReport> {
  if (inflight) return inflight;
  inflight = doBackfill(opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doBackfill(opts?: { limit?: number }): Promise<BackfillReport> {
  const tokens = getStoredTokens();
  if (!tokens?.access_token && !tokens?.refresh_token) {
    return { ran: false, reason: 'gmail_not_connected', scanned: 0, updated: 0 };
  }

  const limit = opts?.limit ?? DEFAULT_LIMIT;
  let stored = emailsRepo.recent(limit);
  if (stored.length === 0) {
    const boot = await bootstrapInboxFromGmail();
    if (!boot.ran) {
      return { ran: false, reason: boot.reason, scanned: 0, updated: 0 };
    }
    stored = emailsRepo.recent(limit);
    if (stored.length === 0) {
      return { ran: true, scanned: 0, updated: 0 };
    }
  }

  const prefs = preferencesMemory.get();
  const userPrimary = getConnectedEmail();
  const ctx = { preferences: prefs, userPrimaryEmail: userPrimary };

  let updated = 0;
  for (const email of stored) {
    const next = ruleEngine.reclassifyStored(email, ctx);
    if (emailChanged(email, next)) {
      emailsRepo.upsert(next);
      updated += 1;
    }
  }

  return { ran: true, scanned: stored.length, updated };
}

function emailChanged(before: EmailSummary, after: EmailSummary): boolean {
  if (before.category !== after.category) return true;
  if (before.priority !== after.priority) return true;
  if (before.importanceScore !== after.importanceScore) return true;
  return false;
}
