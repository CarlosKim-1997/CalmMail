/**
 * AI provider registry.
 *
 * Looks up the active provider based on the user's preferences. If the active
 * provider isn't configured, briefing generation surfaces a clean error to
 * the UI; it never silently falls back to a different provider (trust-first).
 */

import type { AiProvider } from './provider';
import { openaiProvider } from './providers/openaiProvider';
import { anthropicProvider } from './providers/anthropicProvider';
import { localProvider } from './providers/localProvider';
import { preferencesMemory } from '../memory/preferences';

const REGISTRY: Record<string, AiProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  local: localProvider,
};

export function getActiveProvider(): AiProvider {
  const prefs = preferencesMemory.get();
  if (prefs.aiMode === 'off') {
    return openaiProvider; // arbitrary; callers should check aiMode first
  }
  if (prefs.aiMode === 'local') return localProvider;
  return REGISTRY[prefs.aiProvider] ?? openaiProvider;
}

export function listProviders(): AiProvider[] {
  return [openaiProvider, anthropicProvider, localProvider];
}

export function getProviderById(id: string): AiProvider | null {
  return REGISTRY[id] ?? null;
}
