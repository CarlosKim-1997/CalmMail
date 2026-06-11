/**
 * Advanced local AI provider — user-managed Ollama on 127.0.0.1:11434.
 *
 * Selected by `localProvider` only when
 * `prefs.localAiPreferredRuntime === 'ollama_advanced'`. CalmMail does not
 * validate the licenses of models loaded through Ollama; the user has
 * accepted that responsibility via the advanced-disclosure warning
 * (Phase 3 UI).
 *
 * Triage is rule-based (same as managed lane); the model only writes briefing
 * prose. Preflight blocks overflow before inference.
 */

import type { AiProvider, BriefingInput, BriefingResult } from '../provider';
import { ProviderNotConfiguredError } from '../provider';
import type { MemoryProposal, MorningBriefing } from '@shared/types';
import { parseBriefingPayload } from '../parseBriefing';
import { preflightLocalBriefing } from '../localBriefingRun';
import { briefingPerfMark } from '../briefingPerf';

const OLLAMA_BASE = 'http://127.0.0.1:11434';

/** Set `CALMMAIL_OLLAMA_CPU_ONLY=1` before starting CalmMail to skip GPU from the first request (slower but avoids a failed GPU attempt). */
function envForceOllamaCpuOnly(): boolean {
  const v = process.env.CALMMAIL_OLLAMA_CPU_ONLY;
  return v === '1' || v === 'true' || v === 'yes';
}

/** Ollama runner died during GPU init (driver/CUDA stack); retrying with `num_gpu: 0` often works. */
function looksLikeOllamaGpuRuntimeFailure(body: string): boolean {
  const s = body.toLowerCase();
  return (
    s.includes('cuda error') ||
    s.includes('cuda_runtime') ||
    (s.includes('cuda') && s.includes('runner process has terminated')) ||
    s.includes('rocm error') ||
    (s.includes('rocm') && s.includes('error'))
  );
}

// Suppress "unused" warnings while keeping the imports stable for type narrowing.
void (null as unknown as MemoryProposal);
void (null as unknown as MorningBriefing);

/** Returns whether Ollama's HTTP API answers `/api/tags` within ~1.5s. */
export async function probeOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let ollamaUp = false;

/** Caller (localAiManager) refreshes this; the provider reads it without re-probing per call. */
export function setOllamaDetected(detected: boolean): void {
  ollamaUp = detected;
}

export function isOllamaDetected(): boolean {
  return ollamaUp;
}

async function fetchFirstModelName(): Promise<string | null> {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
    method: 'GET',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  const models = data.models ?? [];
  if (models.length === 0) return null;

  const preferred = ['llama3.2', 'llama3.1', 'llama3', 'mistral', 'phi3', 'gemma2', 'qwen2'];
  for (const p of preferred) {
    const hit = models.find((m) => m.name.toLowerCase().includes(p));
    if (hit) return hit.name;
  }
  return models[0]!.name;
}

async function runOllamaBriefing(
  model: string,
  input: BriefingInput,
): Promise<{ briefing: MorningBriefing; proposals: MemoryProposal[] }> {
  const plan = preflightLocalBriefing(input);

  const buildBody = (cpuOnly: boolean) =>
    JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.2,
        num_predict: plan.maxTokens,
        ...(cpuOnly ? { num_gpu: 0 } : {}),
      },
      messages: [
        { role: 'system', content: plan.systemPrompt },
        { role: 'user', content: plan.userPrompt },
      ],
    });

  const post = (cpuOnly: boolean) =>
    fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180_000),
      body: buildBody(cpuOnly),
    });

  briefingPerfMark(
    'local_ai_request',
    `ollama briefing-only estInTok≈${plan.estInputTokens} maxOut=${plan.maxTokens}`,
  );
  const t0 = Date.now();

  const forceCpuFirst = envForceOllamaCpuOnly();
  let res = await post(forceCpuFirst);
  let raw = await res.text();

  if (!res.ok && !forceCpuFirst && looksLikeOllamaGpuRuntimeFailure(raw)) {
    res = await post(true);
    raw = await res.text();
  }

  if (!res.ok) {
    throw new Error(`ollama_${res.status}: ${raw.slice(0, 240)}`);
  }

  const data = JSON.parse(raw) as { message?: { content?: string } };
  const text = data.message?.content ?? '{}';
  briefingPerfMark('local_ai_ok', `ollama briefing-only inferMs=${Date.now() - t0}`);
  return parseBriefingPayload(text, input, 'local');
}

export const ollamaProvider: AiProvider = {
  id: 'local',
  label: 'Local AI (Ollama, advanced)',
  isCloud: false,

  isConfigured(): boolean {
    return ollamaUp;
  },

  async runBriefing(input: BriefingInput): Promise<BriefingResult> {
    if (!ollamaUp) throw new ProviderNotConfiguredError('local');
    const model = await fetchFirstModelName();
    if (!model) throw new ProviderNotConfiguredError('local');
    return runOllamaBriefing(model, input);
  },
};
