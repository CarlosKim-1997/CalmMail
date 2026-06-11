/**
 * Layer 3: Relationship Memory.
 *
 * Long-term, low-frequency context about each contact. Mutations here only
 * happen via:
 *  - Direct user actions (e.g. marking VIP)
 *  - The rule engine applying a validated MemoryProposal
 *  - The decay sweep
 */

import { contactsRepo } from '@main/modules/persistence/repositories/contactsRepo';
import type { ContactMemory } from '@shared/types';

export const relationshipMemory = {
  list(): ContactMemory[] {
    return contactsRepo.list();
  },

  get(email: string): ContactMemory | null {
    return contactsRepo.get(email);
  },

  /** Direct user edit, e.g. "mark VIP" or "add a note". */
  userEdit(input: Partial<ContactMemory> & { email: string }): ContactMemory {
    return contactsRepo.upsert(input);
  },

  /** Called by the rule engine after validating a proposal. Not by the AI. */
  applyValidatedDelta(
    email: string,
    delta: Partial<Pick<ContactMemory, 'importance' | 'isVip' | 'topicTags'>>,
  ): ContactMemory {
    const existing = contactsRepo.get(email) ?? {
      email,
      displayName: null,
      isVip: false,
      importance: 0,
      averageReplyMinutes: null,
      lastInteractionAt: null,
      topicTags: [],
      notes: null,
    };
    const nextImportance =
      delta.importance != null
        ? clamp(existing.importance + delta.importance, 0, 100)
        : existing.importance;
    const nextTags = delta.topicTags
      ? Array.from(new Set([...existing.topicTags, ...delta.topicTags])).slice(0, 20)
      : existing.topicTags;

    return contactsRepo.upsert({
      email,
      importance: nextImportance,
      isVip: delta.isVip ?? existing.isVip,
      topicTags: nextTags,
    });
  },

  recordInteraction(email: string, at: number, replyMinutes?: number): void {
    const existing = contactsRepo.get(email);
    const newAvg =
      existing?.averageReplyMinutes != null && replyMinutes != null
        ? Math.round((existing.averageReplyMinutes * 0.7) + (replyMinutes * 0.3))
        : replyMinutes ?? existing?.averageReplyMinutes ?? null;
    contactsRepo.upsert({
      email,
      lastInteractionAt: at,
      averageReplyMinutes: newAvg,
    });
  },
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
