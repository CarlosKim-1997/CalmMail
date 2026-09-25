/**
 * Optional 2nd local inference: sparse triageOverrides for ambiguous unread only.
 * Briefing prose stays in pass 1; triage quality approaches cloud v1.2 without
 * full triageGroups output.
 */

import type { BriefingInput } from './provider';
import {
  BRIEFING_SYSTEM_PROMPT_CLOUD_SPARSE,
  buildBriefingUserPrompt,
} from './prompts';
import {
  buildAmbiguousTriagePromptRows,
  buildRuleTriageGroups,
  listAmbiguousTriageRows,
} from './triage';
import { applyTriageOverridesFromText } from './parseBriefing';
import { briefingPerfMark } from './briefingPerf';
import { LOCAL_LLAMA_CTX, estimatePromptTokens } from './localBriefingBudget';
import { LOCAL_TRIAGE_AI_AMBIGUOUS_CAP } from '@shared/triage';
import type { TriageGroups } from '@shared/types';

const PASS2_SAFETY = 48;
const PASS2_MAX_TOKENS_CAP = 384;

export interface LocalSparseTriagePlan {
  fits: boolean;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  ambiguousCount: number;
}

export function planLocalSparseTriageRequest(input: BriefingInput): LocalSparseTriagePlan {
  const ambiguous = buildAmbiguousTriagePromptRows(input);
  const systemPrompt = BRIEFING_SYSTEM_PROMPT_CLOUD_SPARSE;
  const userPrompt = buildBriefingUserPrompt(input, {
    compact: true,
    triageInPrompt: true,
    ambiguousForTriage: ambiguous,
  });
  const maxTokens = Math.min(
    PASS2_MAX_TOKENS_CAP,
    Math.max(160, 96 + ambiguous.length * 22),
  );
  const estIn =
    estimatePromptTokens(systemPrompt) + estimatePromptTokens(userPrompt);
  const estTotal = estIn + maxTokens + PASS2_SAFETY;
  return {
    fits: ambiguous.length > 0 && estTotal <= LOCAL_LLAMA_CTX,
    systemPrompt,
    userPrompt,
    maxTokens,
    ambiguousCount: ambiguous.length,
  };
}

export type LocalSparseTriageCompleter = (
  plan: LocalSparseTriagePlan,
) => Promise<string>;

/** Run pass-2 when ambiguous count is within cap; returns merged triage or rule baseline. */
export async function runLocalSparseTriagePass(
  complete: LocalSparseTriageCompleter,
  input: BriefingInput,
): Promise<TriageGroups> {
  const ambiguousRows = listAmbiguousTriageRows(input);
  if (
    ambiguousRows.length === 0 ||
    ambiguousRows.length > LOCAL_TRIAGE_AI_AMBIGUOUS_CAP
  ) {
    return buildRuleTriageGroups(input, input.unreadInScope);
  }

  const plan = planLocalSparseTriageRequest(input);
  if (!plan.fits) {
    briefingPerfMark('local_triage_skip', 'pass2_preflight_no_fit');
    return buildRuleTriageGroups(input, input.unreadInScope);
  }

  briefingPerfMark(
    'local_triage_pass2',
    `ambiguous=${plan.ambiguousCount} maxOut=${plan.maxTokens}`,
  );
  const t0 = Date.now();
  let content = '{}';
  try {
    content = await complete(plan);
  } catch {
    return buildRuleTriageGroups(input, input.unreadInScope);
  }

  briefingPerfMark('local_triage_pass2_ok', `inferMs=${Date.now() - t0}`);
  return applyTriageOverridesFromText(content, input);
}
