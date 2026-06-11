/**
 * Layer 2: Persistent Preferences.
 *
 * User-defined preferences. Only the user (via UI) and a small set of system
 * defaults can write here — the AI is *never* allowed to mutate preferences.
 */

import { newKeywordRuleId, preferencesRepo } from '@main/modules/persistence/repositories/preferencesRepo';
import { isApprovedLocalAiModelId } from '@shared/localAiPolicy';
import type {
  AiMode,
  AiProviderId,
  EmailCategory,
  KeywordMatchType,
  LocalAiAcceptedNotices,
  LocalAiPreferredRuntime,
  PriorityKeywordRule,
  UserPreferences,
} from '@shared/types';

const ALLOWED_CATEGORIES: EmailCategory[] = [
  'personal',
  'work',
  'transactional',
  'notification',
  'social',
  'newsletter',
  'promotion',
  'other',
];

export const preferencesMemory = {
  get(): UserPreferences {
    return preferencesRepo.get();
  },

  /** User-driven updates only. */
  patch(patch: Partial<UserPreferences>): UserPreferences {
    const sanitized = sanitize(patch);
    return preferencesRepo.patch(sanitized);
  },
};

function sanitize(patch: Partial<UserPreferences>): Partial<UserPreferences> {
  const out: Partial<UserPreferences> = { ...patch };

  if (out.monitoringIntervalMinutes != null) {
    out.monitoringIntervalMinutes = clamp(out.monitoringIntervalMinutes, 1, 120);
  }
  if (out.retainEmailMetadataDays != null) {
    out.retainEmailMetadataDays = clamp(out.retainEmailMetadataDays, 1, 90);
  }
  if (out.quietHours) {
    out.quietHours = {
      enabled: !!out.quietHours.enabled,
      startHour: clamp(out.quietHours.startHour, 0, 23),
      endHour: clamp(out.quietHours.endHour, 0, 23),
    };
  }
  if (out.priorityKeywords) {
    out.priorityKeywords = Array.from(
      new Set(
        out.priorityKeywords
          .map((k) => k.trim().toLowerCase())
          .filter((k) => k.length > 0 && k.length <= 40),
      ),
    ).slice(0, 50);
  }
  if (out.priorityKeywordRules) {
    out.priorityKeywordRules = sanitizeKeywordRules(out.priorityKeywordRules);
  }
  if (out.language != null) {
    out.language = out.language === 'en' ? 'en' : 'ko';
  }
  if (out.localAiPreferredRuntime != null) {
    const allowed: LocalAiPreferredRuntime[] = ['none', 'managed', 'ollama_advanced'];
    out.localAiPreferredRuntime = allowed.includes(out.localAiPreferredRuntime)
      ? out.localAiPreferredRuntime
      : 'none';
  }
  if (out.localAiModelId !== undefined) {
    out.localAiModelId = isApprovedLocalAiModelId(out.localAiModelId)
      ? out.localAiModelId
      : null;
  }
  if (out.localAiAcceptedNotices !== undefined) {
    out.localAiAcceptedNotices = sanitizeNotice(out.localAiAcceptedNotices);
  }
  // Subscription tier is billing-controlled only (Plans / billing IPC).
  delete out.subscriptionTier;
  delete out.premiumValidUntil;
  if (out.aiMode != null) {
    const allowed: AiMode[] = ['cloud', 'local', 'off'];
    out.aiMode = allowed.includes(out.aiMode) ? out.aiMode : 'off';
  }
  if (out.aiProvider != null) {
    const allowed: AiProviderId[] = ['openai', 'anthropic', 'openrouter', 'gemini', 'local'];
    out.aiProvider = allowed.includes(out.aiProvider) ? out.aiProvider : 'openai';
  }
  if (out.hardwareCheckDismissed != null) {
    out.hardwareCheckDismissed = !!out.hardwareCheckDismissed;
  }
  if (out.onboardingCompleted != null) {
    out.onboardingCompleted = !!out.onboardingCompleted;
  }
  if (out.learnedImportantCategories != null) {
    if (Array.isArray(out.learnedImportantCategories)) {
      const seen = new Set<EmailCategory>();
      const filtered: EmailCategory[] = [];
      for (const c of out.learnedImportantCategories) {
        if (ALLOWED_CATEGORIES.includes(c) && !seen.has(c)) {
          seen.add(c);
          filtered.push(c);
        }
      }
      out.learnedImportantCategories = filtered.slice(0, 8);
    } else {
      out.learnedImportantCategories = [];
    }
  }

  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sanitizeNotice(raw: unknown): LocalAiAcceptedNotices | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<LocalAiAcceptedNotices>;
  if (typeof r.policyVersion !== 'number' || !Number.isFinite(r.policyVersion)) return null;
  if (typeof r.acceptedAt !== 'number' || !Number.isFinite(r.acceptedAt) || r.acceptedAt <= 0) {
    return null;
  }
  return { policyVersion: Math.floor(r.policyVersion), acceptedAt: Math.floor(r.acceptedAt) };
}

const ALLOWED_MATCH_TYPES: readonly KeywordMatchType[] = ['contains', 'word', 'exact'] as const;
const ALLOWED_KW_LANGS = ['any', 'ko', 'en'] as const;
const ALLOWED_KW_WEIGHTS = ['low', 'medium', 'high'] as const;
const KEYWORD_RULE_CAP = 50;
const KEYWORD_PATTERN_LEN = 60;

function sanitizeKeywordRules(rules: unknown): PriorityKeywordRule[] {
  if (!Array.isArray(rules)) return [];
  const out: PriorityKeywordRule[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (out.length >= KEYWORD_RULE_CAP) break;
    if (!r || typeof r !== 'object') continue;
    const raw = r as Partial<PriorityKeywordRule>;
    const pattern = (raw.pattern ?? '').toString().trim();
    if (!pattern) continue;
    const truncated = pattern.length > KEYWORD_PATTERN_LEN
      ? pattern.slice(0, KEYWORD_PATTERN_LEN)
      : pattern;
    const matchType: KeywordMatchType = ALLOWED_MATCH_TYPES.includes(raw.matchType as KeywordMatchType)
      ? (raw.matchType as KeywordMatchType)
      : 'contains';
    const language = ALLOWED_KW_LANGS.includes(raw.language as (typeof ALLOWED_KW_LANGS)[number])
      ? (raw.language as PriorityKeywordRule['language'])
      : 'any';
    const weight = ALLOWED_KW_WEIGHTS.includes(raw.weight as (typeof ALLOWED_KW_WEIGHTS)[number])
      ? (raw.weight as PriorityKeywordRule['weight'])
      : 'medium';
    const caseSensitive = !!raw.caseSensitive;
    // Dedupe on (lowercased pattern, matchType, language, caseSensitive).
    const dedupeKey = `${truncated.toLowerCase()}|${matchType}|${language}|${caseSensitive}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : newKeywordRuleId(),
      createdAt:
        typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) && raw.createdAt > 0
          ? Math.floor(raw.createdAt)
          : 0,
      pattern: truncated,
      matchType,
      language,
      caseSensitive,
      weight,
      enabled: raw.enabled !== false,
    });
  }
  return out;
}
