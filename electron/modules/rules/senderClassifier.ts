/**
 * Deterministic sender classifier.
 *
 * Goal: assign every incoming sender to a coarse `SenderKind` bucket so the
 * rest of the system stops treating "광고/마케팅" as `personal`. We rely on a
 * stack of cheap signals — Gmail labels, well-known headers, local-part of
 * the address, free-mail vs corporate domain, and recurrence — and we
 * deliberately keep the policy here in one place so it can be reviewed.
 *
 * The classifier produces a `ClassifyResult` for a single observation; the
 * `senderProfilesRepo` is the one that smooths these into a stable profile
 * with hysteresis (see `observe`).
 */

import type { SenderKind, SenderProfile } from '@shared/types';
import { isKrLegalAdTag, isPromotionalContent } from './promoDetect';
import { seedKindForDomain } from './senderDomainSeeds';

/** Anything that ships email through one of these is almost never personal. */
const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'kakao.com',
  'nate.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.kr',
  'protonmail.com',
  'proton.me',
  'tutanota.com',
  'aol.com',
]);

/**
 * Local-parts that almost always belong to an automated mailbox. Matched as
 * a *prefix* so `noreply-abc@x` and `notifications+xyz@x` both trip.
 */
const AUTOMATED_LOCAL_PREFIXES = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'no_reply',
  'mailer',
  'mail',
  'auto',
  'autoreply',
  'auto-reply',
  'system',
  'admin',
  'webmaster',
  'postmaster',
  'support',
  'help',
  'service',
  'services',
  'cs',
  'customer',
  'customerservice',
  'notification',
  'notifications',
  'alerts',
  'alert',
  'news',
  'newsletter',
  'updates',
  'broadcast',
  'marketing',
  'promo',
  'promotion',
  'promotions',
  'deals',
  'offers',
  'sale',
  'sales',
  'event',
  'events',
  'campaign',
  'crm',
  'mkt',
  'mktg',
  'info',
  'hello',
  'hi',
  'contact',
  'team',
  'community',
  'social',
];

/**
 * Marketing-leaning words anywhere in the local part (after the prefix check).
 * Useful for cases like `coupang_deal@coupang.com` or `event2025@brand.com`.
 */
const MARKETING_LOCAL_NEEDLES = [
  'promo',
  'promotion',
  'sale',
  'deal',
  'offer',
  'coupon',
  'event',
  'campaign',
  'newsletter',
  'digest',
  'subscribe',
];

/**
 * Subject/snippet hints. The previous categorizer had a tiny list; we expand
 * it with high-precision Korean marketing tokens that are the real-world
 * source of the "광고가 개인으로 분류됨" bug.
 */
const PROMO_SUBJECT_HINTS = [
  '할인',
  '쿠폰',
  '세일',
  '특가',
  '프로모션',
  '이벤트',
  '%',
  '원',
  '무료배송',
  '단독',
  '오픈마켓',
  '최저가',
  '한정',
  '광고',
  'AD]',
  '(광고)',
  '구독',
  '뉴스레터',
  '소식',
  'sale',
  'discount',
  'coupon',
  'promo',
  'offer',
  'deal',
  'campaign',
  'newsletter',
  'weekly',
  'monthly',
  'digest',
  'unsubscribe',
  '구독 취소',
];

/** Transactional hints — receipts, security, calendar. */
const TX_SUBJECT_HINTS = [
  '영수증',
  '결제',
  '주문',
  '배송',
  '인증',
  '보안',
  '청구',
  '카드 사용',
  '결제 완료',
  '결제 확인',
  'receipt',
  'invoice',
  'order',
  'shipment',
  'verification',
  'security alert',
  'billing',
  'payment',
  '2fa',
];

/**
 * Subject hints we use as a "this might still be personal" override on
 * otherwise ambiguous mail. Re:/Fwd: chains and short Korean honorifics tend
 * to be conversation, not marketing.
 */
