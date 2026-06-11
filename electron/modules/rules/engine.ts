/**
 * Rule Engine façade.
 *
 * Single entry point used by the monitor and the AI layer. The engine itself
 * doesn't talk to Gmail or the AI — it consumes already-fetched email
 * metadata and emits classified results + memory side effects.
 */

import type {
  EmailSummary,
  MemoryProposal,
  MemoryProposalResult,
  SenderProfile,
  UserPreferences,
} from '@shared/types';
import { contactsRepo } from '@main/modules/persistence/repositories/contactsRepo';
import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';
import { senderProfilesRepo } from '@main/modules/persistence/repositories/senderProfilesRepo';
import { scoreEmail } from './importance';
import {
  resolveOnIncoming,
  trackOutgoingAsAwaitedIfNeeded,
  type SentByUserSignal,
} from './awaitedReply';
import { validateAndApply } from './proposalValidator';
import { deriveCategory } from './categorize';
import {
  classifySender,
  type HeaderSignals,
} from './senderClassifier';

export interface ClassifyContext {
  preferences: UserPreferences;
  userPrimaryEmail: string | null;
  /** Header signals captured at fetch time. Optional for backwards-compat. */
  headerSignals?: HeaderSignals;
}

const EMPTY_SIGNALS: HeaderSignals = {
  hasListUnsubscribe: false,
  precedenceBulk: false,
  autoSubmitted: false,
  hasCampaignId: false,
};

export const ruleEngine = {
  /** Score a freshly fetched incoming email. */
  classifyIncoming(
    email: Omit<EmailSummary, 'importanceScore' | 'priority' | 'reasons'>,
    ctx: ClassifyContext,
  ): EmailSummary {
    const awaitedThreads = new Set(
      awaitedRepo.list({ status: 'waiting' }).map((a) => a.threadId),
    );

    // --- Sender profile refresh ------------------------------------------
    // Run the deterministic sender classifier on this one observation and
    // merge the verdict into the persistent profile. After this call the
    // profile reflects the best-known "what kind of sender is this".
    const profile = updateSenderProfile(email, ctx, awaitedThreads);

    // The category derived at fetch time was a placeholder (no profile yet).
    // Recompute it now that we have a stable profile to lean on.
    const refinedCategory = deriveCategory(
      {
        labels: email.labels,
        subject: email.subject,
        snippet: email.snippet,
        from: email.from,
      },
      profile,
    );
    const refined = { ...email, category: refinedCategory };

    const result = scoreEmail(refined, {
      preferences: ctx.preferences,
      contactByEmail: (e) => contactsRepo.get(e),
      awaitedThreadIds: awaitedThreads,
      userPrimaryEmail: ctx.userPrimaryEmail,
    });

    // If we were awaiting this thread, mark it resolved.
    resolveOnIncoming(refined.threadId, refined.from.email);

    return {
      ...refined,
      importanceScore: result.score,
      priority: result.priority,
      reasons: result.reasons,
    };
  },

  classifyOutgoing(signal: SentByUserSignal) {
    return trackOutgoingAsAwaitedIfNeeded(signal);
  },

  /**
   * Re-score a row already in SQLite (backfill / briefing). Refreshes the
   * sender profile and category without Gmail refetch or awaited-resolve.
   */
  reclassifyStored(
    email: EmailSummary,
    ctx: ClassifyContext,
  ): EmailSummary {
    const awaitedThreads = new Set(
      awaitedRepo.list({ status: 'waiting' }).map((a) => a.threadId),
    );
    const profile = updateSenderProfile(email, ctx, awaitedThreads);
    const refinedCategory = deriveCategory(
      {
        labels: email.labels,
        subject: email.subject,
        snippet: email.snippet,
        from: email.from,
      },
      profile,
    );
    const refined = { ...email, category: refinedCategory };
    const result = scoreEmail(refined, {
      preferences: ctx.preferences,
      contactByEmail: (e) => contactsRepo.get(e),
      awaitedThreadIds: awaitedThreads,
      userPrimaryEmail: ctx.userPrimaryEmail,
    });
    return {
      ...refined,
      importanceScore: result.score,
      priority: result.priority,
      reasons: result.reasons,
    };
  },

  /** Run a batch of AI-produced memory proposals through validation. */
  applyProposals(proposals: MemoryProposal[]): MemoryProposalResult[] {
    return proposals.map(validateAndApply);
  },
};

function updateSenderProfile(
  email: Omit<EmailSummary, 'importanceScore' | 'priority' | 'reasons'>,
  ctx: ClassifyContext,
  awaitedThreads: Set<string>,
): SenderProfile {
  const fromEmail = email.from.email.toLowerCase();
  const domain = fromEmail.split('@')[1] ?? 'unknown';
  const existingProfile = senderProfilesRepo.get(fromEmail);
  const existingContact = contactsRepo.get(fromEmail);
  const userPrimary = ctx.userPrimaryEmail?.toLowerCase() ?? null;
  const toEmails = email.to.map((a) => a.email.toLowerCase());
  const directlyAddressed =
    !!userPrimary && toEmails.length <= 2 && toEmails.includes(userPrimary);
  const knownHumanCorrespondent =
    awaitedThreads.has(email.threadId) ||
    !!existingContact ||
    (existingProfile?.kind === 'person' && existingProfile.humanSignalCount > 0);

  const verdict = classifySender({
    email: fromEmail,
    displayName: email.from.name,
    labels: email.labels,
    subject: email.subject,
    snippet: email.snippet,
    headerSignals: ctx.headerSignals ?? EMPTY_SIGNALS,
    directlyAddressed,
    knownHumanCorrespondent,
    existing: existingProfile,
  });

  return senderProfilesRepo.observe({
    email: fromEmail,
    domain,
    displayName: email.from.name,
    kind: verdict.kind,
    affiliation: verdict.affiliation,
    bulkSignalDelta: verdict.bulkSignalDelta,
    humanSignalDelta: verdict.humanSignalDelta,
    confidence: verdict.confidence,
    seenAt: email.receivedAt,
  });
}
