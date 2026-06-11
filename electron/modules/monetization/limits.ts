import { FREE_TIER_LIMITS } from '@shared/monetization';
import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { hasPaidFeatures } from './snapshot';

/** New "waiting" awaited row (not an update to an existing waiting row). */
export function assertCanAddAwaitedWaitingRow(threadId: string): void {
  const prefs = preferencesMemory.get();
  if (hasPaidFeatures(prefs)) return;
  const existing = awaitedRepo.get(threadId);
  if (existing && existing.status !== 'dropped') return;
  const waiting = awaitedRepo.list({ status: 'waiting' }).length;
  if (waiting >= FREE_TIER_LIMITS.maxAwaitedWaitingThreads) {
    throw new Error('awaited_limit');
  }
}

export function mayAutoTrackAwaited(threadId: string): boolean {
  try {
    assertCanAddAwaitedWaitingRow(threadId);
    return true;
  } catch {
    return false;
  }
}
