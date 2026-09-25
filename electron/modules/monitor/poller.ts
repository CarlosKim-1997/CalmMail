/**
 * The poller is the heartbeat of the background mode.
 *
 * It is intentionally lightweight: it never invokes the AI. It only:
 *   1. Lists recent message IDs from Gmail
 *   2. Drops IDs we have already classified
 *   3. Fetches metadata for the new ones
 *   4. Runs the rule engine to classify them
 *   5. Stores them and asks the notification layer to decide on alerts
 *
 * Cost characteristic: O(new messages) Gmail metadata calls. No AI tokens.
 */

import { getActiveMailProvider } from '@main/modules/mail';
import { onGmailApiAuthFailure } from '@main/modules/gmail/session';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { sessionMemory } from '@main/modules/memory/session';
import { ruleEngine } from '@main/modules/rules/engine';
import { notificationManager } from '@main/modules/notification/manager';
import { refreshStoredUnreadFlags } from '@main/modules/gmail/readStateSync';
import { ingestFetchedMessages } from './ingest';
import { runSentPoll, type SentPollReport } from './sentPoller';
import type { EmailSummary } from '@shared/types';

export interface PollReport {
  ran: boolean;
  reason?: string;
  fetched: number;
  classified: number;
  newHighPriority: number;
  newMediumPriority: number;
  sent?: SentPollReport;
}

let inflight: Promise<PollReport> | null = null;

export function runPoll(): Promise<PollReport> {
  if (inflight) return inflight;
  inflight = doPoll().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doPoll(): Promise<PollReport> {
  const provider = getActiveMailProvider();
  if (!provider.isConnected()) {
    return zeroReport({ ran: false, reason: 'mail_not_connected' });
  }

  const prefs = preferencesMemory.get();
  const userPrimary = provider.getConnectedEmail();

  let recent: Array<{ id: string; threadId: string }>;
  try {
    recent = await provider.listInboxMessageRefs({
      maxResults: 50,
      query: 'in:inbox newer_than:30d',
    });
  } catch (err) {
    if (onGmailApiAuthFailure(err)) {
      console.warn('[gmail] session expired — use in-app reconnect');
      return zeroReport({ ran: false, reason: 'gmail_auth_expired' });
    }
    return zeroReport({ ran: false, reason: `gmail_list_failed:${(err as Error).message}` });
  }

  if (recent.length === 0) {
    return zeroReport({ ran: true });
  }

  // Skip messages we already have stored.
  const existingIds = existingIdSet(recent.map((r) => r.id));
  const newIds = recent.filter((r) => !existingIds.has(r.id)).map((r) => r.id);
  if (newIds.length === 0) {
    try {
      await refreshStoredUnreadFlags();
    } catch {
      /* best-effort — Gmail may be offline */
    }
    let sent: SentPollReport | undefined;
    try {
      sent = await runSentPoll();
    } catch {
      sent = { ran: false, scanned: 0, processed: 0, awaitedTracked: 0 };
    }
    return zeroReport({ ran: true, sent });
  }

  let metas;
  try {
    metas = await provider.fetchMessagesMetadata(newIds);
  } catch (err) {
    if (onGmailApiAuthFailure(err)) {
      console.warn('[gmail] session expired — use in-app reconnect');
      return zeroReport({ ran: false, reason: 'gmail_auth_expired' });
    }
    throw err;
  }

  const { classified, newHighPriority, newMediumPriority } = await ingestFetchedMessages(
    metas,
    provider,
    { preferences: prefs, userPrimaryEmail: userPrimary },
  );
  const highCount = newHighPriority;
  const mediumCount = newMediumPriority;

  try {
    await refreshStoredUnreadFlags();
  } catch {
    /* best-effort */
  }

  let sent: SentPollReport | undefined;
  try {
    sent = await runSentPoll();
  } catch {
    sent = { ran: false, scanned: 0, processed: 0, awaitedTracked: 0 };
  }

  return {
    ran: true,
    fetched: metas.length,
    classified: classified.length,
    newHighPriority: highCount,
    newMediumPriority: mediumCount,
    sent,
  };
}

function existingIdSet(ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  // Cheap path: just compare with the most recent stored emails.
  const recent = emailsRepo.recent(200);
  const have = new Set<string>(recent.map((e) => e.id));
  return have;
}

function zeroReport(p: Partial<PollReport>): PollReport {
  return {
    ran: false,
    fetched: 0,
    classified: 0,
    newHighPriority: 0,
    newMediumPriority: 0,
    ...p,
  };
}
