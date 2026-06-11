/**
 * calmmail://billing/* deep links (Checkout success, portal return, cancel).
 */

import { BILLING_PROTOCOL } from './billingEnv';
import { completeStripeCheckout, syncStripeSubscription } from './stripeBilling';
import type { BillingApplyResult } from '@shared/types';

export type BillingDeepLinkAction =
  | { type: 'checkout_complete'; sessionId: string }
  | { type: 'refresh' }
  | { type: 'ignore' };

export function parseBillingDeepLink(raw: string): BillingDeepLinkAction | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== `${BILLING_PROTOCOL}:`) return null;
    if (u.hostname !== 'billing') return null;

    const path = u.pathname.replace(/^\/+/, '') || u.host;
    if (path === 'success') {
      const sessionId = u.searchParams.get('session_id')?.trim();
      if (sessionId) return { type: 'checkout_complete', sessionId };
      return { type: 'refresh' };
    }
    if (path === 'portal-return' || path === 'cancel') {
      return { type: 'refresh' };
    }
    return { type: 'ignore' };
  } catch {
    return null;
  }
}

export async function handleBillingDeepLink(raw: string): Promise<BillingApplyResult | null> {
  const action = parseBillingDeepLink(raw);
  if (!action || action.type === 'ignore') return null;
  if (action.type === 'checkout_complete') {
    return completeStripeCheckout(action.sessionId);
  }
  return syncStripeSubscription();
}