const PERSONAL_SUBJECT_HINTS = [
  're:',
  'fwd:',
  'fw:',
  '회신:',
  '답장:',
  '님께',
  '안녕하세요',
  '님 안녕',
];

export interface ClassifyContext {
  /** Lowercased email + display name. */
  email: string;
  displayName: string | null;
  /** Raw Gmail label ids on the message. */
  labels: string[];
  /** Already-lowercased subject + snippet to scan for hints. */
  subject: string;
  snippet: string;
  /** Lowercased values of List-Unsubscribe / Precedence / Auto-Submitted etc. */
  headerSignals: HeaderSignals;
  /** True when the user's primary email is on the To: list and the list is short. */
  directlyAddressed: boolean;
  /** Was this thread already in the user's awaited-reply set, or a known contact. */
  knownHumanCorrespondent: boolean;
  /** Existing profile, if any — used to apply minimum-evidence rules. */
  existing: SenderProfile | null;
}

export interface HeaderSignals {
  hasListUnsubscribe: boolean;
  precedenceBulk: boolean;
  autoSubmitted: boolean;
  hasCampaignId: boolean;
}

export interface ClassifyResult {
  kind: SenderKind;
  /** 0..100 — how confident this single observation is. */
  confidence: number;
  /** Cumulative delta for the profile's bulk_signal_count. */
  bulkSignalDelta: number;
  /** Cumulative delta for the profile's human_signal_count. */
  humanSignalDelta: number;
  /** Best-effort label of the organization, when one can be inferred. */
  affiliation: string | null;
  /** Short reason codes — useful in tests and the dev briefing inspector. */
  why: string[];
}

