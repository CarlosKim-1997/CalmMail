/**
 * Stripe Checkout → Premium entitlement sync.
 *
 * Flow:
 *   1. billingStartCheckout creates a Session (success_url = calmmail://billing/success?session_id=…)
 *   2. Deep link completes checkout → retrieve session → cache customer id → apply Premium
 *   3. billingRefresh / portal return re-lists subscriptions and updates tier
 *
 * Webhooks: call `applyStripeSubscriptionObject` from your backend or dev forwarder.
 */

import { getStoredTokens } from '@main/modules/gmail/auth';
import { getStripeCustomerId, setStripeCustomerId } from './stripeCustomerStore';
import { preferencesRepo } from '@main/modules/persistence/repositories/preferencesRepo';
import { applyBillingEntitlement, BillingError } from './billing';
import type { BillingApplyResult, BillingStatus, UserPreferences } from '@shared/types';
import {
  billingDeepLink,
  isStripeConfigured,
  stripePremiumPriceId,
} from './billingEnv';
import {
  createCheckoutSession,
  createPortalSession,
  listActiveSubscriptions,
  retrieveCheckoutSession,
  subscriptionIsPremiumActive,
  subscriptionPeriodEndIso,
} from './stripeApi';
import { buildMonetizationSnapshot } from './snapshot';

function billingResult(prefs: UserPreferences): BillingApplyResult {
  return {
    preferences: prefs,
    monetization: buildMonetizationSnapshot(prefs),
  };
}

function gmailEmailForCheckout(): string {
  const email = getStoredTokens()?.user_email?.trim();
  if (!email) throw new BillingError('CALMMAIL_STRIPE_GMAIL_REQUIRED');
  return email;
}

export type CheckoutStartResult = {
  ok: true;
  url: string;
  source: 'stripe' | 'static' | 'info';
};

/** Stripe session, static Payment Link, or marketing URL. */
export async function startPremiumCheckout(env = process.env): Promise<CheckoutStartResult> {
  if (isStripeConfigured(env)) {
    const priceId = stripePremiumPriceId(env)!;
    const email = gmailEmailForCheckout();
    const { url } = await createCheckoutSession({
      priceId,
      customerEmail: email,
      clientReferenceId: email,
      successUrl: billingDeepLink('success', { session_id: '{CHECKOUT_SESSION_ID}' }),
      cancelUrl: billingDeepLink('cancel'),
    });
    return { ok: true, url, source: 'stripe' };
  }
  const staticUrl =
    env.CALMMAIL_CHECKOUT_URL?.trim() ||
    env.CALMMAIL_PREMIUM_INFO_URL?.trim() ||
    'https://calmmail.app/premium';
  const source = env.CALMMAIL_CHECKOUT_URL?.trim() ? 'static' : 'info';
  return { ok: true, url: staticUrl, source };
}

export async function startCustomerPortal(): Promise<{ url: string }> {
  const customerId = getStripeCustomerId();
  if (!customerId) throw new BillingError('CALMMAIL_STRIPE_NO_CUSTOMER');
  return createPortalSession({
    customerId,
    returnUrl: billingDeepLink('portal-return'),
  });
}

function entitlementFromSubscription(sub: Record<string, unknown>): BillingApplyResult {
  const periodEnd = subscriptionPeriodEndIso(sub);
  if (!subscriptionIsPremiumActive(sub)) {
    return applyBillingEntitlement({ tier: 'free' });
  }
  return applyBillingEntitlement({
    tier: 'premium',
    premiumValidUntil: periodEnd,
  });
}

/** After Checkout success deep link or manual session id. */
export async function completeStripeCheckout(sessionId: string): Promise<BillingApplyResult> {
  if (!isStripeConfigured()) throw new BillingError('CALMMAIL_STRIPE_NOT_CONFIGURED');
  const session = await retrieveCheckoutSession(sessionId);
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : typeof session.customer === 'object' && session.customer && 'id' in session.customer
        ? String((session.customer as { id: string }).id)
        : null;
  if (customerId) setStripeCustomerId(customerId);

  const sub = session.subscription;
  if (sub && typeof sub === 'object') {
    return entitlementFromSubscription(sub as Record<string, unknown>);
  }
  if (customerId) return syncStripeSubscription();
  throw new BillingError('CALMMAIL_STRIPE_CHECKOUT_INCOMPLETE');
}

/** Pull active subscription for cached customer id. Skips BYOK tier. */
export async function syncStripeSubscription(): Promise<BillingApplyResult> {
  const prefs = preferencesRepo.get();
  if (prefs.subscriptionTier === 'byok') return billingResult(prefs);
  if (!isStripeConfigured()) return billingResult(prefs);

  const customerId = getStripeCustomerId();
  if (!customerId) return billingResult(prefs);

  const subs = await listActiveSubscriptions(customerId);
  const active = subs.find((s) => subscriptionIsPremiumActive(s));
  if (active) return entitlementFromSubscription(active);

  if (prefs.subscriptionTier === 'premium') {
    return applyBillingEntitlement({ tier: 'free' });
  }
  return billingResult(prefs);
}

/** Webhook / CLI forwarder entry (customer.subscription.*). */
export function applyStripeSubscriptionObject(
  sub: Record<string, unknown>,
): BillingApplyResult {
  const customerId =
    typeof sub.customer === 'string'
      ? sub.customer
      : typeof sub.customer === 'object' && sub.customer && 'id' in sub.customer
        ? String((sub.customer as { id: string }).id)
        : null;
  if (customerId) setStripeCustomerId(customerId);

  const prefs = preferencesRepo.get();
  if (prefs.subscriptionTier === 'byok') return billingResult(prefs);
  return entitlementFromSubscription(sub);
}

export function stripeBillingFlags(prefs: UserPreferences, env = process.env) {
  return {
    stripeConfigured: isStripeConfigured(env),
    stripeCustomerLinked: Boolean(getStripeCustomerId()),
    stripeSubscriptionActive:
      prefs.subscriptionTier === 'premium' && isStripeConfigured(env),
  };
}

export function extendBillingStatus(
  base: BillingStatus,
  prefs: UserPreferences,
  env = process.env,
): BillingStatus {
  const flags = stripeBillingFlags(prefs, env);
  return {
    ...base,
    ...flags,
    stripeSubscriptionStatus: flags.stripeSubscriptionActive ? 'active' : 'none',
  };
}
