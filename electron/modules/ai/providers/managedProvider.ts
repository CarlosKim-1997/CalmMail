/**
 * Standard local AI provider — talks to CalmMail's managed `llama-server`
 * (Apache-2.0 model, MIT runtime, both bound to `127.0.0.1`).
 *
 * Selected by `localProvider` when:
 *   - `prefs.aiMode === 'local'`
 *   - `prefs.localAiPreferredRuntime === 'managed'`
 *   - `prefs.localAiModelId` is set and approved
 *   - The user has accepted the current Local AI policy
 *   - The binary + model file are present on disk
 *
 * If any of the above is missing we throw `LocalAiNotReadyError` with a
 * specific reason so the UI can point the user to setup.
 *
 * Triage: rule engine (`finalizeTriageGroups` in parseBriefing) — the model
 * only writes briefing prose. Preflight `planLocalBriefingRequest` blocks
 * overflow before inference; no cap-down retries.
 */

import OpenAI from 'openai';
import type { AiProvider, BriefingInput, BriefingResult } from '../provider';
import { BriefingContextOverflowError, LocalAiNotReadyError } from '../provider';
import { parseBriefingPayload } from '../parseBriefing';
import { preflightLocalBriefing } from '../localBriefingRun';
import { briefingPerfMark } from '../briefingPerf';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { isLocalAiNoticeCurrent } from '@shared/localAiPolicy';
import {
  getServerInfo,
  isManagedReady,
  isServerRunning,
  startServer,
} from '@main/modules/localAi/llamacppRuntime';

/** Result that callers can probe before invoking `runBriefing`. */
export interface ManagedReadiness {
  ready: boolean;
  reason?:
    | 'mode_off'
    | 'runtime_not_managed'
    | 'model_not_selected'
    | 'notice_not_accepted'
    | 'artifacts_missing';
}

export function inspectManagedReadiness(): ManagedReadiness {
  const prefs = preferencesMemory.get();
  if (prefs.aiMode !== 'local') return { ready: false, reason: 'mode_off' };
  if (prefs.localAiPreferredRuntime !== 'managed') {
    return { ready: false, reason: 'runtime_not_managed' };
  }
  if (!prefs.localAiModelId) return { ready: false, reason: 'model_not_selected' };
  if (!isLocalAiNoticeCurrent(prefs)) return { ready: false, reason: 'notice_not_accepted' };
  if (!isManagedReady(prefs.localAiModelId)) {
    return { ready: false, reason: 'artifacts_missing' };
  }
  return { ready: true };
}

async function ensureServerStarted(): Promise<number> {
  const prefs = preferencesMemory.get();
  if (!prefs.localAiModelId) {
    throw new LocalAiNotReadyError('model_not_selected');
  }
  if (isServerRunning()) {
    const info = getServerInfo();
    if (info && info.modelId === prefs.localAiModelId) return info.port;
  }
  const r = await startServer(prefs.localAiModelId);
  if (!r.ok || r.port == null) {
    const reason =
      r.errorCode === 'binary_missing' || r.errorCode === 'model_missing'
        ? 'artifacts_missing'
        : 'server_start_failed';
    throw new LocalAiNotReadyError(reason);
  }
  return r.port;
}

async function runManagedBriefing(input: BriefingInput): Promise<BriefingResult> {
  const plan = preflightLocalBriefing(input);

  const port = await ensureServerStarted();
  const baseURL = `http://127.0.0.1:${port}/v1`;
  const client = new OpenAI({ apiKey: 'local-ai-no-auth', baseURL });

  briefingPerfMark(
    'local_ai_request',
    `briefing-only estInTok≈${plan.estInputTokens} maxOut=${plan.maxTokens}`,
  );
  const t0 = Date.now();
  const baseRequest = {
    model: preferencesMemory.get().localAiModelId ?? 'managed',
    temperature: 0.2,
    max_tokens: plan.maxTokens,
    messages: [
      { role: 'system' as const, content: plan.systemPrompt },
      { role: 'user' as const, content: plan.userPrompt },
    ],
  };

  let content = '{}';
  try {
    const resp = await client.chat.completions.create({
      ...baseRequest,
      response_format: { type: 'json_object' },
    });
    content = resp.choices[0]?.message?.content ?? '{}';
  } catch (inner) {
    if (isContextOverflowError(inner)) throw new BriefingContextOverflowError();
    if (!isJsonModeUnsupported(inner)) throw inner;
    const resp = await client.chat.completions.create(baseRequest);
    content = resp.choices[0]?.message?.content ?? '{}';
  }

  briefingPerfMark('local_ai_ok', `briefing-only inferMs=${Date.now() - t0}`);
  return parseBriefingPayload(content, input, 'local');
}

function isContextOverflowError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { error?: { type?: string }; message?: string };
  if (e.error?.type === 'exceed_context_size_error') return true;
  return (e.message ?? '').includes('exceed_context_size_error') ||
    (e.message ?? '').includes('exceeds the available context size');
}

function isJsonModeUnsupported(err: unknown): boolean {
  return !isContextOverflowError(err);
}

export const managedProvider: AiProvider = {
  id: 'local',
  label: 'Local AI (managed)',
  isCloud: false,

  isConfigured(): boolean {
    return inspectManagedReadiness().ready;
  },

  async runBriefing(input: BriefingInput): Promise<BriefingResult> {
    const r = inspectManagedReadiness();
    if (!r.ready) {
      throw new LocalAiNotReadyError(r.reason ?? 'artifacts_missing');
    }
    return runManagedBriefing(input);
  },
};
