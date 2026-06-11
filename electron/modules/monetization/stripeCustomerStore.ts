import { SecureKeys, secureStore } from '@main/modules/persistence/secureStore';

export function getStripeCustomerId(): string | null {
  if (!secureStore.isAvailable()) return null;
  return secureStore.get(SecureKeys.stripeCustomerId);
}

export function setStripeCustomerId(customerId: string): void {
  secureStore.set(SecureKeys.stripeCustomerId, customerId);
}

export function clearStripeCustomerId(): void {
  secureStore.delete(SecureKeys.stripeCustomerId);
}
