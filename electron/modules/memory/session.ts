/**
 * Layer 1: Session State.
 *
 * Short-term, fast-changing context. This is the memory layer that lives most
 * recently in the user's mind: today's priority threads, recent alerts,
 * last briefing time.
 */

import { sessionRepo } from '@main/modules/persistence/repositories/sessionRepo';
import type { SessionState } from '@shared/types';

const MAX_PRIORITY_THREADS = 30;
const MAX_RECENT_ALERTS = 50;

export const sessionMemory = {
  get(): SessionState {
    return sessionRepo.get();
  },

  pushPriorityThread(threadId: string): void {
    const s = sessionRepo.get();
    if (s.todayPriorityThreads.includes(threadId)) return;
    const next = [threadId, ...s.todayPriorityThreads].slice(0, MAX_PRIORITY_THREADS);
    sessionRepo.patch({ todayPriorityThreads: next });
  },

  clearPriorityThreads(): void {
    sessionRepo.patch({ todayPriorityThreads: [] });
  },

  recordAlert(notificationId: string): void {
    const s = sessionRepo.get();
    const next = [notificationId, ...s.recentAlertIds].slice(0, MAX_RECENT_ALERTS);
    sessionRepo.patch({ recentAlertIds: next });
  },

  markBriefing(at: number): void {
    sessionRepo.patch({ lastBriefingAt: at });
  },
};
