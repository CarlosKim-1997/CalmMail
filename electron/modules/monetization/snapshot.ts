import type { MonetizationSnapshot, SubscriptionTier, UserPreferences } from '@shared/types';
import {
  BRIEFING_IMPORTANT_EMAIL_CAP,
  FREE_TIER_LIMITS,
  hasPaidFeaturesFromStoredPrefs,
  isByokFromStoredPrefs,
  isPremiumFromStoredPrefs,
  LOCAL_AI_REQUIRES_PREMIUM,
} from '@shared/monetization';
import { checkoutUrl, isBillingStubEnabled, isStripeConfigured } from './billingEnv';
import { getStripeCustomerId } from './stripeCustomerStore';

export function isDevPremiumBypass(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CALMMAIL_DEV_PREMIUM === '1';
}

export function getEffectiveTier(
  prefs: UserPreferences,
  env: NodeJS.ProcessEnv = process.env,
): SubscriptionTier {
  if (isDevPremiumBypass(env)) return 'premium';
  if (isPremiumFromStoredPrefs(prefs)) return 'premium';
  if (isByokFromStoredPrefs(prefs)) return 'byok';
  return 'free';
}

/** Paid feature entitlement (BYOK, Premium, or dev bypass). */
export function hasPaidFeatures(prefs: UserPreferences, env = process.env): boolean {
  if (isDevPremiumBypass(env)) return true;
  return hasPaidFeaturesFromStoredPrefs(prefs);
}

/** @deprecated Use `hasPaidFeatures`. */
export function isEffectivePremium(prefs: UserPreferences, env = process.env): boolean {
  return hasPaidFeatures(prefs, env);
}

export function buildMonetizationSnapshot(prefs: UserPreferences): MonetizationSnapshot {
  const effectiveTier = getEffectiveTier(prefs);
  const paid = hasPaidFeatures(prefs);
  return {
    effectiveTier,
    hasPaidFeatures: paid,
    effectivePremium: paid,
    showSponsorSlots: !paid,
    freeMaxAwaitedWaitingThreads: FREE_TIER_LIMITS.maxAwaitedWaitingThreads,
    freeMinMonitoringIntervalMinutes: FREE_TIER_LIMITS.minMonitoringIntervalMinutes,
    freeMaxCloudBriefingsPerDay: FREE_TIER_LIMITS.maxCloudBriefingsPerDay,
    freeBriefingImportantCap: BRIEFING_IMPORTANT_EMAIL_CAP.free,
    premiumBriefingImportantCap: BRIEFING_IMPORTANT_EMAIL_CAP.premium,
    devPremiumBypass: isDevPremiumBypass(),
    localAiRequiresPremiumBuildFlag: LOCAL_AI_REQUIRES_PREMIUM,
    billingStubEnabled: isBillingStubEnabled(),
    checkoutUrlConfigured: Boolean(checkoutUrl()),
    stripeConfigured: isStripeConfigured(),
    stripeCustomerLinked: Boolean(getStripeCustomerId()),
  };
}

export function effectiveMonitoringIntervalMinutes(prefs: UserPreferences, env = process.env): number {
  const base = Math.max(1, prefs.monitoringIntervalMinutes);
  if (hasPaidFeatures(prefs, env)) return base;
  return Math.max(base, FREE_TIER_LIMITS.minMonitoringIntervalMinutes);
}
