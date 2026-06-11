/**
 * Minimal Stripe REST client (fetch). Secret key lives in operator .env only.
 */

import { BillingError } from './billing';
import { stripeSecretKey } from './billingEnv';

type StripeRecord = Record<string, unknown>;

function secret(): string {
  const key = stripeSecretKey();
  if (!key) throw new BillingError('CALMMAIL_STRIPE_NOT_CONFIGURED');
  return key;
}

async function stripeRequest(
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, string>,
): Promise<StripeRecord> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret()}`,
  };
  let url = `https://api.stripe.com/v1${path}`;
  let body: string | undefined;
  if (method === 'POST' && params) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(params).toString();
  } else if (method === 'GET' && params) {
    url += `?${new URLSearchParams(params).toString()}`;
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json: StripeRecord;
  try {
    json = JSON.parse(text) as StripeRecord;
  } catch {
    throw new BillingError('CALMMAIL_STRIPE_API_ERROR', text.slice(0, 200));
  }
  if (!res.ok) {
    const msg =
      typeof json.error === 'object' && json.error && 'message' in (json.error as object)
        ? String((json.error as { message?: string }).message)
        : text.slice(0, 200);
    throw new BillingError('CALMMAIL_STRIPE_API_ERROR', msg);
  }
  return json;
}

export async function createCheckoutSession(params: {
  priceId: string;
  customerEmail: string;
  clientReferenceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const data = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': params.priceId,
    'line_items[0][quantity]': '1',
    customer_email: params.customerEmail,
    client_reference_id: params.clientReferenceId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  const id = String(data.id ?? '');
  const url = String(data.url ?? '');
  if (!id || !url) throw new BillingError('CALMMAIL_STRIPE_CHECKOUT_FAILED');
  return { id, url };
}

export async function retrieveCheckoutSession(
  sessionId: string,
): Promise<StripeRecord> {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    'expand[]': 'subscription',
  });
}

export async function createPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const data = await stripeRequest('POST', '/billing_portal/sessions', {
    customer: params.customerId,
    return_url: params.returnUrl,
  });
  const url = String(data.url ?? '');
  if (!url) throw new BillingError('CALMMAIL_STRIPE_PORTAL_FAILED');
  return { url };
}

export async function listActiveSubscriptions(
  customerId: string,
): Promise<StripeRecord[]> {
  const data = await stripeRequest('GET', '/subscriptions', {
    customer: customerId,
    status: 'all',
    limit: '10',
  });
  const rows = data.data;
  return Array.isArray(rows) ? (rows as StripeRecord[]) : [];
}

export function subscriptionPeriodEndIso(sub: StripeRecord): string | null {
  const end = sub.current_period_end;
  if (typeof end !== 'number' || !Number.isFinite(end)) return null;
  return new Date(end * 1000).toISOString();
}

export function subscriptionIsPremiumActive(sub: StripeRecord): boolean {
  const status = String(sub.status ?? '');
  return status === 'active' || status === 'trialing' || status === 'past_due';
}
