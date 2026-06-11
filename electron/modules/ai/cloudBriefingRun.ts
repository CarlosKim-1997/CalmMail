/**
 * Cloud briefing: rules pre-sort all unread; model only overrides ambiguous rows.
 */

import type { BriefingInput } from './provider';
import {
  BRIEFING_SYSTEM_PROMPT_BRIEFING_ONLY,
  BRIEFING_SYSTEM_PROMPT_CLOUD_SPARSE,
  buildBriefingUserPrompt,
} from './prompts';
import { buildAmbiguousTriagePromptRows } from './triage';
import { briefingPerfMark } from './briefingPerf';

export interface CloudBriefingPlan {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  ambiguousCount: number;
  ruleTriageCount: number;
  sparseTriage: boolean;
}

export function planCloudBriefingRequest(input: BriefingInput): CloudBriefingPlan {
  const ambiguousForTriage = buildAmbiguousTriagePromptRows(input);
  const sparseTriage = ambiguousForTriage.length > 0;
  const systemPrompt = sparseTriage
    ? BRIEFING_SYSTEM_PROMPT_CLOUD_SPARSE
    : BRIEFING_SYSTEM_PROMPT_BRIEFING_ONLY;
  const userPrompt = buildBriefingUserPrompt(input, {
    compact: true,
    triageInPrompt: sparseTriage,
    ambiguousForTriage: sparseTriage ? ambiguousForTriage : undefined,
  });
  const maxTokens = sparseTriage
    ? Math.min(2048, Math.max(384, 320 + ambiguousForTriage.length * 28))
    : 512;

  briefingPerfMark(
    'cloud_preflight',
    `sparse=${sparseTriage} rule=${input.unreadForTriage.length} ambiguous=${ambiguousForTriage.length} maxOut=${maxTokens}`,
  );

  return {
    systemPrompt,
    userPrompt,
    maxTokens,
    ambiguousCount: ambiguousForTriage.length,
    ruleTriageCount: input.unreadForTriage.length,
    sparseTriage,
  };
}
