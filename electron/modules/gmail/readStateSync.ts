/**
 * Re-fetch Gmail metadata for cached messages so `is_unread` stays aligned
 * after the user reads mail in Gmail (poller only ingests *new* ids).
 */

import { fetchMessagesMetadata } from './client';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { resolveTriageWindowDays } from '@shared/triage';

export async function refreshStoredUnreadFlags(opts?: {
  withinDays?: number;
  limit?: number;
  emailIds?: string[];
}): Promise<number> {
  const withinDays =
    opts?.withinDays ??
    resolveTriageWindowDays(preferencesMemory.get().triageWindowDays);
  const limit = opts?.limit ?? 100;

  let ids: string[];
  if (opts?.emailIds && opts.emailIds.length > 0) {
    ids = [...new Set(opts.emailIds)];
  } else {
    ids = emailsRepo.unreadWithinDays(withinDays, limit).map((e) => e.id);
  }

  if (ids.length === 0) return 0;

  const metas = await fetchMessagesMetadata(ids);
  let updated = 0;

  for (const m of metas) {
    const existing = emailsRepo.get(m.summary.id);
    if (!existing) continue;
    const labelsChanged =
      JSON.stringify(existing.labels) !== JSON.stringify(m.summary.labels);
    if (existing.isUnread !== m.summary.isUnread || labelsChanged) {
      emailsRepo.upsert({
        ...existing,
        isUnread: m.summary.isUnread,
        labels: m.summary.labels,
        snippet: m.summary.snippet,
        subject: m.summary.subject,
      });
      updated += 1;
    }
  }

  return updated;
}
