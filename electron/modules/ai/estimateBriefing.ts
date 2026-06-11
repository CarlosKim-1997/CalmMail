/**
 * Heuristic briefing duration estimate (ms).
 *
 * Not a promise — used so the UI can show a calm progress bar and soft
 * deadline extensions. Inputs mirror what `generateMorningBriefing` actually
 * processes: cached hardware verdict, AI mode, and how many messages were
 * scanned in the local DB (Gmail metadata already synced).
 */

import type {
  AiMode,
  BriefingDurationEstimate,
  HardwareCapability,
} from '@shared/types';
import { getCachedHardwareCapability } from '@main/modules/localAi/capabilityCheck';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { getActiveProvider } from './registry';
import { hasPaidFeatures } from '@main/modules/monetization/snapshot';
import { BRIEFING_IMPORTANT_EMAIL_CAP } from '@shared/monetization';
import {
  LOCAL_TRIAGE_USER_MAX,
  TRIAGE_UNREAD_AI_CAP,
  resolveTriageWindowDays,
} from '@shared/triage';

const SCAN_WINDOW_LIMIT = 200;

export interface BriefingWorkloadSnapshot {
  totalScanned: number;
  importantPoolSize: number;
  awaitedWaiting: number;
}

export function snapshotBriefingWorkload(): BriefingWorkloadSnapshot {
  const prefs = preferencesMemory.get();
  const cap = hasPaidFeatures(prefs)
    ? BRIEFING_IMPORTANT_EMAIL_CAP.premium
    : BRIEFING_IMPORTANT_EMAIL_CAP.free;
  const totalScanned = emailsRepo.recent(SCAN_WINDOW_LIMIT).length;
  const importantPoolSize = emailsRepo.important(cap).length;
  return {
    totalScanned,
    importantPoolSize,
    awaitedWaiting: 0, // filled by caller if needed; not heavy for timing
  };
}

export function estimateBriefingDuration(
  workload: BriefingWorkloadSnapshot,
  opts?: {
    aiMode?: AiMode;
    isCloud?: boolean;
    hardware?: HardwareCapability | null;
  },
): BriefingDurationEstimate {
  const prefs = preferencesMemory.get();
  const aiMode = opts?.aiMode ?? prefs.aiMode;
  const provider = getActiveProvider();
  const isCloud = opts?.isCloud ?? (aiMode === 'cloud' && provider.isCloud);
  const cached = opts?.hardware ?? getCachedHardwareCapability()?.capability ?? null;
  const hwVerdict = cached?.verdict ?? null;

  const { totalScanned, importantPoolSize } = workload;
  const scanned = Math.min(totalScanned, SCAN_WINDOW_LIMIT);
  const important = importantPoolSize;

  const triageDays =
    aiMode === 'local' ? 7 : resolveTriageWindowDays(prefs.triageWindowDays);
  const unreadInScope = emailsRepo.countUnreadWithinDays(triageDays);
  const triageCap = isCloud ? TRIAGE_UNREAD_AI_CAP : LOCAL_TRIAGE_USER_MAX;
  const aiTriageCount = Math.min(unreadInScope, triageCap);
  const ambiguousTriageCount = isCloud
    ? estimateAmbiguousTriageCount(aiTriageCount)
    : 0;

  // Deterministic prep: SQLite reads + inspection clustering.
  const gatherMs = 600 + scanned * 12 + important * 25 + aiTriageCount * 8;
  const inspectMs = 350;

  let aiMs: number;
  if (aiMode === 'off') {
    aiMs = 0;
  } else if (isCloud) {
    aiMs =
      9_000 +
      important * 350 +
      scanned * 18 +
      ambiguousTriageCount * 40 +
      aiTriageCount * 4;
  } else {
    const mult =
      hwVerdict === 'comfortable'
        ? 1
        : hwVerdict === 'limited'
          ? 1.75
          : hwVerdict === 'not_recommended'
            ? 3.2
            : 2.2;
    const ramFactor = cached && cached.totalRamGb < 12 ? 1.25 : 1;
    // Managed local: briefing-only model pass; triage is rule-based (no extra infer).
    aiMs = Math.round((14_000 + important * 700) * mult * ramFactor);
  }

  const finalizeMs = 450;
  const estimatedMs = Math.max(
    4_000,
    Math.round(gatherMs + inspectMs + aiMs + finalizeMs),
  );

  // Show a slightly wider band so the UI feels honest when local AI wobbles.
  const pad = isCloud ? 0.25 : 0.4;
  const estimatedMinSec = Math.max(5, Math.floor((estimatedMs * (1 - pad * 0.3)) / 1000));
  const estimatedMaxSec = Math.ceil((estimatedMs * (1 + pad)) / 1000);

  const triageByRules = aiMode === 'local' && !isCloud;

  return {
    estimatedMs,
    estimatedMinSec,
    estimatedMaxSec,
    totalScanned: scanned,
    importantPoolSize: important,
    unreadInScope,
    aiTriageCount,
    ambiguousTriageCount,
    triageByRules,
    aiMode,
    isCloud,
    hardwareVerdict: hwVerdict,
  };
}

export function estimateBriefingNow(): BriefingDurationEstimate {
  return estimateBriefingDuration(snapshotBriefingWorkload());
}

/** Heuristic aligned with `isAmbiguousTriageRow` on typical inboxes. */
function estimateAmbiguousTriageCount(cappedUnread: number): number {
  if (cappedUnread <= 0) return 0;
  return Math.min(cappedUnread, Math.max(0, Math.round(cappedUnread * 0.35)));
}
