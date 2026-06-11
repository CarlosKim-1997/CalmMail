/** Maps billing IPC error codes to i18n keys. */
export function billingErrorMessageKey(
  raw: string,
): { key: string } | null {
  const codes: Record<string, string> = {
    CALMMAIL_BILLING_BYOK_KEYS_REQUIRED: 'billing.errors.byokKeysRequired',
    CALMMAIL_BILLING_STUB_DISABLED: 'billing.errors.stubDisabled',
    CALMMAIL_BILLING_TIER_DENIED: 'billing.errors.tierDenied',
    CALMMAIL_BILLING_INVALID_TIER: 'billing.errors.invalidTier',
    CALMMAIL_BILLING_INVALID_EXPIRY: 'billing.errors.invalidExpiry',
    CALMMAIL_STRIPE_NOT_CONFIGURED: 'billing.errors.stripeNotConfigured',
    CALMMAIL_STRIPE_GMAIL_REQUIRED: 'billing.errors.gmailRequired',
    CALMMAIL_STRIPE_NO_CUSTOMER: 'billing.errors.noCustomer',
    CALMMAIL_STRIPE_API_ERROR: 'billing.errors.apiError',
    CALMMAIL_STRIPE_CHECKOUT_FAILED: 'billing.errors.checkoutFailed',
    CALMMAIL_STRIPE_CHECKOUT_INCOMPLETE: 'billing.errors.checkoutIncomplete',
    CALMMAIL_STRIPE_PORTAL_FAILED: 'billing.errors.portalFailed',
  };
  const key = codes[raw];
  return key ? { key } : null;
}
