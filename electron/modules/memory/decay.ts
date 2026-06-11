/**
 * Memory decay system.
 *
 * Rules:
 *   - No interaction for 30+ days  -> reduce importance slightly
 *   - No interaction for 90+ days  -> drop "waiting" awaited replies
 *
 * Decay is idempotent enough to run safely on every app start and once a day.
 */

import { contactsRepo } from '@main/modules/persistence/repositories/contactsRepo';
import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * DAY_MS;
const NINETY_DAYS = 90 * DAY_MS;

export interface DecayReport {
  contactsDecayed: number;
  awaitedDropped: number;
}

export function runMemoryDecay(now: number = Date.now()): DecayReport {
  const contactsDecayed = contactsRepo.applyDecay((c) => {
    if (c.importance <= 0) return null;
    if (c.lastInteractionAt == null) {
      // Never interacted with us -> decay a tiny bit.
      return { importance: Math.max(0, c.importance - 1) };
    }
    const age = now - c.lastInteractionAt;
    if (age < THIRTY_DAYS) return null;
    // Linear-ish gentle decay: -2 per month idle past 30 days.
    const monthsOver = Math.floor((age - THIRTY_DAYS) / (30 * DAY_MS));
    const reduction = 1 + monthsOver;
    return { importance: Math.max(0, c.importance - reduction) };
  });

  const awaitedDropped = awaitedRepo.dropStale(NINETY_DAYS);

  return { contactsDecayed, awaitedDropped };
}
