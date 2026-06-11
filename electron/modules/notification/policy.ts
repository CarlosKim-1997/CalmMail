/**
 * Notification policy.
 *
 * Decides whether a classified email earns an OS-level notification, and
 * builds a *short, calm* notification payload.
 *
 * Rules (anti-spam):
 *   - HIGH priority -> show OS notification, unless quiet hours
 *   - MEDIUM priority -> store but do not push (briefing only)
 *   - LOW priority -> silent storage
 *   - Per-thread suppression: never notify twice for the same thread within
 *     30 minutes.
 *   - Per-batch cap: at most 3 OS notifications per poll cycle.
 */

import type {
  AppNotification,
  EmailSummary,
  NotificationPriority,
  QuietHours,
  UserPreferences,
} from '@shared/types';

const THIRTY_MIN = 30 * 60 * 1000;
const PER_BATCH_CAP = 3;

export interface PolicyDecisionInput {
  email: EmailSummary;
  preferences: UserPreferences;
  nowMs: number;
  recentlyNotifiedThreadIds: Set<string>;
  alreadyDecidedThisBatch: number;
}

export interface PolicyDecision {
  shouldNotify: boolean;
  reason: string;
}

export function decideNotification(input: PolicyDecisionInput): PolicyDecision {
  const { email, preferences, nowMs, recentlyNotifiedThreadIds, alreadyDecidedThisBatch } = input;

  if (email.priority !== 'HIGH') {
    return { shouldNotify: false, reason: 'not_high_priority' };
  }
  if (alreadyDecidedThisBatch >= PER_BATCH_CAP) {
    return { shouldNotify: false, reason: 'batch_cap' };
  }
  if (recentlyNotifiedThreadIds.has(email.threadId)) {
    return { shouldNotify: false, reason: 'thread_recently_notified' };
  }
  if (isInQuietHours(preferences.quietHours, nowMs)) {
    return { shouldNotify: false, reason: 'quiet_hours' };
  }
  return { shouldNotify: true, reason: 'ok' };
}

export function isInQuietHours(q: QuietHours, nowMs: number): boolean {
  if (!q.enabled) return false;
  const hour = new Date(nowMs).getHours();
  const { startHour, endHour } = q;
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // wraps midnight (e.g. start 22, end 8)
  return hour >= startHour || hour < endHour;
}

export function buildNotificationPayload(
  email: EmailSummary,
  nowMs: number,
): AppNotification {
  const fromLabel = email.from.name?.trim() || email.from.email;
  const title = clamp(fromLabel, 60);
  const body = clamp(email.subject, 120);
  return {
    id: `n_${email.id}_${nowMs}`,
    priority: 'HIGH' as NotificationPriority,
    title,
    body,
    emailId: email.id,
    createdAt: nowMs,
    delivered: false,
  };
}

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
