import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { FREE_TIER_LIMITS, hasPaidFeaturesFromStoredPrefs } from '@shared/monetization';
import { reconcileExpiredSubscription } from '@main/modules/monetization/billing';
import { isApprovedLocalAiModelId } from '@shared/localAiPolicy';
import type {
  LocalAiAcceptedNotices,
  LocalAiPreferredRuntime,
  PriorityKeywordRule,
  UserPreferences,
} from '@shared/types';

const KEY = 'user.preferences.v1';

/** Generates a short, low-collision id for a keyword rule (renderer-stable). */
export function newKeywordRuleId(): string {
  return 'kw_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Bilingual baseline that ships when a fresh install has zero rules AND no
 * legacy keywords to migrate. Latin words use word-boundary matching; the
 * Korean ones use `contains` because CJK characters aren't covered by `\W`.
 */
function freshDefaultKeywordRules(): PriorityKeywordRule[] {
  const now = Date.now();
  return [
    { id: newKeywordRuleId(), createdAt: now, pattern: 'urgent', matchType: 'word', language: 'en', caseSensitive: false, weight: 'high', enabled: true },
    { id: newKeywordRuleId(), createdAt: now, pattern: 'asap', matchType: 'word', language: 'en', caseSensitive: false, weight: 'high', enabled: true },
    { id: newKeywordRuleId(), createdAt: now, pattern: 'deadline', matchType: 'word', language: 'en', caseSensitive: false, weight: 'medium', enabled: true },
    { id: newKeywordRuleId(), createdAt: now, pattern: '긴급', matchType: 'contains', language: 'ko', caseSensitive: false, weight: 'high', enabled: true },
    { id: newKeywordRuleId(), createdAt: now, pattern: '마감', matchType: 'contains', language: 'ko', caseSensitive: false, weight: 'medium', enabled: true },
  ];
}

export const DEFAULT_PREFS: UserPreferences = {
  quietHours: { enabled: true, startHour: 22, endHour: 8 },
  notificationSensitivity: 'balanced',
  priorityKeywords: [],
  priorityKeywordRules: [],
  aiMode: 'cloud',
  aiProvider: 'openai',
  monitoringIntervalMinutes: 10,
  retainEmailMetadataDays: 14,
  language: 'ko',
  learnedImportantCategories: [],
  localAiPreferredRuntime: 'none',
  localAiModelId: null,
  localAiAcceptedNotices: null,
  hardwareCheckDismissed: false,
  onboardingCompleted: false,
  triageWindowDays: 7,
  triageCollapseLater: false,
  triageGmailMarkReadEnabled: false,
  subscriptionTier: 'free',
  premiumValidUntil: null,
};

/**
 * Apache-2.0 transition (Phase 1): coerce the historical literals
 * `'ollama'` / `'llamacpp'` into the new lane values. Anything else
 * collapses to `'none'`. Returns `null` when no change is needed so the
 * caller can flip `dirty` only on real migrations.
 */
function migrateLocalAiRuntime(
  raw: unknown,
): LocalAiPreferredRuntime | null {
  if (raw === 'managed' || raw === 'ollama_advanced' || raw === 'none') return null;
  if (raw === 'llamacpp') return 'managed';
  if (raw === 'ollama') return 'ollama_advanced';
  return 'none';
}

function sanitizeStoredNotice(raw: unknown): LocalAiAcceptedNotices | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<LocalAiAcceptedNotices>;
  if (typeof r.policyVersion !== 'number' || !Number.isFinite(r.policyVersion)) return null;
  if (typeof r.acceptedAt !== 'number' || !Number.isFinite(r.acceptedAt) || r.acceptedAt <= 0) return null;
  return { policyVersion: Math.floor(r.policyVersion), acceptedAt: Math.floor(r.acceptedAt) };
}

