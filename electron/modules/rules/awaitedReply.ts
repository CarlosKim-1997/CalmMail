/**
 * Awaited-reply inference rules.
 *
 * We only mark a thread as "awaiting reply" via deterministic, transparent
 * rules. The AI may *propose* awaited replies, but proposals go through the
 * proposal validator. This is what keeps the experience from feeling creepy.
 */

import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';
import type { AwaitedReply } from '@shared/types';
import { mayAutoTrackAwaited } from '@main/modules/monetization/limits';
import { onAwaitedAutoTracked } from './awaitedEngagement';

export interface SentByUserSignal {
  threadId: string;
  toEmail: string;
  subject: string;
  sentAt: number;
  /**
   * Whether the user's body text contains a "soft question" (?, "could you",
   * "please", etc). Calculated by the Gmail layer with no AI.
   */
  containsQuestion: boolean;
}

/**
 * Called whenever the user sends a message. If it looks like a question,
 * we auto-track the thread as awaiting a reply.
 */
export function trackOutgoingAsAwaitedIfNeeded(
  signal: SentByUserSignal,
): AwaitedReply | null {
  if (!signal.containsQuestion) return null;
  const existing = awaitedRepo.get(signal.threadId);
  if (existing && existing.status !== 'dropped') return existing;
  if (!mayAutoTrackAwaited(signal.threadId)) return null;

  const isNewThread = !existing;
  const item: AwaitedReply = {
    threadId: signal.threadId,
    contact: signal.toEmail.toLowerCase(),
    subject: signal.subject,
    sentAt: signal.sentAt,
    expectedByMinutes: null,
    status: 'waiting',
    reason: 'auto_inferred',
  };
  awaitedRepo.upsert(item);
  onAwaitedAutoTracked(item, isNewThread);
  return item;
}

/**
 * Called when a new incoming message lands in a thread we were waiting on.
 * Marks the awaited reply as received.
 */
export function resolveOnIncoming(threadId: string, fromEmail: string): boolean {
  const existing = awaitedRepo.get(threadId);
  if (!existing || existing.status !== 'waiting') return false;
  if (existing.contact.toLowerCase() !== fromEmail.toLowerCase()) return false;
  awaitedRepo.setStatus(threadId, 'received');
  return true;
}

/** User-driven: "please track this thread as awaiting a reply". */
export function userMarkAwaited(
  threadId: string,
  contact: string,
  subject: string,
  sentAt: number,
  expectedByMinutes?: number,
): AwaitedReply {
  const item: AwaitedReply = {
    threadId,
    contact: contact.toLowerCase(),
    subject,
    sentAt,
    expectedByMinutes: expectedByMinutes ?? null,
    status: 'waiting',
    reason: 'user_marked',
  };
  awaitedRepo.upsert(item);
  return item;
}

/** Heuristic question detection used by the Gmail layer. */
export function looksLikeQuestion(plainText: string): boolean {
  const t = plainText.toLowerCase();
  if (t.includes('?')) return true;
  if (t.includes('？')) return true;
  const cues = [
    'could you',
    'can you',
    'would you',
    'please ',
    'kindly',
    'let me know',
    'awaiting your',
    'looking forward',
    'please confirm',
    'please advise',
    '회신',
    '답변',
    '부탁',
    '검토',
    '확인 부탁',
    '공유 부탁',
    '연락 부탁',
    '기다리',
    '기다립',
  ];
  return cues.some((c) => t.includes(c));
}
