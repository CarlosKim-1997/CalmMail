/** Env flags for billing stub / checkout / Stripe (no imports from snapshot). */

export const BILLING_PROTOCOL = 'calmmail';

export function isBillingStubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CALMMAIL_BILLING_STUB === '1';
}

export function checkoutUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.CALMMAIL_CHECKOUT_URL?.trim();
  return url || null;
}

export function stripeSecretKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.STRIPE_SECRET_KEY?.trim();
  return key || null;
}

export function stripePremiumPriceId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env.STRIPE_PRICE_ID_PREMIUM?.trim();
  return id || null;
}

/** Checkout + Customer Portal via Stripe API (operator .env, not end-user). */
export function isStripeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(stripeSecretKey(env) && stripePremiumPriceId(env));
}

export function stripeWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.STRIPE_WEBHOOK_SECRET?.trim();
  return s || null;
}

export function billingDeepLink(path: string, query?: Record<string, string>): string {
  const u = new URL(`${BILLING_PROTOCOL}://billing/${path.replace(/^\//, '')}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  }
  return u.toString();
}
