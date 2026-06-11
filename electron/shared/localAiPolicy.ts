/**
 * Local AI policy constants — the single source of truth for the runtime
 * + model allowlist enforced by `docs/local-ai-policy.md`.
 *
 * Bumping {@link LOCAL_AI_POLICY_VERSION} will invalidate every user's
 * stored notice acceptance and force a fresh prompt on next launch.
 * See policy §10.
 */

import type { LocalAiAcceptedNotices, LocalAiModelId, UserPreferences } from './types';

/**
 * Current policy version. Bump only when §2 (license list) or §3 (default
 * model) of `docs/local-ai-policy.md` changes. The renderer compares this
 * against `UserPreferences.localAiAcceptedNotices.policyVersion` to decide
 * whether to re-prompt.
 */
export const LOCAL_AI_POLICY_VERSION = 1 as const;

/**
 * Approved models for the **standard lane**. Every entry in
 * `electron/modules/localAi/modelCatalog.ts` (Phase 2) must be one of these
 * ids. The renderer also uses this list to filter the picker.
 *
 * Order is significant: index 0 is the recommended default for capable PCs.
 */
export const LOCAL_AI_MODEL_IDS = [
  'qwen3-4b-instruct',
  'mistral-7b-instruct-v0.3',
  'smollm2-1.7b-instruct',
  'phi-3.5-mini-instruct',
] as const satisfies readonly LocalAiModelId[];

/** Default standard model — see policy §3. */
export const DEFAULT_LOCAL_AI_MODEL_ID: LocalAiModelId = 'qwen3-4b-instruct';

export function isApprovedLocalAiModelId(id: unknown): id is LocalAiModelId {
  return typeof id === 'string' && (LOCAL_AI_MODEL_IDS as readonly string[]).includes(id);
}

/**
 * True when the user has acknowledged the current policy version.
 * Phase 2 setup flows must not download anything until this returns true.
 */
export function isLocalAiNoticeCurrent(prefs: UserPreferences): boolean {
  const a = prefs.localAiAcceptedNotices;
  return !!a && a.policyVersion === LOCAL_AI_POLICY_VERSION;
}

/** Builds a fresh notice-acceptance record for the current policy version. */
export function buildLocalAiAcceptance(now: number = Date.now()): LocalAiAcceptedNotices {
  return { policyVersion: LOCAL_AI_POLICY_VERSION, acceptedAt: now };
}
