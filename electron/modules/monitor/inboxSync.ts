/**
 * Tracks inbox sync progress for the renderer (home hero, first-run UX).
 */

import type { InboxSyncSnapshot, MonitorPollReport } from '@shared/types';
import { bootstrapInboxFromGmail, BRIEFING_INBOX_SYNC_LIMIT } from '@main/modules/gmail/inboxBootstrap';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { runPoll, type PollReport } from './poller';

let phase: InboxSyncSnapshot['phase'] = 'idle';
let lastSyncAt: number | null = null;
let lastNewClassified = 0;
let lastReason: string | undefined;

export function getInboxSyncSnapshot(): InboxSyncSnapshot {
  return {
    phase,
    lastSyncAt,
    cachedMessageCount: emailsRepo.recent(BRIEFING_INBOX_SYNC_LIMIT).length,
    lastNewClassified,
    lastReason,
  };
}

export function setInboxSyncing(): void {
  phase = 'syncing';
}

function finishIdle(): void {
  phase = 'idle';
}

/** Clears `syncing` when a code path set it but did not record a poll result. */
export function clearInboxSyncPhase(): void {
  finishIdle();
}

export function recordPollResult(report: PollReport): void {
  if (report.ran) {
    lastSyncAt = Date.now();
    lastNewClassified = report.classified;
    lastReason = report.reason;
  }
  finishIdle();
}

export function recordBootstrapInserted(inserted: number, reason?: string): void {
  if (inserted > 0) {
    lastSyncAt = Date.now();
    lastNewClassified = inserted;
  }
  if (reason) lastReason = reason;
  finishIdle();
}

/** Manual sync from UI + shared path for empty cache. */
export async function runInboxSyncForUi(): Promise<InboxSyncSnapshot> {
  setInboxSyncing();
  try {
    const poll = await runPoll();
    lastNewClassified = poll.classified;
    if (poll.ran) {
      lastSyncAt = Date.now();
      lastReason = poll.reason;
    }

    if (emailsRepo.recent(BRIEFING_INBOX_SYNC_LIMIT).length < 1) {
      const boot = await bootstrapInboxFromGmail();
      if (boot.inserted > 0) {
        lastSyncAt = Date.now();
        lastNewClassified = boot.inserted;
      }
      if (boot.reason) lastReason = boot.reason;
    }

    return getInboxSyncSnapshot();
  } finally {
    finishIdle();
  }
}

export function toMonitorPollReport(report: PollReport): MonitorPollReport {
  return {
    ran: report.ran,
    reason: report.reason,
    fetched: report.fetched,
    classified: report.classified,
    newHighPriority: report.newHighPriority,
    newMediumPriority: report.newMediumPriority,
  };
}
