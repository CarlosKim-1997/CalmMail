/**
 * Memory Proposal Validator.
 *
 * The AI produces *proposals*, never direct mutations. This validator decides
 * whether to apply them, and how strongly.
 *
 * Hard limits enforced here (anti-runaway):
 *   - Maximum importance delta per proposal: ±10
 *   - Maximum total importance delta per contact per day: ±20
 *   - VIP flag can only be set/unset by the user, never the AI
 *   - Awaited reply flagging by AI requires a target_thread_id
 */

import type {
  ContactMemory,
  MemoryProposal,
  MemoryProposalResult,
} from '@shared/types';
import { contactsRepo } from '@main/modules/persistence/repositories/contactsRepo';
import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';
import { assertCanAddAwaitedWaitingRow } from '@main/modules/monetization/limits';
import { proposalLogRepo } from '@main/modules/persistence/repositories/proposalLogRepo';
import { relationshipMemory } from '@main/modules/memory/relationships';

const MAX_DELTA_PER_PROPOSAL = 10;
const MAX_DELTA_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** In-memory daily budgets keyed by contact email. */
const dailyBudget = new Map<string, { day: number; spent: number }>();

function dayKey(): number {
  return Math.floor(Date.now() / DAY_MS);
}

function consumeBudget(contact: string, delta: number): number {
  const today = dayKey();
  const entry = dailyBudget.get(contact);
  const spent = entry && entry.day === today ? entry.spent : 0;
  const remaining = MAX_DELTA_PER_DAY - Math.abs(spent);
  if (remaining <= 0) return 0;

  const absDelta = Math.min(Math.abs(delta), remaining);
  const signedDelta = delta < 0 ? -absDelta : absDelta;

  dailyBudget.set(contact, {
    day: today,
    spent: spent + signedDelta,
  });
  return signedDelta;
}

export function validateAndApply(p: MemoryProposal): MemoryProposalResult {
  const result = doValidateAndApply(p);
  proposalLogRepo.record(p, result);
  return result;
}

function doValidateAndApply(p: MemoryProposal): MemoryProposalResult {
  switch (p.action) {
    case 'increase_importance':
    case 'decrease_importance': {
      if (!p.targetContact) {
        return { applied: false, rejectionReason: 'missing_target_contact' };
      }
      if (p.delta == null || Number.isNaN(p.delta)) {
        return { applied: false, rejectionReason: 'missing_delta' };
      }
      const signed =
        p.action === 'increase_importance' ? Math.abs(p.delta) : -Math.abs(p.delta);
      const clamped = clampSign(signed, MAX_DELTA_PER_PROPOSAL);
      const granted = consumeBudget(p.targetContact, clamped);
      if (granted === 0) {
        return { applied: false, rejectionReason: 'daily_budget_exhausted' };
      }
      relationshipMemory.applyValidatedDelta(p.targetContact, {
        importance: granted,
      });
      return { applied: true, finalDelta: granted };
    }

    case 'add_topic_tag': {
      if (!p.targetContact || !p.topic) {
        return { applied: false, rejectionReason: 'missing_topic_or_contact' };
      }
      const tag = p.topic.trim().toLowerCase();
      if (!tag || tag.length > 40) {
        return { applied: false, rejectionReason: 'invalid_topic' };
      }
      relationshipMemory.applyValidatedDelta(p.targetContact, {
        topicTags: [tag],
      });
      return { applied: true };
    }

    case 'mark_vip':
    case 'unmark_vip':
      // VIP changes belong to the user. The AI is not allowed to set VIP.
      return { applied: false, rejectionReason: 'vip_is_user_only' };

    case 'flag_awaited_reply': {
      if (!p.targetThreadId || !p.targetContact) {
        return {
          applied: false,
          rejectionReason: 'missing_thread_or_contact',
        };
      }
      const existing = awaitedRepo.get(p.targetThreadId);
      if (existing && existing.status !== 'dropped') {
        return { applied: false, rejectionReason: 'already_tracked' };
      }
      try {
        assertCanAddAwaitedWaitingRow(p.targetThreadId);
      } catch {
        return { applied: false, rejectionReason: 'awaited_free_tier_limit' };
      }
      awaitedRepo.upsert({
        threadId: p.targetThreadId,
        contact: p.targetContact.toLowerCase(),
        subject: '(ai-inferred)',
        sentAt: Date.now(),
        expectedByMinutes: null,
        status: 'waiting',
        reason: 'ai_proposed',
      });
      return { applied: true };
    }

    case 'resolve_awaited_reply': {
      if (!p.targetThreadId) {
        return { applied: false, rejectionReason: 'missing_thread' };
      }
      const existing = awaitedRepo.get(p.targetThreadId);
      if (!existing) return { applied: false, rejectionReason: 'not_tracked' };
      awaitedRepo.setStatus(p.targetThreadId, 'received');
      return { applied: true };
    }

    default:
      return { applied: false, rejectionReason: 'unknown_action' };
  }
}

function clampSign(v: number, absMax: number): number {
  if (v > absMax) return absMax;
  if (v < -absMax) return -absMax;
  return v;
}

/** Helper used by callers that need to know the current contact prior. */
export function snapshotContact(email: string): ContactMemory | null {
  return contactsRepo.get(email);
}
