/**
 * Local AI model recommendation — a pure, dependency-light function shared
 * by the main process and the renderer so both reach the *same* verdict.
 *
 * Inputs are intentionally plain data:
 *   - `models`: the catalog snapshot (`LocalAiModelInfo[]`), already filtered
 *     to the standard lane.
 *   - `hw`: the latest hardware probe, or `null` when none exists yet.
 *
 * The function never performs IO. It maps each model to a {@link LocalAiModelFit}
 * and chooses a single primary pick, honoring two policy rules:
 *
 *   1. Qwen3-4B (the policy default) stays the primary whenever it is at
 *      least `usable`, so the "standard" experience is consistent.
 *   2. The lightest model is floored at `slow`, guaranteeing every PC sees a
 *      runnable fallback (policy §3).
 */

import type {
  HardwareCapability,
  LocalAiModelFit,
  LocalAiModelInfo,
  LocalAiModelId,
  LocalAiModelRecommendation,
  LocalAiRecommendation,
} from './types';
import { DEFAULT_LOCAL_AI_MODEL_ID, LOCAL_AI_MODEL_IDS } from './localAiPolicy';

/** Extra RAM (GB) above a model's minimum that we treat as "comfortable". */
const COMFORT_HEADROOM_GB = 4;
/** A discrete GPU with at least this much VRAM meaningfully speeds inference. */
const USEFUL_VRAM_GB = 4;
/** CPU core counts that gate the speed tiers (mirrors capabilityCheck). */
const STRONG_CPU_CORES = 8;
const OK_CPU_CORES = 4;
/**
 * If free RAM at probe time is below this fraction of a model's minimum,
 * we treat the machine as under memory pressure and shave one tier off a
 * would-be `recommended`. Free RAM is noisy, so the effect is deliberately
 * limited to the top tier only.
 */
const TIGHT_FREE_RAM_FRACTION = 0.5;

const FIT_SCORE: Record<LocalAiModelFit, number> = {
  recommended: 3,
  usable: 2,
  slow: 1,
  too_heavy: 0,
};

/** Lower = more preferred. Index in the policy allowlist (default first). */
function preferenceRank(id: LocalAiModelId): number {
  const idx = (LOCAL_AI_MODEL_IDS as readonly string[]).indexOf(id);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function hasUsefulGpu(hw: HardwareCapability): boolean {
  return hw.hasGpu && (hw.gpuVramGb ?? 0) >= USEFUL_VRAM_GB;
}

function classifyFit(model: LocalAiModelInfo, hw: HardwareCapability): LocalAiModelFit {
  const ram = hw.totalRamGb;
  const min = model.minRamGb;

  // Clearly insufficient memory: more than 1 GB short.
  if (ram < min - 1) return 'too_heavy';
  // Just under the minimum: will run but swap/be sluggish.
  if (ram < min) return 'slow';

  const fastAccel = hasUsefulGpu(hw) || hw.cpuCores >= STRONG_CPU_CORES;
  const okCpu = hw.cpuCores >= OK_CPU_CORES;

  let fit: LocalAiModelFit;
  if (ram >= min + COMFORT_HEADROOM_GB && fastAccel) {
    fit = 'recommended';
  } else if (fastAccel || okCpu) {
    fit = 'usable';
  } else {
    // Enough RAM, but a weak CPU and no GPU → expect slow briefings.
    fit = 'slow';
  }

  // Memory-pressure shave (top tier only): if the machine currently has
  // very little free RAM relative to the model, soften the optimism.
  if (fit === 'recommended' && hw.freeRamGb < min * TIGHT_FREE_RAM_FRACTION) {
    fit = 'usable';
  }
  return fit;
}

/** Index of the lightest model (smallest `minRamGb`); -1 when empty. */
function lightestIndex(models: LocalAiModelInfo[]): number {
  let best = -1;
  for (let i = 0; i < models.length; i++) {
    if (best === -1 || models[i]!.minRamGb < models[best]!.minRamGb) best = i;
  }
  return best;
}

export function recommendLocalAiModels(
  models: LocalAiModelInfo[],
  hw: HardwareCapability | null,
): LocalAiRecommendation {
  if (models.length === 0) {
    return { models: [], primaryModelId: null, basedOnHardware: hw != null };
  }

  // Step 1: classify each model.
  const fits = new Map<LocalAiModelId, LocalAiModelFit>();
  for (const m of models) {
    fits.set(m.id, hw ? classifyFit(m, hw) : 'usable');
  }

  // Step 2: guarantee a fallback — the lightest model is never `too_heavy`.
  const li = lightestIndex(models);
  if (li !== -1) {
    const lightest = models[li]!;
    if (fits.get(lightest.id) === 'too_heavy') {
      fits.set(lightest.id, 'slow');
    }
  }

  // Step 3: choose the primary.
  const primaryModelId = pickPrimary(models, fits);

  // Step 4: order best→worst (fit score desc, then preference asc).
  const ordered: LocalAiModelRecommendation[] = models
    .map((m) => ({
      modelId: m.id,
      fit: fits.get(m.id)!,
      isPrimary: m.id === primaryModelId,
    }))
    .sort((a, b) => {
      const byFit = FIT_SCORE[b.fit] - FIT_SCORE[a.fit];
      if (byFit !== 0) return byFit;
      return preferenceRank(a.modelId) - preferenceRank(b.modelId);
    });

  return { models: ordered, primaryModelId, basedOnHardware: hw != null };
}

function pickPrimary(
  models: LocalAiModelInfo[],
  fits: Map<LocalAiModelId, LocalAiModelFit>,
): LocalAiModelId {
  // Rule 1: keep the policy default as primary whenever it's at least usable.
  const defaultFit = fits.get(DEFAULT_LOCAL_AI_MODEL_ID);
  if (defaultFit && (defaultFit === 'recommended' || defaultFit === 'usable')) {
    if (models.some((m) => m.id === DEFAULT_LOCAL_AI_MODEL_ID)) {
      return DEFAULT_LOCAL_AI_MODEL_ID;
    }
  }

  // Rule 2 (weak PC): best fit wins; tie-break toward the lightest model so
  // a struggling machine gets the most runnable option, not the heaviest.
  const ranked = [...models].sort((a, b) => {
    const byFit = FIT_SCORE[fits.get(b.id)!] - FIT_SCORE[fits.get(a.id)!];
    if (byFit !== 0) return byFit;
    return a.minRamGb - b.minRamGb;
  });
  return ranked[0]!.id;
}

/** Convenience for callers that only need the primary id. */
export function primaryRecommendedModel(
  models: LocalAiModelInfo[],
  hw: HardwareCapability | null,
): LocalAiModelId | null {
  return recommendLocalAiModels(models, hw).primaryModelId;
}
