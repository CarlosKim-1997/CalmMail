/**
 * AI provider abstraction.
 *
 * The rest of the app talks to a single `AiProvider` interface. Concrete
 * providers (OpenAI, Anthropic, OpenRouter, Gemini, local) implement it.
 *
 * Methods are deliberately minimal:
 *   - generateBriefing(): structured morning briefing
 *   - proposeMemoryUpdates(): structured memory proposals (validated later)
 *
 * Providers MUST return JSON-shaped data, never free-form prose at the UI
 * level. The briefing's `toneNote` is the only short prose field, and it is
 * capped.
 */

import type {
  AiProviderId,
  AppLanguage,
  BriefingInspectionSummary,
  EmailCategory,
  MemoryProposal,
  MorningBriefing,
  NotificationPriority,
  SenderKind,
} from '@shared/types';

/**
 * Slim per-sender hint we ship with each briefing prompt. Avoids hauling the
 * full profile rows over to the AI — the AI only needs to know the bucket
 * each top sender falls into so it stops calling marketing mail "personal".
 */
export interface BriefingSenderProfile {
  email: string;
  kind: SenderKind;
  affiliation: string | null;
  confidence: number;
  /** How many messages in the current briefing window came from this sender. */
  recentCount: number;
}

export interface BriefingInput {
  generatedAt: number;
  importantRecent: Array<{
    id: string;
    threadId: string;
    from: string;
    subject: string;
    snippet: string;
    receivedAt: number;
    importanceScore: number;
    category: EmailCategory;
    reasons: string[];
  }>;
  awaited: Array<{
    threadId: string;
    contact: string;
    subject: string;
    sentAt: number;
    expectedByMinutes: number | null;
  }>;
  vipContacts: string[];
  userPrimaryEmail: string | null;
  /** UI language — briefing prose fields must match this. */
  outputLanguage: AppLanguage;
  /**
   * What the deterministic rule engine just observed. The AI gets this so it
   * can reference real numbers in its reasoning string instead of guessing.
   */
  inspected: BriefingInspectionSummary;
  /** Past categories the user has engaged with; nudge, never override. */
  learnedImportantCategories: EmailCategory[];
  /**
   * Compact directory of senders seen in the scan window with their cached
   * kind (`company`, `person`, `newsletter`, …) and inferred affiliation.
   * Capped tightly; the AI MUST use this when describing a cluster.
   */
  senderDirectory: BriefingSenderProfile[];
  /**
   * Unread messages in the triage window. AI must assign each id to exactly
   * one of now / today / later in triageGroups.
   */
  unreadForTriage: Array<{
    id: string;
    threadId: string;
    from: string;
    subject: string;
    snippet: string;
    receivedAt: number;
    importanceScore: number;
    category: EmailCategory;
    priority: NotificationPriority;
    reasons: string[];
    openCount: number;
  }>;
  triageWithinDays: number;
  /** Total unread in window (may exceed unreadForTriage when capped). */
  unreadInScope: number;
}

export interface BriefingResult {
  briefing: MorningBriefing;
  proposals: MemoryProposal[];
}

export interface AiProvider {
  id: AiProviderId;
  label: string;
  isCloud: boolean;
  isConfigured(): boolean;

  /**
   * Canonical entry point: ONE round-trip that yields both the briefing JSON
   * and the (still-untrusted) memory proposals. The orchestrator validates
   * proposals via the rule engine before they touch storage.
   */
  runBriefing(input: BriefingInput): Promise<BriefingResult>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(public readonly providerId: AiProviderId) {
    super(`CALMMAIL_PROVIDER_NOT_CONFIGURED:${providerId}`);
    this.name = 'ProviderNotConfiguredError';
  }
}

/** Local lane not ready (runtime / notice / model / binaries). */
export class LocalAiNotReadyError extends Error {
  constructor(public readonly reason: string) {
    super(`CALMMAIL_LOCAL_AI_NOT_READY:${reason}`);
    this.name = 'LocalAiNotReadyError';
  }
}

/**
 * Free-tier ran out of daily cloud briefings. Carries the next allowed time
 * (ms since epoch, local midnight) so the UI can show a precise reset hint.
 */
export class CloudBriefingLimitError extends Error {
  constructor(public readonly resetAt: number, public readonly limit: number) {
    super(`CALMMAIL_CLOUD_BRIEFING_LIMIT:${resetAt}:${limit}`);
    this.name = 'CloudBriefingLimitError';
  }
}

/** Local llama-server prompt exceeds `--ctx-size` even after trimming. */
export class BriefingContextOverflowError extends Error {
  constructor() {
    super('CALMMAIL_LOCAL_AI_CONTEXT_OVERFLOW');
    this.name = 'BriefingContextOverflowError';
  }
}
