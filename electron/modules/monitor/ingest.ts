/**
 * Shared ingest pipeline for freshly-fetched mail.
 *
 * Both the poller (batch) and the IMAP real-time watcher funnel messages
 * through here: classify with the rule engine, persist with provider-scoped
 * identity, track priority threads, and hand the batch to the notification
 * manager. Keeping this in one place ensures poll and push behave identically.
 */

import type { EmailSummary, UserPreferences } from '@shared/types';
import type { FetchedMessage, MailProvider } from '@main/modules/mail';
import { ruleEngine } from '@main/modules/rules/engine';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { sessionMemory } from '@main/modules/memory/session';
import { notificationManager } from '@main/modules/notification/manager';
import { preferencesMemory } from '@main/modules/memory/preferences';

export interface IngestResult {
  classified: EmailSummary[];
  newHighPriority: number;
  newMediumPriority: number;
}

export async function ingestFetchedMessages(
  metas: FetchedMessage[],
  provider: MailProvider,
  opts?: { preferences?: UserPreferences; userPrimaryEmail?: string | null },
): Promise<IngestResult> {
  const prefs = opts?.preferences ?? preferencesMemory.get();
  const userPrimary =
    opts?.userPrimaryEmail !== undefined ? opts.userPrimaryEmail : provider.getConnectedEmail();

  let newHighPriority = 0;
  let newMediumPriority = 0;
  const classified: EmailSummary[] = [];

  for (const m of metas) {
    const out = ruleEngine.classifyIncoming(m.summary, {
      preferences: prefs,
      userPrimaryEmail: userPrimary,
      headerSignals: m.headerSignals,
    });
    emailsRepo.upsert(out, {
      provider: provider.id,
      accountId: provider.accountKey(),
      canonicalId: out.id,
      providerMessageId: '',
      rfcMessageId: null,
      threadKey: out.threadId,
    });
    classified.push(out);
    if (out.priority === 'HIGH') {
      sessionMemory.pushPriorityThread(out.threadId);
      newHighPriority += 1;
    } else if (out.priority === 'MEDIUM') {
      newMediumPriority += 1;
    }
  }

  await notificationManager.handleNewlyClassified(classified, prefs);
  return { classified, newHighPriority, newMediumPriority };
}
