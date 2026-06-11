/**
 * Keeps managed llama-server prompts inside `--ctx-size` (8192).
 * Uses a conservative char→token estimate; local managed lane uses briefing-only
 * prompts (triage is rule-based) with a hard preflight — no overflow retries.
 */

import type { BriefingInput } from './provider';
import {
  BRIEFING_SYSTEM_PROMPT_BRIEFING_ONLY,
  buildBriefingUserPrompt,
} from './prompts';

/** Must match `llamacppRuntime` `--ctx-size`. */
export const LOCAL_LLAMA_CTX = 8192;

/** Legacy cap when triage was model output (cloud-style). */
export const LOCAL_LLAMA_MAX_TOKENS = 1024;

/** Managed local: briefing JSON only (no triageGroups). */
export const LOCAL_LLAMA_MAX_TOKENS_BRIEFING_ONLY = 512;

const PROMPT_SAFETY = 64;

export const LOCAL_PROMPT_TOKEN_BUDGET =
  LOCAL_LLAMA_CTX - LOCAL_LLAMA_MAX_TOKENS - PROMPT_SAFETY;

/** Conservative JSON token estimate (CJK + ids skew high). */
export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export interface LocalBriefingPlan {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  estInputTokens: number;
  estTotalTokens: number;
  fits: boolean;
}

/** Single pre-model plan — if `fits` is false, do not call llama-server. */
export function planLocalBriefingRequest(input: BriefingInput): LocalBriefingPlan {
  const systemPrompt = BRIEFING_SYSTEM_PROMPT_BRIEFING_ONLY;
  const userPrompt = buildBriefingUserPrompt(input, {
    compact: true,
    triageInPrompt: false,
  });
  const estInputTokens =
    estimatePromptTokens(systemPrompt) + estimatePromptTokens(userPrompt);
  const maxTokens = LOCAL_LLAMA_MAX_TOKENS_BRIEFING_ONLY;
  const estTotalTokens = estInputTokens + maxTokens + PROMPT_SAFETY;
  return {
    systemPrompt,
    userPrompt,
    maxTokens,
    estInputTokens,
    estTotalTokens,
    fits: estTotalTokens <= LOCAL_LLAMA_CTX,
  };
}

export function buildLocalBriefingUserPrompt(
  input: BriefingInput,
  _unreadCap?: number,
): string {
  return buildBriefingUserPrompt(input, { compact: true, triageInPrompt: false });
}

/** @deprecated Overflow retries removed; kept for tests / estimates. */
export function localPromptFits(unreadCap: number, input: BriefingInput): boolean {
  const systemTokens = estimatePromptTokens(BRIEFING_SYSTEM_PROMPT_BRIEFING_ONLY);
  const user = buildBriefingUserPrompt(input, {
    compact: true,
    triageInPrompt: false,
    unreadCap,
  });
  const userTokens = estimatePromptTokens(user);
  return (
    systemTokens + userTokens + LOCAL_LLAMA_MAX_TOKENS_BRIEFING_ONLY + PROMPT_SAFETY <=
    LOCAL_LLAMA_CTX
  );
}

/** @deprecated Use planLocalBriefingRequest; unread rows are not sent to local AI. */
export function pickLocalUnreadCap(input: BriefingInput): number {
  return input.unreadForTriage.length > 0 ? input.unreadForTriage.length : 0;
}