function normalizeMerged(merged: UserPreferences): { prefs: UserPreferences; dirty: boolean } {
  let dirty = false;
  const next = { ...merged };
  const tierOk =
    next.subscriptionTier === 'free' ||
    next.subscriptionTier === 'byok' ||
    next.subscriptionTier === 'premium';
  if (!tierOk) {
    next.subscriptionTier = 'free';
    dirty = true;
  }
  if (next.premiumValidUntil != null && typeof next.premiumValidUntil !== 'string') {
    next.premiumValidUntil = null;
    dirty = true;
  }
  if (!hasPaidFeaturesFromStoredPrefs(next)) {
    const min = FREE_TIER_LIMITS.minMonitoringIntervalMinutes;
    if (next.monitoringIntervalMinutes < min) {
      next.monitoringIntervalMinutes = min;
      dirty = true;
    }
  }

  // Priority keyword migration. Three cases, in order:
  //   (a) malformed/missing rules array → reset to []
  //   (b) rules empty + legacy keywords present → migrate one-for-one
  //   (c) rules empty + no legacy keywords → seed bilingual defaults
  if (!Array.isArray(next.priorityKeywordRules)) {
    next.priorityKeywordRules = [];
    dirty = true;
  }
  if (next.priorityKeywordRules.length === 0) {
    const legacy = Array.isArray(next.priorityKeywords) ? next.priorityKeywords : [];
    if (legacy.length > 0) {
      const seen = new Set<string>();
      const migrated: PriorityKeywordRule[] = [];
      for (const raw of legacy) {
        const pattern = (raw ?? '').trim();
        const key = pattern.toLowerCase();
        if (!pattern || seen.has(key)) continue;
        seen.add(key);
        migrated.push({
          id: newKeywordRuleId(),
          createdAt: Date.now(),
          pattern,
          matchType: 'contains',
          language: 'any',
          caseSensitive: false,
          weight: 'medium',
          enabled: true,
        });
      }
      next.priorityKeywordRules = migrated;
    } else {
      next.priorityKeywordRules = freshDefaultKeywordRules();
    }
    dirty = true;
  }
  if (Array.isArray(next.priorityKeywords) && next.priorityKeywords.length > 0) {
    // Legacy field is now redundant; clear so the UI doesn't show ghost rules.
    next.priorityKeywords = [];
    dirty = true;
  }
  // Apache-2.0 transition (policy v1): migrate legacy runtime values and
  // validate the new model / notice-acceptance fields. The check runs on
  // every read so it converges to a clean state even if an older build
  // wrote a value back.
  const migratedRuntime = migrateLocalAiRuntime(next.localAiPreferredRuntime);
  if (migratedRuntime !== null) {
    next.localAiPreferredRuntime = migratedRuntime;
    dirty = true;
  }
  // Local AI mode with no lane selected → default to the standard managed path.
  if (next.aiMode === 'local' && next.localAiPreferredRuntime === 'none') {
    next.localAiPreferredRuntime = 'managed';
    dirty = true;
  }
  if (next.localAiModelId !== null && !isApprovedLocalAiModelId(next.localAiModelId)) {
    next.localAiModelId = null;
    dirty = true;
  }
  const cleanNotice = sanitizeStoredNotice(next.localAiAcceptedNotices);
  if (cleanNotice === null && next.localAiAcceptedNotices !== null) {
    next.localAiAcceptedNotices = null;
    dirty = true;
  } else if (cleanNotice !== null && next.localAiAcceptedNotices !== cleanNotice) {
    next.localAiAcceptedNotices = cleanNotice;
  }

  if (!next.onboardingCompleted && next.aiMode === 'off') {
    next.aiMode = 'cloud';
    dirty = true;
  }
  if (next.onboardingCompleted == null) {
    next.onboardingCompleted = false;
    dirty = true;
  }
  if (next.triageWindowDays !== 7 && next.triageWindowDays !== 14) {
    next.triageWindowDays = 7;
    dirty = true;
  }
  if (typeof next.triageCollapseLater !== 'boolean') {
    next.triageCollapseLater = false;
    dirty = true;
  }
  if (typeof next.triageGmailMarkReadEnabled !== 'boolean') {
    next.triageGmailMarkReadEnabled = false;
    dirty = true;
  }
  if (next.aiMode === 'local' && next.triageWindowDays === 14) {
    next.triageWindowDays = 7;
    dirty = true;
  }
  // Existing installs that already finished setup before this flag existed.
  if (
    !next.onboardingCompleted &&
    (next.hardwareCheckDismissed || next.localAiPreferredRuntime !== 'none')
  ) {
    next.onboardingCompleted = true;
    dirty = true;
  }
  return { prefs: next, dirty };
}

function persist(db: Database.Database, prefs: UserPreferences): void {
  db.prepare(
    `INSERT INTO preferences (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY, JSON.stringify(prefs));
}

function readRow(db: Database.Database): UserPreferences {
  const row = db
    .prepare<[string], { value: string } | undefined>(
      'SELECT value FROM preferences WHERE key = ?',
    )
    .get(KEY);

  if (!row) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(row.value) as Partial<UserPreferences>;
    const merged: UserPreferences = { ...DEFAULT_PREFS, ...parsed };
    let { prefs, dirty } = normalizeMerged(merged);
    const expired = reconcileExpiredSubscription(prefs);
    if (expired.changed) {
      prefs = expired.prefs;
      dirty = true;
    }
    if (parsed.onboardingCompleted === undefined && !prefs.onboardingCompleted) {
      prefs = { ...prefs, onboardingCompleted: true };
      dirty = true;
    }
    if (dirty) persist(db, prefs);
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const preferencesRepo = {
  get(): UserPreferences {
    return readRow(getDb());
  },

  patch(patch: Partial<UserPreferences>): UserPreferences {
    const db = getDb();
    const current = readRow(db);
    const merged: UserPreferences = { ...current, ...patch };
    const { prefs } = normalizeMerged(merged);
    persist(db, prefs);
    return prefs;
  },
};
