/**
 * Polls the user's Gmail *sent* folder to infer "awaiting reply" threads.
 * No AI, no body persistence — metadata + snippet only for question heuristics.
 */

import { getStoredTokens } from '@main/modules/gmail/auth';
import {
  getConnectedEmail,
  listRecentSentMessageIds,
  peekOutgoingMessage,
} from '@main/modules/gmail/client';
import { processedSentRepo } from '@main/modules/persistence/repositories/processedSentRepo';
import { ruleEngine } from '@main/modules/rules/engine';
import { looksLikeQuestion } from '@main/modules/rules/awaitedReply';

const SENT_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;

export interface SentPollReport {
  ran: boolean;
  reason?: string;
  scanned: number;
  processed: number;
  awaitedTracked: number;
}

let inflight: Promise<SentPollReport> | null = null;

export function runSentPoll(): Promise<SentPollReport> {
  if (inflight) return inflight;
  inflight = doSentPoll().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doSentPoll(): Promise<SentPollReport> {
  if (!getStoredTokens()) {
    return empty({ ran: false, reason: 'gmail_not_connected' });
  }

  const userEmail = getConnectedEmail();
  let ids: Array<{ id: string; threadId: string }>;
  try {
    ids = await listRecentSentMessageIds({ maxResults: 20 });
  } catch (err) {
    return empty({ ran: false, reason: `gmail_sent_list_failed:${(err as Error).message}` });
  }

  const pending = ids.filter((m) => !processedSentRepo.has(m.id));
  let processed = 0;
  let awaitedTracked = 0;

  for (const { id } of pending) {
    try {
      const peek = await peekOutgoingMessage(id, userEmail);
      processedSentRepo.mark(id);
      processed += 1;

      if (!peek || !peek.isSentByUser) continue;

      const haystack = `${peek.subject}\n${peek.snippet}`;
      if (!looksLikeQuestion(haystack)) continue;

      const tracked = ruleEngine.classifyOutgoing({
        threadId: peek.threadId,
        toEmail: peek.toEmail,
        subject: peek.subject,
        sentAt: peek.sentAt,
        containsQuestion: true,
      });
      if (tracked) awaitedTracked += 1;
    } catch {
      processedSentRepo.mark(id);
      processed += 1;
    }
  }

  try {
    processedSentRepo.prune(SENT_RETENTION_MS);
  } catch {
    /* best-effort */
  }

  return {
    ran: true,
    scanned: ids.length,
    processed,
    awaitedTracked,
  };
}

function empty(p: Partial<SentPollReport>): SentPollReport {
  return {
    ran: false,
    scanned: 0,
    processed: 0,
    awaitedTracked: 0,
    ...p,
  };
}
