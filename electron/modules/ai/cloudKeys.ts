/**
 * Cloud LLM credentials.
 *
 * - **Hosted** (Free / Premium): `process.env` or legacy secureStorage — CalmMail-operated keys.
 * - **BYOK**: user keys in secureStorage only (`SecureKeys.user*`).
 */

import { preferencesMemory } from '../memory/preferences';
import { isByokFromStoredPrefs } from '@shared/monetization';
import { SecureKeys, secureStore } from '../persistence/secureStore';

function hostedOpenAi(): string | null {
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (!secureStore.isAvailable()) return null;
  return secureStore.get(SecureKeys.openaiKey);
}

function hostedAnthropic(): string | null {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (!secureStore.isAvailable()) return null;
  return secureStore.get(SecureKeys.anthropicKey);
}

function userOpenAi(): string | null {
  if (!secureStore.isAvailable()) return null;
  return secureStore.get(SecureKeys.userOpenaiKey);
}

function userAnthropic(): string | null {
  if (!secureStore.isAvailable()) return null;
  return secureStore.get(SecureKeys.userAnthropicKey);
}

export function getOpenAiApiKey(): string | null {
  const prefs = preferencesMemory.get();
  if (isByokFromStoredPrefs(prefs)) return userOpenAi();
  return hostedOpenAi();
}

export function getAnthropicApiKey(): string | null {
  const prefs = preferencesMemory.get();
  if (isByokFromStoredPrefs(prefs)) return userAnthropic();
  return hostedAnthropic();
}

/** Whether the active tier can run cloud OpenAI (hosted or BYOK key present). */
export function isOpenAiConfiguredForTier(): boolean {
  return Boolean(getOpenAiApiKey());
}

/** Whether the active tier can run cloud Anthropic (hosted or BYOK key present). */
export function isAnthropicConfiguredForTier(): boolean {
  return Boolean(getAnthropicApiKey());
}
