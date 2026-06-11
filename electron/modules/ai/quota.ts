/**
 * Cloud-AI briefing quota for free accounts.
 *
 * - Counts only briefings whose `generated_by` is a cloud provider.
 * - Window = local calendar day (midnight to midnight in the host timezone).
 * - BYOK / Premium = unlimited (returns `limit: null`).
 * - Local AI mode = unlimited (the caller — `briefing.ts` — skips the check).
 */

import { briefingsRepo } from '@main/modules/persistence/repositories/briefingsRepo';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { hasPaidFeatures } from '@main/modules/monetization/snapshot';
import { FREE_TIER_LIMITS } from '@shared/monetization';
import type { AiQuotaStatus } from '@shared/types';

/** Local-midnight boundaries straddling `now`. */
export function dayBounds(now = new Date()): { startMs: number; nextStartMs: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return { startMs: start.getTime(), nextStartMs: next.getTime() };
}

export function getQuotaStatus(): AiQuotaStatus {
  const prefs = preferencesMemory.get();
  const { startMs, nextStartMs } = dayBounds();
  const used = briefingsRepo.countCloudBetween(startMs, nextStartMs);

  // BYOK / Premium or off → no limit applied.
  if (hasPaidFeatures(prefs) || prefs.aiMode === 'off') {
    return { used, limit: null, resetAt: nextStartMs, mode: prefs.aiMode };
  }

  // Local AI runs on-device → free of cloud cost; no limit either.
  if (prefs.aiMode === 'local') {
    return { used, limit: null, resetAt: nextStartMs, mode: 'local' };
  }

  return {
    used,
    limit: FREE_TIER_LIMITS.maxCloudBriefingsPerDay,
    resetAt: nextStartMs,
    mode: 'cloud',
  };
}

/** Returns true when a cloud run is currently blocked by the free-tier cap. */
export function isCloudQuotaExceeded(): { exceeded: boolean; resetAt: number; limit: number } {
  const prefs = preferencesMemory.get();
  if (hasPaidFeatures(prefs)) {
    const { nextStartMs } = dayBounds();
    return { exceeded: false, resetAt: nextStartMs, limit: Number.POSITIVE_INFINITY };
  }
  const { startMs, nextStartMs } = dayBounds();
  const used = briefingsRepo.countCloudBetween(startMs, nextStartMs);
  const limit = FREE_TIER_LIMITS.maxCloudBriefingsPerDay;
  return { exceeded: used >= limit, resetAt: nextStartMs, limit };
}