export function classifySender(ctx: ClassifyContext): ClassifyResult {
  const localPart = ctx.email.split('@')[0]?.toLowerCase() ?? '';
  const domain = (ctx.email.split('@')[1] ?? '').toLowerCase();
  const labels = new Set(ctx.labels);
  const subjectLower = ctx.subject.toLowerCase();
  const haystack = `${subjectLower} ${ctx.snippet.toLowerCase()}`;
  const why: string[] = [];

  // --- 1. Strong "this is automated mail" gates ----------------------------
  // List-Unsubscribe + Precedence: bulk + Auto-Submitted are RFC-grade
  // hints. Combined with a marketing-shaped local part or subject, this is
  // almost certainly company mail. We split it into newsletter vs promotion
  // vs notification once we know which one matches the body shape.
  if (ctx.headerSignals.hasListUnsubscribe) why.push('list_unsubscribe');
  if (ctx.headerSignals.precedenceBulk) why.push('precedence_bulk');
  if (ctx.headerSignals.autoSubmitted) why.push('auto_submitted');
  if (ctx.headerSignals.hasCampaignId) why.push('campaign_id');

  const bulkSignal =
    ctx.headerSignals.hasListUnsubscribe ||
    ctx.headerSignals.precedenceBulk ||
    ctx.headerSignals.autoSubmitted ||
    ctx.headerSignals.hasCampaignId;

  const localIsAutomated = AUTOMATED_LOCAL_PREFIXES.some((p) =>
    localPart === p ||
    localPart.startsWith(`${p}-`) ||
    localPart.startsWith(`${p}.`) ||
    localPart.startsWith(`${p}_`) ||
    localPart.startsWith(`${p}+`),
  );
  if (localIsAutomated) why.push('automated_local_part');

  const localIsMarketing = MARKETING_LOCAL_NEEDLES.some((n) =>
    localPart.includes(n),
  );
  if (localIsMarketing) why.push('marketing_local_part');

  const legalAd = isKrLegalAdTag(ctx.subject, ctx.snippet);
  if (legalAd) why.push('kr_legal_ad');
  const subjectIsPromo =
    legalAd || isPromotionalContent(ctx.subject, ctx.snippet) || matchAny(haystack, PROMO_SUBJECT_HINTS);
  if (subjectIsPromo && !legalAd) why.push('promo_subject');
  const subjectIsTx = matchAny(haystack, TX_SUBJECT_HINTS);
  if (subjectIsTx) why.push('tx_subject');
  const subjectIsPersonalish = matchAny(subjectLower, PERSONAL_SUBJECT_HINTS);
  if (subjectIsPersonalish) why.push('personal_subject');

  // --- 0. Legal ad tag (highest priority) ----------------------------------
  if (legalAd) {
    return finish('company', 92, {
      bulkSignalDelta: 2,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why,
    });
  }

  // --- 0b. Known marketing domains (no headers on backfill) ----------------
  if (!ctx.knownHumanCorrespondent) {
    const seed = seedKindForDomain(domain);
    if (seed && seed !== 'person' && seed !== 'unknown') {
      return finish(seed, 85, {
        bulkSignalDelta: seed === 'company' ? 1 : 0,
        humanSignalDelta: 0,
        affiliation: inferAffiliation(domain, ctx.displayName),
        why: [...why, 'domain_seed'],
      });
    }
  }

  // --- 2. Gmail labels are decent ground truth -----------------------------
  if (labels.has('CATEGORY_PROMOTIONS')) {
    return finish('company', 78, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why: [...why, 'gmail_promotions'],
    });
  }
  if (labels.has('CATEGORY_UPDATES')) {
    if (subjectIsPromo) {
      return finish('company', 75, {
        bulkSignalDelta: 1,
        humanSignalDelta: 0,
        affiliation: inferAffiliation(domain, ctx.displayName),
        why: [...why, 'gmail_updates_promo'],
      });
    }
    return finish('transactional', 70, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why: [...why, 'gmail_updates'],
    });
  }
  if (labels.has('CATEGORY_SOCIAL')) {
    return finish('notification', 70, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why: [...why, 'gmail_social'],
    });
  }
  if (labels.has('CATEGORY_FORUMS')) {
    return finish('notification', 65, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why: [...why, 'gmail_forums'],
    });
  }

  // --- 3. Header bulk + marketing-shaped subject = company -----------------
  if (bulkSignal && (subjectIsPromo || localIsMarketing)) {
    return finish('company', 88, {
      bulkSignalDelta: 2,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why,
    });
  }

  // --- 4. Header bulk without a marketing body = newsletter ---------------
  // Many digest / weekly mailers don't include Korean promo words.
  if (bulkSignal && /(weekly|monthly|digest|뉴스레터|소식|newsletter)/i.test(haystack)) {
    return finish('newsletter', 80, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why: [...why, 'newsletter_subject'],
    });
  }
  if (bulkSignal) {
    // Generic bulk → "company" is safer than "personal" (the bug we are
    // fixing). Lower confidence so a later signal can refine to newsletter
    // or transactional.
    return finish('company', 72, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why: [...why, 'bulk_no_body_match'],
    });
  }

  // --- 5. Local part screams automated -------------------------------------
  if (localIsAutomated) {
    if (subjectIsPromo || localIsMarketing) {
      return finish('company', 78, {
        bulkSignalDelta: 1,
        humanSignalDelta: 0,
        affiliation: inferAffiliation(domain, ctx.displayName),
        why,
      });
    }
    if (subjectIsTx) {
      return finish('transactional', 78, {
        bulkSignalDelta: 1,
        humanSignalDelta: 0,
        affiliation: inferAffiliation(domain, ctx.displayName),
        why,
      });
    }
    return finish('notification', 70, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why,
    });
  }

  // --- 6. Subject hints alone (no header, no auto local) -------------------
  if (subjectIsPromo) {
    return finish('company', 60, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why,
    });
  }
  if (subjectIsTx) {
    return finish('transactional', 60, {
      bulkSignalDelta: 1,
      humanSignalDelta: 0,
      affiliation: inferAffiliation(domain, ctx.displayName),
      why,
    });
  }

  // --- 7. Strong human signals --------------------------------------------
  // Reply-shaped subject + person-shaped address.
  if (subjectIsPersonalish && !localIsAutomated) {
    return finish('person', 65, {
      bulkSignalDelta: 0,
      humanSignalDelta: 1,
      affiliation: FREE_MAIL_DOMAINS.has(domain)
        ? null
        : inferAffiliation(domain, ctx.displayName),
      why: [...why, 'reply_shaped_subject'],
    });
  }
  if (ctx.knownHumanCorrespondent) {
    return finish('person', 75, {
      bulkSignalDelta: 0,
      humanSignalDelta: 2,
      affiliation: FREE_MAIL_DOMAINS.has(domain)
        ? null
        : inferAffiliation(domain, ctx.displayName),
      why: [...why, 'prior_conversation'],
    });
  }
  if (ctx.directlyAddressed && FREE_MAIL_DOMAINS.has(domain)) {
    // Free-mail domain + direct addressing + no marketing signals → likely
    // a real person writing to us.
    return finish('person', 55, {
      bulkSignalDelta: 0,
      humanSignalDelta: 1,
      affiliation: null,
      why: [...why, 'direct_freemail'],
    });
  }

  // --- 8. Last resort: unknown --------------------------------------------
  // Don't claim "personal" without evidence. The repo's hysteresis will keep
  // us here until more signals arrive.
  return finish('unknown', 30, {
    bulkSignalDelta: 0,
    humanSignalDelta: ctx.directlyAddressed ? 1 : 0,
    affiliation: FREE_MAIL_DOMAINS.has(domain)
      ? null
      : inferAffiliation(domain, ctx.displayName),
    why: [...why, 'insufficient_signal'],
  });
}

