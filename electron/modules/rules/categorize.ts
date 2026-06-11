/**
 * Deterministic email category derivation.
 *
 * Two-step policy:
 *   1. If the sender already has a cached profile with a non-`unknown` kind,
 *      trust that — it was learned over multiple observations with header,
 *      domain, and recurrence signals (see `senderClassifier`).
 *   2. Otherwise, reuse Gmail's CATEGORY_* labels and a small subject hint
 *      list as a one-shot fallback. We *never* fall through to "personal"
 *      without evidence; an automated-shaped local part now defaults to
 *      "notification" instead, which is the historical bug we are fixing.
 */

import type { EmailCategory, EmailSummary, SenderProfile } from '@shared/types';
import { isKrLegalAdTag, isPromotionalContent } from './promoDetect';
import { senderKindToCategory } from './senderClassifier';

const PROMO_HINTS = [
  '광고',
  '(광고)',
  '[광고]',
  '할인',
  '쿠폰',
  '세일',
  '특가',
  '프로모션',
  'sale',
  'discount',
  'coupon',
  'promo',
  'unsubscribe',
  '구독 취소',
];

const TX_HINTS = [
  '영수증',
  '결제',
  '주문',
  '배송',
  '인증',
  '보안',
  '청구',
  'receipt',
  'invoice',
  'order',
  'shipment',
  'verification',
  'security alert',
  'billing',
];

const NEWSLETTER_HINTS = [
  '뉴스레터',
  '주간',
  '월간',
  'digest',
  'newsletter',
  'weekly',
  'monthly',
];

export function deriveCategory(
  email: Pick<EmailSummary, 'labels' | 'subject' | 'snippet' | 'from'>,
  profile?: SenderProfile | null,
): EmailCategory {
  // 0) Korean legal ad tag — beats Gmail labels and cached mis-tags.
  if (isKrLegalAdTag(email.subject, email.snippet)) return 'promotion';

  // 1) A high-confidence cached profile overrides everything except VIPs.
  // The rule engine still gets the final say on whether to promote (e.g. a
  // VIP "company" mail keeps the company category, but its importance is
  // bumped separately).
  if (profile && profile.kind !== 'unknown' && profile.confidence >= 50) {
    const mapped = senderKindToCategory(profile.kind);
    if (mapped) return mapped;
  }

  const labelSet = new Set(email.labels);
  const haystack = `${email.subject}\n${email.snippet}`.toLowerCase();

  if (labelSet.has('CATEGORY_PROMOTIONS')) return 'promotion';
  if (labelSet.has('CATEGORY_SOCIAL')) return 'social';
  if (labelSet.has('CATEGORY_FORUMS')) return 'notification';
  if (labelSet.has('CATEGORY_UPDATES')) {
    if (isPromotionalContent(email.subject, email.snippet)) return 'promotion';
    return 'transactional';
  }

  if (matches(haystack, PROMO_HINTS)) return 'promotion';
  if (matches(haystack, TX_HINTS)) return 'transactional';
  if (matches(haystack, NEWSLETTER_HINTS)) return 'newsletter';

  const fromLocal = email.from.email.split('@')[0]?.toLowerCase() ?? '';
  if (/^(noreply|no-reply|notifications?|donotreply|mailer|news|info|hello|support|marketing|service)/.test(fromLocal)) {
    return 'notification';
  }

  // 2) If we have a low-confidence profile reading, lean into it rather than
  // claiming "personal" with zero evidence — this is the case that surfaced
  // 15/34 Korean promotions as "개인" in the briefing.
  if (profile && profile.kind !== 'unknown' && profile.kind !== 'person') {
    const mapped = senderKindToCategory(profile.kind);
    if (mapped) return mapped;
  }

  if (labelSet.has('CATEGORY_PERSONAL')) {
    if (isPromotionalContent(email.subject, email.snippet)) return 'promotion';
    return 'personal';
  }
  // Default keeps "personal" only when we have positive signals to believe
  // so; otherwise stay conservative with "other" so the bucket doesn't get
  // polluted again.
  if (profile?.kind === 'person') return 'personal';
  return 'other';
}

/** Categories the dashboard treats as "low signal" (shown under a fold). */
export const NON_IMPORTANT_CATEGORIES: ReadonlySet<EmailCategory> = new Set([
  'promotion',
  'social',
  'newsletter',
  'notification',
  // "other" is the new conservative bucket for senders we don't have enough
  // signal to call human or company. Keep it under the fold until evidence
  // arrives — better quiet than wrong.
  'other',
]);

export function isLowSignalCategory(c: EmailCategory): boolean {
  return NON_IMPORTANT_CATEGORIES.has(c);
}

function matches(hay: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (hay.includes(n)) return true;
  }
  return false;
}
