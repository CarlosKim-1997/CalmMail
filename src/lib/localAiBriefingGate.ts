import { isLocalAiNoticeCurrent } from '@shared/localAiPolicy';
import type { LocalAiManagedStatus, UserPreferences } from '@shared/types';

/** Why local-mode briefing cannot run yet (prefs + optional managed status). */
export type LocalBriefingBlock =
  | 'runtime_not_managed'
  | 'notice_not_accepted'
  | 'model_not_selected'
  | 'artifacts_missing'
  | 'ollama_not_ready';

export function getLocalBriefingBlock(
  prefs: UserPreferences | null,
  managed: LocalAiManagedStatus | null,
): LocalBriefingBlock | null {
  if (!prefs || prefs.aiMode !== 'local') return null;

  if (prefs.localAiPreferredRuntime === 'none') {
    return 'runtime_not_managed';
  }
  if (prefs.localAiPreferredRuntime === 'ollama_advanced') {
    return null;
  }
  if (prefs.localAiPreferredRuntime !== 'managed') {
    return 'runtime_not_managed';
  }
  if (!isLocalAiNoticeCurrent(prefs)) return 'notice_not_accepted';
  if (!prefs.localAiModelId) return 'model_not_selected';
  if (!managed?.binaryReady || !managed?.modelReady) return 'artifacts_missing';
  return null;
}
