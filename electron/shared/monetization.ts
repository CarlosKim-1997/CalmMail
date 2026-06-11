import type { SubscriptionTier, UserPreferences } from './types';

/**
 * CalmMail monetization: limits and copy helpers. Enforcement lives in the main
 * process; the renderer uses the same numbers for hints only.
 */
export const FREE_TIER_LIMITS = {
  /** VIP contacts are unlimited on all tiers (Gmail/Naver already do "star"; we don't gate memory input). */
  maxAwaitedWaitingThreads: 5,
  /** Free tier inbox poll floor (minutes). Premium may go lower. */
  minMonitoringIntervalMinutes: 10,
  /**
   * Daily cap on Cloud-AI briefing runs for free accounts. Resets at the
   * user's local midnight. Local AI mode is unaffected. Premium = unlimited.
   */
  maxCloudBriefingsPerDay: 2,
} as const;

/** When true, "Local AI" requires an active premium entitlement. */
export const LOCAL_AI_REQUIRES_PREMIUM = false;

export const BRIEFING_IMPORTANT_EMAIL_CAP = {
  free: 10,
  premium: 22,
} as const;

function isStoredTierActive(p: UserPreferences, tier: SubscriptionTier): boolean {
  if (p.subscriptionTier !== tier) return false;
  if (p.premiumValidUntil) {
    const until = Date.parse(p.premiumValidUntil);
    if (!Number.isNaN(until) && until < Date.now()) return false;
  }
  return true;
}

/**
 * Subscription truth from stored prefs (no dev bypass). Used when merging
 * patches before persistence.
 */
export function isPremiumFromStoredPrefs(p: UserPreferences): boolean {
  return isStoredTierActive(p, 'premium');
}

export function isByokFromStoredPrefs(p: UserPreferences): boolean {
  return isStoredTierActive(p, 'byok');
}

/** BYOK or Premium — same feature caps; cloud billing path differs. */
export function hasPaidFeaturesFromStoredPrefs(p: UserPreferences): boolean {
  return isPremiumFromStoredPrefs(p) || isByokFromStoredPrefs(p);
}

export function isLocalAiUnlocked(
  _prefs: UserPreferences,
  _hasPaidFeatures: boolean,
): boolean {
  if (!LOCAL_AI_REQUIRES_PREMIUM) return true;
  return _hasPaidFeatures;
}
