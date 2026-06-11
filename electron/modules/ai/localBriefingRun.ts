/**
 * Shared managed/Ollama local lane: briefing-only model pass + rule triage after parse.
 */

import type { BriefingInput } from './provider';
import { BriefingContextOverflowError } from './provider';
import { briefingPerfMark } from './briefingPerf';
import { planLocalBriefingRequest, type LocalBriefingPlan } from './localBriefingBudget';

/** Run before any local model HTTP call — throws if prompt cannot fit ctx. */
export function preflightLocalBriefing(input: BriefingInput): LocalBriefingPlan {
  const plan = planLocalBriefingRequest(input);
  briefingPerfMark(
    'local_preflight',
    `estIn=${plan.estInputTokens} maxOut=${plan.maxTokens} total=${plan.estTotalTokens} fits=${plan.fits}`,
  );
  if (!plan.fits) {
    throw new BriefingContextOverflowError();
  }
  return plan;
}
