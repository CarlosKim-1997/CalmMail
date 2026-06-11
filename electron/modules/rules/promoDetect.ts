/**
 * High-precision promotional / legal-ad detection shared by categorize,
 * senderClassifier, and backfill paths.
 *
 * Korean commercial email often carries a legal prefix like "(광고)" in the
 * subject. That signal must win over Gmail's CATEGORY_UPDATES label, which
 * incorrectly buckets JobKorea / Wanted digests as "updates".
 */

/** Subject/snippet looks like a Korean legally-tagged advertisement. */
export function isKrLegalAdTag(subject: string, snippet = ''): boolean {
  const sub = subject.trim();
  if (!sub) return false;
  if (/\(광고\)/.test(sub)) return true;
  if (/\[광고\]/.test(sub)) return true;
  if (/【광고】/.test(sub)) return true;
  if (/^\s*광고\s*[\]:\-|·]/.test(sub)) return true;
  if (/^\s*AD\s*[\]:\-]/i.test(sub)) return true;
  const hay = `${sub}\n${snippet}`;
  if (/\(광고\)/.test(hay)) return true;
  return false;
}

const PROMO_BODY_NEEDLES = [
  '할인',
  '쿠폰',
  '세일',
  '특가',
  '프로모션',
  '이벤트',
  '무료배송',
  '최저가',
  'unsubscribe',
  '구독 취소',
  'sale',
  'discount',
  'coupon',
  'promo',
  'newsletter',
  'digest',
];

/** Broader marketing hint (subject + snippet), excluding pure legal tag. */
export function isPromotionalContent(subject: string, snippet: string): boolean {
  if (isKrLegalAdTag(subject, snippet)) return true;
  const hay = `${subject}\n${snippet}`.toLowerCase();
  for (const n of PROMO_BODY_NEEDLES) {
    if (hay.includes(n.toLowerCase())) return true;
  }
  return false;
}
