/**
 * Local AI provider — thin router between the two lanes.
 *
 * Reads `UserPreferences.localAiPreferredRuntime` and delegates to:
 *   - `managedProvider` (standard, Apache-2.0)
 *   - `ollamaProvider`  (advanced opt-in, user-managed Ollama)
 *
 * No business logic lives here — both lanes are responsible for their own
 * configuration checks, error handling, and child process plumbing.
 * Keeping the router empty makes it trivial to add a third lane later
 * without surgery on the registry or briefing orchestrator.
 */

import type { AiProvider, BriefingInput, BriefingResult } from '../provider';
import { LocalAiNotReadyError, ProviderNotConfiguredError } from '../provider';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { inspectManagedReadiness, managedProvider } from './managedProvider';
import { ollamaProvider } from './ollamaProvider';

function activeLane(): AiProvider | null {
  const prefs = preferencesMemory.get();
  if (prefs.localAiPreferredRuntime === 'managed') return managedProvider;
  if (prefs.localAiPreferredRuntime === 'ollama_advanced') return ollamaProvider;
  return null;
}

export const localProvider: AiProvider = {
  id: 'local',
  label: 'Local AI',
  isCloud: false,

  isConfigured(): boolean {
    const prefs = preferencesMemory.get();
    if (prefs.aiMode !== 'local') return false;
    if (prefs.localAiPreferredRuntime === 'none') return false;
    const lane = activeLane();
    return lane ? lane.isConfigured() : false;
  },

  async runBriefing(input: BriefingInput): Promise<BriefingResult> {
    const prefs = preferencesMemory.get();
    if (prefs.localAiPreferredRuntime === 'none') {
      throw new LocalAiNotReadyError('runtime_not_managed');
    }
    const lane = activeLane();
    if (!lane) throw new LocalAiNotReadyError('runtime_not_managed');
    if (!lane.isConfigured()) {
      if (prefs.localAiPreferredRuntime === 'managed') {
        const r = inspectManagedReadiness();
        throw new LocalAiNotReadyError(r.reason ?? 'artifacts_missing');
      }
      throw new LocalAiNotReadyError('ollama_not_ready');
    }
    return lane.runBriefing(input);
  },
};
