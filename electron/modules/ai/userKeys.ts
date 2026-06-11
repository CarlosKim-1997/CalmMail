/**
 * BYOK user API keys — stored encrypted; never returned to the renderer.
 */

import type { AiProviderId } from '@shared/types';
import { SecureKeys, secureStore } from '../persistence/secureStore';

export type ByokProviderId = 'openai' | 'anthropic';

const KEY_BY_PROVIDER: Record<ByokProviderId, string> = {
  openai: SecureKeys.userOpenaiKey,
  anthropic: SecureKeys.userAnthropicKey,
};

export function byokKeyConfigured(provider: ByokProviderId): boolean {
  if (!secureStore.isAvailable()) return false;
  const v = secureStore.get(KEY_BY_PROVIDER[provider]);
  return Boolean(v?.trim());
}

export function byokKeysStatus(): Record<ByokProviderId, boolean> {
  return {
    openai: byokKeyConfigured('openai'),
    anthropic: byokKeyConfigured('anthropic'),
  };
}

export function setByokApiKey(provider: ByokProviderId, apiKey: string | null): void {
  const slot = KEY_BY_PROVIDER[provider];
  const trimmed = apiKey?.trim() ?? '';
  if (!trimmed) {
    secureStore.delete(slot);
    return;
  }
  secureStore.set(slot, trimmed);
}

export function aiProviderIdToByok(provider: AiProviderId): ByokProviderId | null {
  if (provider === 'openai' || provider === 'anthropic') return provider;
  return null;
}
