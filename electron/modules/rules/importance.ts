/**
 * Importance scoring for incoming email metadata.
 *
 * This is deliberately *deterministic*: no AI is involved here. The whole
 * point is that 99% of emails are classified by lightweight rules so the AI
 * (which is expensive and intrusive) never has to look at most messages.
 */

import type {
  ContactMemory,
  EmailCategory,
  EmailSummary,
  ImportanceReason,
  NotificationPriority,
  PriorityKeywordRule,
  UserPreferences,
} from '@shared/types';
import { isLowSignalCategory } from './categorize';

export interface ScoringContext {
  preferences: UserPreferences;
  contactByEmail: (email: string) => ContactMemory | null;
  awaitedThreadIds: Set<string>;
  userPrimaryEmail: string | null;
}

export interface ScoringResult {
  score: number;            // 0..100
  priority: NotificationPriority;
  reasons: ImportanceReason[];
}

export function scoreEmail(
  email: Omit<EmailSummary, 'importanceScore' | 'priority' | 'reasons'>,
  ctx: ScoringContext,
): ScoringResult {
  let score = 0;
  const reasons: ImportanceReason[] = [];
  const senderEmail = email.from.email.toLowerCase();
  const senderMemory = ctx.contactByEmail(senderEmail);
  const category: EmailCategory = email.category;
  const isLowSignal = isLowSignalCategory(category);

  // 1) VIP sender
  if (senderMemory?.isVip) {
    score += 50;
    reasons.push({ kind: 'vip_sender', contact: senderEmail });
  }

  // 2) Awaited reply for this thread
  if (ctx.awaitedThreadIds.has(email.threadId)) {
    score += 40;
    reasons.push({ kind: 'awaited_reply', threadId: email.threadId });
  }

  // 3) Priority keyword rules (subject + snippet). Bonuses are weighted and
  // capped so a flurry of rules can't push every email to HIGH.
  const haystackRaw = `${email.subject}\n${email.snippet}`;
  const rules = ctx.preferences.priorityKeywordRules ?? [];
  const matchedKeywords = new Set<string>();
  let keywordBonus = 0;
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;
    if (!ruleAppliesToLanguage(rule, haystackRaw)) continue;
    if (!ruleMatches(rule, haystackRaw)) continue;
    keywordBonus += KEYWORD_WEIGHT[rule.weight] ?? 8;
    matchedKeywords.add(rule.pattern);
  }
  if (keywordBonus > 0) {
    score += Math.min(keywordBonus, KEYWORD_BONUS_CAP);
    for (const kw of matchedKeywords) {
      reasons.push({ kind: 'priority_keyword', keyword: kw });
    }
  }

  // 4) Directly addressed to the user (not a list)
  if (ctx.userPrimaryEmail) {
    const toEmails = email.to.map((a) => a.email.toLowerCase());
    if (toEmails.length <= 2 && toEmails.includes(ctx.userPrimaryEmail.toLowerCase())) {
      score += 6;
      reasons.push({ kind: 'direct_to_user' });
    }
  }

  // 5) Frequent correspondent based on existing importance memory
  if (senderMemory && senderMemory.importance >= 40) {
    score += Math.min(20, Math.floor(senderMemory.importance / 4));
    reasons.push({ kind: 'frequent_correspondent', contact: senderEmail });
  }

  // 6) Unknown first contact: small dampener / never spike to HIGH
  let firstContactDampen = 0;
  if (!senderMemory) {
    firstContactDampen = 1;
    reasons.push({ kind: 'first_contact_unknown' });
  }

  // Promotions / social / newsletters are demoted: even if a priority keyword
  // matched, marketing should not earn a notification or top-of-briefing slot.
  // VIPs are the only escape hatch (handled before this clamp).
  if (isLowSignal && !senderMemory?.isVip) {
    score = Math.min(score, 25);
  }

  score = Math.max(0, Math.min(100, score));

  // Sensitivity modulates thresholds, not the score itself.
  const thresholds = thresholdsFor(ctx.preferences.notificationSensitivity);
  let priority: NotificationPriority = 'LOW';
  if (score >= thresholds.high && !firstContactDampen) {
    priority = 'HIGH';
  } else if (score >= thresholds.medium) {
    priority = 'MEDIUM';
  }

  // Hard floor for low-signal mail when the user has not VIP'd the sender.
  if (isLowSignal && !senderMemory?.isVip) {
    priority = 'LOW';
  }

  return { score, priority, reasons };
}

function thresholdsFor(sens: UserPreferences['notificationSensitivity']): {
  high: number;
  medium: number;
} {
  switch (sens) {
    case 'minimal':
      return { high: 80, medium: 55 };
    case 'strict':
      return { high: 55, medium: 30 };
    case 'balanced':
    default:
      return { high: 65, medium: 40 };
  }
}

const KEYWORD_WEIGHT: Record<PriorityKeywordRule['weight'], number> = {
  low: 4,
  medium: 8,
  high: 14,
};

/** Hard cap on the cumulative bonus from all matching keyword rules. */
const KEYWORD_BONUS_CAP = 30;

/** Hangul block. Used for soft language gating, not for matching. */
const HANGUL_RE = /[\u3131-\uD79D]/;
const LATIN_RE = /[A-Za-z]/;

/**
 * Soft language gate: a rule tagged `ko` only applies when the haystack has
 * any Hangul; `en` only when it has any Latin letter. This avoids matching a
 * Korean-only newsletter against an English keyword that happens to be a
 * substring (and vice versa). `any` matches everything.
 */
function ruleAppliesToLanguage(rule: PriorityKeywordRule, text: string): boolean {
  if (rule.language === 'any') return true;
  if (rule.language === 'ko') return HANGUL_RE.test(text);
  if (rule.language === 'en') return LATIN_RE.test(text);
  return true;
}

function ruleMatches(rule: PriorityKeywordRule, text: string): boolean {
  // Product rule: English keywords should match case-insensitively even when
  // users don't touch advanced options.
  const forceCaseInsensitiveForEnglish = /[A-Za-z]/.test(rule.pattern);
  const caseSensitive =
    forceCaseInsensitiveForEnglish ? false : rule.caseSensitive;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? rule.pattern : rule.pattern.toLowerCase();

  switch (rule.matchType) {
    case 'exact':
      return haystack.trim() === needle;
    case 'word': {
      // Word-boundary match. Note: \W treats CJK chars as boundaries, so this
      // won't reliably split Hangul-internal substrings — Korean users should
      // pick `contains` for those cases.
      try {
        const re = new RegExp(
          `(?:^|\\W)${escapeRegex(needle)}(?:\\W|$)`,
          caseSensitive ? '' : 'i',
        );
        return re.test(text);
      } catch {
        return haystack.includes(needle);
      }
    }
    case 'contains':
    default:
      return haystack.includes(needle);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
