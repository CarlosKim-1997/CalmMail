/**
 * Billing / subscription cache (Phase 6 stub).
 *
 * Single write path for `subscriptionTier` and `premiumValidUntil`.
 * Real Stripe (or similar) webhooks will call the same `applyBillingEntitlement`
 * entry point later.
 */

import { preferencesRepo } from '@main/modules/persistence/repositories/preferencesRepo';
import { buildMonetizationSnapshot } from './snapshot';
import { checkoutUrl, isBillingStubEnabled, isStripeConfigured } from './billingEnv';
import { extendBillingStatus, syncStripeSubscription } from './stripeBilling';
import type { BillingApplyResult, BillingStatus, SubscriptionTier, UserPreferences } from '@shared/types';

export { checkoutUrl, isBillingStubEnabled } from './billingEnv';

export class BillingError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BillingError';
  }
}

/** Downgrade when `premiumValidUntil` is in the past. */
export function reconcileExpiredSubscription(
  prefs: UserPreferences,
): { prefs: UserPreferences; changed: boolean } {
  if (!prefs.premiumValidUntil) return { prefs, changed: false };
  const until = Date.parse(prefs.premiumValidUntil);
  if (Number.isNaN(until) || until >= Date.now()) return { prefs, changed: false };

  const next: UserPreferences = {
    ...prefs,
    subscriptionTier: 'free',
    premiumValidUntil: null,
  };
  return { prefs: next, changed: true };
}

/** Reconcile local expiry only (fast path). */
export function refreshBillingCache(): UserPreferences {
  const current = preferencesRepo.get();
  const { prefs, changed } = reconcileExpiredSubscription(current);
  if (changed) return preferencesRepo.patch(prefs);
  return current;
}

/** Expiry + Stripe subscription sync when configured. */
export async function refreshBillingFull(): Promise<BillingApplyResult> {
  const prefs = refreshBillingCache();
  if (!isStripeConfigured()) return result(prefs);
  try {
    return await syncStripeSubscription();
  } catch (e) {
    if (e instanceof BillingError && e.code === 'CALMMAIL_STRIPE_NOT_CONFIGURED') {
      return result(prefs);
    }
    throw e;
  }
}

function result(prefs: UserPreferences): BillingApplyResult {
  return {
    preferences: prefs,
    monetization: buildMonetizationSnapshot(prefs),
  };
}

function assertTier(tier: string): SubscriptionTier {
  if (tier === 'free' || tier === 'byok' || tier === 'premium') return tier;
  throw new BillingError('CALMMAIL_BILLING_INVALID_TIER');
}

function parseValidUntil(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) throw new BillingError('CALMMAIL_BILLING_INVALID_EXPIRY');
  return raw;
}

/** Plans UI: Free or BYOK (My API). Keys are connected later in AI settings. */
export function applyPlansTier(tier: 'free' | 'byok'): BillingApplyResult {
  if (tier === 'byok') {
    const prefs = preferencesRepo.patch({
      subscriptionTier: 'byok',
      premiumValidUntil: null,
      aiMode: 'cloud',
    });
    return result(prefs);
  }

  const prefs = preferencesRepo.patch({
    subscriptionTier: 'free',
    premiumValidUntil: null,
  });
  return result(prefs);
}

/**
 * Payment provider / dev stub: Premium activation or cancellation.
 * BYOK (My API) is never granted through billing — users connect keys in AI settings.
 */
export function applyBillingEntitlement(req: {
  tier: 'premium' | 'free';
  premiumValidUntil?: string | null;
}): BillingApplyResult {
  const tier = assertTier(req.tier);
  if (tier !== 'premium' && tier !== 'free') {
    throw new BillingError('CALMMAIL_BILLING_TIER_DENIED');
  }

  if (tier === 'premium') {
    const prefs = preferencesRepo.patch({
      subscriptionTier: 'premium',
      premiumValidUntil: parseValidUntil(req.premiumValidUntil),
      aiMode: 'cloud',
    });
    return result(prefs);
  }

  const prefs = preferencesRepo.patch({
    subscriptionTier: 'free',
    premiumValidUntil: null,
  });
  return result(prefs);
}

/** Dev/QA stub — gated by `CALMMAIL_BILLING_STUB=1`. */
export function applyBillingStub(req: {
  tier: 'premium' | 'free';
  premiumValidUntil?: string | null;
}): BillingApplyResult {
  if (!isBillingStubEnabled()) {
    throw new BillingError('CALMMAIL_BILLING_STUB_DISABLED');
  }
  return applyBillingEntitlement(req);
}

export function buildBillingStatus(prefs: UserPreferences, env = process.env): BillingStatus {
  const monetization = buildMonetizationSnapshot(prefs);
  const base: BillingStatus = {
    storedTier: prefs.subscriptionTier,
    premiumValidUntil: prefs.premiumValidUntil,
    effectiveTier: monetization.effectiveTier,
    hasPaidFeatures: monetization.hasPaidFeatures,
    billingStubEnabled: isBillingStubEnabled(env),
    checkoutUrlConfigured: Boolean(checkoutUrl(env)),
    stripeConfigured: monetization.stripeConfigured,
    stripeCustomerLinked: monetization.stripeCustomerLinked,
    stripeSubscriptionStatus: 'none',
  };
  return extendBillingStatus(base, prefs, env);
}
