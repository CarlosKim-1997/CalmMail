/**
 * Side effects after we auto-track an outgoing "awaiting reply" thread.
 * No AI — deterministic relationship memory updates only.
 */

import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';
import { contactsRepo } from '@main/modules/persistence/repositories/contactsRepo';
import { vipSuggestionsRepo } from '@main/modules/persistence/repositories/vipSuggestionsRepo';
import { relationshipMemory } from '@main/modules/memory/relationships';
import type { AwaitedReply } from '@shared/types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** Distinct auto-tracked awaited threads to same person before VIP suggestion. */
export const VIP_SUGGESTION_AWAITED_THRESHOLD = 2;
/** Per newly tracked awaited thread (not duplicate thread). */
const IMPORTANCE_BUMP = 6;

/**
 * Call after `trackOutgoingAsAwaitedIfNeeded` returns non-null.
 * Bumps importance and may surface a one-shot VIP promotion card.
 */
export function onAwaitedAutoTracked(item: AwaitedReply, isNewThread: boolean): void {
  const email = item.contact.toLowerCase();
  relationshipMemory.recordInteraction(email, item.sentAt);

  if (isNewThread) {
    relationshipMemory.applyValidatedDelta(email, { importance: IMPORTANCE_BUMP });
  }

  const existing = contactsRepo.get(email);
  if (existing?.isVip) return;

  const count = awaitedRepo.countAutoInferredForContact(email, Date.now() - THIRTY_DAYS_MS);
  if (count >= VIP_SUGGESTION_AWAITED_THRESHOLD) {
    vipSuggestionsRepo.upsertOpen(email, count);
  }
}