function finish(
  kind: SenderKind,
  confidence: number,
  rest: Omit<ClassifyResult, 'kind' | 'confidence'>,
): ClassifyResult {
  return { kind, confidence, ...rest };
}

function inferAffiliation(domain: string, displayName: string | null): string | null {
  if (FREE_MAIL_DOMAINS.has(domain)) return null;
  const trimmedName = displayName?.trim() ?? '';
  if (trimmedName) {
    // Drop trailing brackets ("Coupang <no-reply@coupang.com>" → "Coupang").
    const cleaned = trimmedName
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s+via\s+.*$/i, '')
      .trim();
    if (cleaned.length > 0 && cleaned.length <= 60) return cleaned;
  }
  if (!domain) return null;
  // "coupang.com" → "coupang"; "mail.naver.com" → "naver". We strip the most
  // common public-suffix-ish tails and keep the registrable label.
  const labels = domain.split('.');
  if (labels.length === 0) return null;
  const tail = labels[labels.length - 1];
  // For two-label domains like "naver.com" we want "naver".
  let core = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  // For "co.kr" / "co.uk" style suffixes, hop one more left.
  if ((tail === 'kr' || tail === 'uk' || tail === 'jp') && labels.length >= 3 && labels[labels.length - 2] === 'co') {
    core = labels[labels.length - 3];
  }
  if (!core) return null;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function matchAny(text: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (text.includes(n)) return true;
  }
  return false;
}

/**
 * Reverse map: given a stable sender profile, pick the email category we
 * should default to when nothing else overrides it. Used by `deriveCategory`
 * to fix the historical "광고 → personal" bug.
 */
export function senderKindToCategory(
  kind: SenderKind,
): 'personal' | 'promotion' | 'newsletter' | 'transactional' | 'notification' | null {
  switch (kind) {
    case 'company':
      return 'promotion';
    case 'newsletter':
      return 'newsletter';
    case 'transactional':
      return 'transactional';
    case 'notification':
      return 'notification';
    case 'person':
      return 'personal';
    case 'unknown':
    default:
      return null;
  }
}

export { FREE_MAIL_DOMAINS };
