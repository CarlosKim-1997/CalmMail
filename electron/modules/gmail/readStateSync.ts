/**
 * Re-fetch provider metadata for cached messages so `is_unread` stays aligned
 * after the user reads mail elsewhere (poller only ingests *new* ids).
 */

import { isDemoUiEnabled } from '@main/demo/demoUiEnv';
import {
  fetchMessagesByUid,
  getActiveMailProvider,
  imapAccountStore,
} from '@main/modules/mail';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { resolveTriageWindowDays } from '@shared/triage';

export async function refreshStoredUnreadFlags(opts?: {
  withinDays?: number;
  limit?: number;
  emailIds?: string[];
}): Promise<number> {
  if (isDemoUiEnabled()) return 0;

  const provider = getActiveMailProvider();
  if (provider.id === 'imap') {
    return refreshImapUnreadFlags(provider.accountKey(), opts);
  }
  return refreshProviderUnreadFlags(opts);
}

async function refreshImapUnreadFlags(
  accountId: string,
  opts?: { withinDays?: number; limit?: number; emailIds?: string[] },
): Promise<number> {
  const account = imapAccountStore.get();
  if (!account) return 0;

  const withinDays =
    opts?.withinDays ??
    resolveTriageWindowDays(preferencesMemory.get().triageWindowDays);
  const limit = opts?.limit ?? 100;

  const refs = emailsRepo.unreadInboxRefsForProvider(
    'imap',
    accountId,
    withinDays,
    limit,
    opts?.emailIds?.length ? [...new Set(opts.emailIds)] : undefined,
  );
  if (refs.length === 0) return 0;

  const uidList = refs.map((r) => r.providerMessageId);
  const metas = await fetchMessagesByUid(account, uidList);
  const metaById = new Map(metas.map((m) => [m.summary.id, m]));

  let updated = 0;
  for (const ref of refs) {
    const m = metaById.get(ref.id);
    if (!m) continue;
    const existing = emailsRepo.get(ref.id);
    if (!existing) continue;
    if (existing.isUnread !== m.summary.isUnread) {
      emailsRepo.upsert({
        ...existing,
        isUnread: m.summary.isUnread,
        snippet: m.summary.snippet,
        subject: m.summary.subject,
      });
      updated += 1;
    }
  }
  return updated;
}

async function refreshProviderUnreadFlags(opts?: {
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

  const metas = await getActiveMailProvider().fetchMessagesMetadata(ids);
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
