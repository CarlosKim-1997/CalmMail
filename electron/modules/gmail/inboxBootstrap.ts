/**
 * Fills the local email cache from Gmail when the DB is empty or too sparse
 * for a meaningful briefing. The poller only ingests *new* ids (≤25 / tick);
 * without this pass, a fresh install can run briefings on 0 messages forever.
 */

import { getStoredTokens } from './auth';
import {
  fetchMessagesMetadata,
  getConnectedEmail,
  listRecentMessageIds,
} from './client';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { ruleEngine } from '@main/modules/rules/engine';
import { runPoll } from '@main/modules/monitor/poller';
import {
  clearInboxSyncPhase,
  recordPollResult,
  setInboxSyncing,
} from '@main/modules/monitor/inboxSync';
import type { EmailSummary } from '@shared/types';

/** Matches `generateMorningBriefing` scan window. */
export const BRIEFING_INBOX_SYNC_LIMIT = 200;

/** Tried in order until at least one message is stored. */
const BOOTSTRAP_QUERIES = [
  'in:inbox newer_than:30d',
  'in:inbox newer_than:365d',
  'in:inbox',
  'newer_than:30d',
] as const;

/** Re-fetch when fewer than this many rows are cached. */
const MIN_CACHED_FOR_BRIEFING = 1;

export interface InboxBootstrapReport {
  ran: boolean;
  reason?: string;
  listed: number;
  fetched: number;
  inserted: number;
  queryUsed?: string;
}

function existingIdSet(ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const recent = emailsRepo.recent(BRIEFING_INBOX_SYNC_LIMIT);
  return new Set(recent.map((e) => e.id));
}

async function bootstrapWithQuery(
  query: string,
): Promise<InboxBootstrapReport & { queryUsed: string }> {
  const prefs = preferencesMemory.get();
  const userPrimary = getConnectedEmail();

  let listed: Array<{ id: string; threadId: string }>;
  try {
    listed = await listRecentMessageIds({
      maxResults: BRIEFING_INBOX_SYNC_LIMIT,
      query,
    });
  } catch (err) {
    return {
      ran: false,
      reason: `gmail_list_failed:${(err as Error).message}`,
      listed: 0,
      fetched: 0,
      inserted: 0,
      queryUsed: query,
    };
  }

  if (listed.length === 0) {
    return { ran: true, listed: 0, fetched: 0, inserted: 0, queryUsed: query };
  }

  const have = existingIdSet(listed.map((r) => r.id));
  const newIds = listed.filter((r) => !have.has(r.id)).map((r) => r.id);
  if (newIds.length === 0) {
    return {
      ran: true,
      listed: listed.length,
      fetched: 0,
      inserted: 0,
      queryUsed: query,
    };
  }

  const metas = await fetchMessagesMetadata(newIds);
  const classified: EmailSummary[] = [];
  for (const m of metas) {
    const out = ruleEngine.classifyIncoming(m.summary, {
      preferences: prefs,
      userPrimaryEmail: userPrimary,
      headerSignals: m.headerSignals,
    });
    emailsRepo.upsert(out);
    classified.push(out);
  }

  if (classified.length === 0 && newIds.length > 0) {
    console.warn(
      `[inbox] bootstrap listed ${newIds.length} ids but fetched 0 (query=${query})`,
    );
  }

  return {
    ran: true,
    listed: listed.length,
    fetched: metas.length,
    inserted: classified.length,
    queryUsed: query,
  };
}

/**
 * Lists inbox messages with fallback queries and stores metadata locally.
 */
export async function bootstrapInboxFromGmail(): Promise<InboxBootstrapReport> {
  if (!getStoredTokens()) {
    return { ran: false, reason: 'gmail_not_connected', listed: 0, fetched: 0, inserted: 0 };
  }

  let last: InboxBootstrapReport = { ran: true, listed: 0, fetched: 0, inserted: 0 };
  for (const query of BOOTSTRAP_QUERIES) {
    const attempt = await bootstrapWithQuery(query);
    last = attempt;
    if (!attempt.ran) return attempt;
    if (emailsRepo.recent(1).length > 0) return attempt;
    if (attempt.listed > 0 && attempt.inserted > 0) return attempt;
  }
  return last;
}

/**
 * Called at the start of briefing generation so `emailsRepo.recent()` is not
 * empty when Gmail is connected.
 */
export async function ensureInboxCachedForBriefing(): Promise<
  InboxBootstrapReport & { stored: number }
> {
  const storedBefore = emailsRepo.recent(BRIEFING_INBOX_SYNC_LIMIT).length;
  if (storedBefore >= MIN_CACHED_FOR_BRIEFING) {
    return { ran: true, listed: 0, fetched: 0, inserted: 0, stored: storedBefore };
  }

  setInboxSyncing();
  try {
    try {
      const poll = await runPoll();
      recordPollResult(poll);
    } catch (err) {
      console.warn('[inbox] poll before briefing failed', err);
    }

    let stored = emailsRepo.recent(BRIEFING_INBOX_SYNC_LIMIT).length;
    if (stored >= MIN_CACHED_FOR_BRIEFING) {
      return { ran: true, listed: 0, fetched: 0, inserted: 0, stored };
    }

    const boot = await bootstrapInboxFromGmail();
    stored = emailsRepo.recent(BRIEFING_INBOX_SYNC_LIMIT).length;
    return { ...boot, stored };
  } finally {
    clearInboxSyncPhase();
  }
}

/** Wire-format suffix for {@link BriefingNoMailError}. */
export function noMailErrorDetail(sync: InboxBootstrapReport): string {
  if (sync.reason?.startsWith('gmail_list_failed')) return 'gmail_api';
  if (sync.listed > 0 && sync.inserted === 0) return 'fetch_failed';
  if (sync.listed === 0) return 'gmail_empty';
  return 'cache_empty';
}
