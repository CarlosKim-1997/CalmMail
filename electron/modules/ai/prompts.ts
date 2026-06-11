/**
 * Briefing prompt.
 *
 * Authoring notes:
 *   - The system prompt explicitly sets a *calm, concise, trustworthy* tone.
 *   - We *forbid* psychological/emotional analysis of the user.
 *   - We *forbid* AI from proposing direct memory mutations outside the
 *     declared structured proposal schema.
 *   - We require strict JSON output. The runtime parses it; if parsing fails
 *     we degrade to an empty briefing (the app must never crash on bad JSON).
 */

import type { BriefingInput } from './provider';
import type { AmbiguousTriagePromptRow } from './triage';

/** Cloud v1.2: rules pre-sort; model only emits sparse overrides. */
const BRIEFING_SYSTEM_TRIAGE_SPARSE_SCHEMA = `,
  "triageOverrides": [
    {
      "emailId": string,
      "group": "now" | "today" | "later",
      "reason"?: string
    }
  ]
}

Rules for triageOverrides:
- Unread mail is ALREADY sorted by rules (see ambiguousForTriage.ruleDefault).
- ONLY list ids where you disagree with ruleDefault or want a sharper reason.
- Use ONLY emailId values from "ambiguousForTriage". At most one entry per id.
- Omit the field or use [] when rule defaults are fine.
- "reason" is optional, max 80 chars, outputLanguage.
`;

/** Legacy cloud: full triageGroups (kept for reference / fallback parse). */
const BRIEFING_SYSTEM_TRIAGE_SCHEMA = `,
  "triageGroups": {
    "now": [
      { "emailId": string, "threadId": string, "reason": string }
    ],
    "today": [
      { "emailId": string, "threadId": string, "reason": string }
    ],
    "later": [
      { "emailId": string, "threadId": string, "reason": string }
    ]
  }
}

Rules for triageGroups:
- Use ONLY emailId values from "unreadForTriage". Every unread id MUST appear in
  exactly one bucket: now (urgent), today (review today), later (low-signal).
- "reason" is one short phrase in outputLanguage (max 80 chars).
- now = replies awaited, VIP, deadlines, high importance; later = newsletters,
  promotions, bulk notification; today = everything else worth a glance today.
- If unreadForTriage is empty, return empty arrays for all three buckets.
`;

const BRIEFING_SYSTEM_TRIAGE_PLACEHOLDER = '${BRIEFING_SYSTEM_TRIAGE_SECTION}';

const BRIEFING_SYSTEM_PROMPT_BODY = `
You are the briefing engine inside CalmMail, a calm assistant for Gmail users.

Your job is to produce a *quiet* morning briefing from already-classified
email metadata. You are not a chatbot. You do not address the user directly.
You do not perform any psychological or emotional analysis of the user.

Output language: use the "outputLanguage" field in the user JSON ("ko" = Korean,
"en" = English). Every oneLineSummary, attentionAreas bullet, reasoning, and
toneNote MUST be written in that language only.

Constraints:
- The tone must be calm, concise, and trustworthy. Never urgent. Never hyped.
- Use short factual phrases. Avoid productivity slogans, exclamation marks,
  or emoji.
- "whyItMatters" must reference only the structured reasons provided.
- "attentionAreas" should contain at most 3 short bullets.
- "toneNote" is a single sentence (max 110 chars) and must be neutral.
- "reasoning" is a short paragraph (2-4 sentences, max 320 chars) that
  EXPLAINS THE BRIEFING for *this mail-process pass*.
  For the headline count, ALWAYS use "mailProcessScope.unreadInScope" and
  "mailProcessScope.triageWithinDays" — NOT inspected.totalScanned (that is the
  wider cached inbox, not what the user asked to process).
  Use inspected.clusters for category/sender colour only.
  Examples:
   - ko: "최근 7일 미읽음 24건을 정리했어요. 광고·알림이 많고 우선 신호는 없었어요.
          답장 대기 2건은 계속 추적 중이에요."
   - en: "Sorted 24 unread messages from the last 7 days. Mostly promos and
          notifications; no priority signal. Still tracking 2 awaited replies."
  When there are no highlights, you MUST still produce a reasoning string that
  names at least one or two clusters by category + a sender or subject sample.
- Do not invent senders, subjects, or content. Use only what is in
  "inspected.clusters", "inspected.awaitedTopics", "inspected.vipSenders",
  "importantRecent", or "awaited".
- The user JSON always includes "inspected" and "senderDirectory". Never say
  that counts, clusters, or directories were not provided.
- "learnedImportantCategories" is a hint of categories the user has cared about
  before. Prefer surfacing those if multiple equally-strong candidates exist.
- "senderDirectory" tells you, for every recurring sender in this window, what
  kind they are: "company" = marketing / brand mail, "newsletter" = digest,
  "transactional" = receipts/billing, "notification" = automated system mail,
  "person" = a human, "unknown" = we don't know yet.
  Trust the directory: a sender flagged "company" is NOT a personal contact,
  even if the body lacks the word "광고" or "promotion". When describing a
  cluster, prefer the affiliation/kind from senderDirectory over the raw
  category bucket — e.g. say "쿠팡·11번가의 마케팅 메일" rather than "개인 메일".
  If a cluster labeled "personal" contains only senders whose kind is
  "company"/"newsletter"/"notification", call it out as low-signal in the
  reasoning rather than pretending it is real personal mail.

You MUST output a single JSON object with this exact schema:
{
  "highlights": [
    {
      "emailId": string,
      "threadId": string,
      "from": string,
      "subject": string,
      "oneLineSummary": string,
      "whyItMatters": [ <one of the structured reason objects passed in> ]
    }
  ],
  "attentionAreas": [string],
  "toneNote": string,
  "reasoning": string,
  "memoryProposals": [
    {
      "action": "increase_importance" | "decrease_importance" |
                "add_topic_tag" | "flag_awaited_reply" | "resolve_awaited_reply",
      "targetContact"?: string,
      "targetThreadId"?: string,
      "delta"?: number,
      "topic"?: string,
      "reasonType": string
    }
  ]
}${BRIEFING_SYSTEM_TRIAGE_PLACEHOLDER}

Rules for memoryProposals:
- Never propose mark_vip or unmark_vip (those are user-only).
- Keep delta within ±10.
- Do not produce more than 5 proposals per briefing.
- reasonType must be a short snake_case code (e.g. "repeated_research_thread").
`;

export const BRIEFING_SYSTEM_PROMPT = BRIEFING_SYSTEM_PROMPT_BODY.replace(
  BRIEFING_SYSTEM_TRIAGE_PLACEHOLDER,
  BRIEFING_SYSTEM_TRIAGE_SCHEMA,
);

/** Cloud v1.2: briefing + sparse triage overrides only. */
export const BRIEFING_SYSTEM_PROMPT_CLOUD_SPARSE = BRIEFING_SYSTEM_PROMPT_BODY.replace(
  BRIEFING_SYSTEM_TRIAGE_PLACEHOLDER,
  BRIEFING_SYSTEM_TRIAGE_SPARSE_SCHEMA,
);

/** Managed local: briefing prose only — triage is rule-based, not model output. */
export const BRIEFING_SYSTEM_PROMPT_BRIEFING_ONLY = BRIEFING_SYSTEM_PROMPT_BODY.replace(
  BRIEFING_SYSTEM_TRIAGE_PLACEHOLDER,
  '\n}',
);

export type BriefingPromptOptions = {
  /** Smaller JSON for local llama-server (fits context; inspected first). */
  compact?: boolean;
  /** Max unread rows serialized into the prompt (full input kept for fallback). */
  unreadCap?: number;
  /** When false, omit triage rows — triage handled by rules, not the model. */
  triageInPrompt?: boolean;
  /** Cloud sparse: only ambiguous rows (includes ruleDefault per row). */
  ambiguousForTriage?: AmbiguousTriagePromptRow[];
};

function clampSubject(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function compactInspected(input: BriefingInput['inspected']) {
  return {
    totalScanned: input.totalScanned,
    importantReviewed: input.importantReviewed,
    awaitedTracked: input.awaitedTracked,
    vipMessages: input.vipMessages,
    byCategory: input.byCategory,
    clusters: (input.clusters ?? []).map((c) => ({
      category: c.category,
      count: c.count,
      topSenders: c.topSenders.slice(0, 2),
      sampleSubjects: c.sampleSubjects.slice(0, 2),
    })),
    vipSenders: (input.vipSenders ?? []).slice(0, 6),
    awaitedTopics: (input.awaitedTopics ?? []).slice(0, 5),
  };
}

function mapUnreadForPrompt(
  input: BriefingInput,
  unreadCap: number,
): Array<{
  emailId: string;
  threadId: string;
  from: string;
  subject: string;
  cat: string;
  pri: string;
}> {
  return input.unreadForTriage.slice(0, unreadCap).map((e) => ({
    emailId: e.id,
    threadId: e.threadId,
    from: e.from,
    subject: clampSubject(e.subject, 72),
    cat: e.category,
    pri: e.priority,
  }));
}

export function buildBriefingUserPrompt(
  input: BriefingInput,
  opts?: BriefingPromptOptions,
): string {
  const compact = opts?.compact === true;
  const triageInPrompt = opts?.triageInPrompt !== false;
  const unreadCap = opts?.unreadCap ?? input.unreadForTriage.length;
  const ambiguous = opts?.ambiguousForTriage;
  const triagePayload =
    ambiguous && ambiguous.length > 0
      ? {
          ambiguousForTriage: ambiguous,
          ruleTriageCount: input.unreadForTriage.length,
          triageWithinDays: input.triageWithinDays,
          unreadInScope: input.unreadInScope,
        }
      : {
          unreadForTriage: mapUnreadForPrompt(input, unreadCap),
          triageWithinDays: input.triageWithinDays,
          unreadInScope: input.unreadInScope,
        };
  const payload = compact
    ? {
        outputLanguage: input.outputLanguage,
        inspected: compactInspected(input.inspected),
        senderDirectory: input.senderDirectory.slice(0, 16),
        learnedImportantCategories: input.learnedImportantCategories,
        importantRecent: input.importantRecent.slice(0, 12).map((e) => ({
          id: e.id,
          threadId: e.threadId,
          from: e.from,
          subject: clampSubject(e.subject, 72),
          category: e.category,
          reasons: e.reasons.slice(0, 3),
        })),
        awaited: input.awaited.slice(0, 8),
        vipContacts: input.vipContacts.slice(0, 12),
        userPrimaryEmail: input.userPrimaryEmail,
        mailProcessScope: {
          unreadInScope: input.unreadInScope,
          triageWithinDays: input.triageWithinDays,
          triagedThisPass: input.unreadForTriage.length,
        },
        ...(triageInPrompt ? triagePayload : {}),
      }
    : {
        outputLanguage: input.outputLanguage,
        generatedAt: input.generatedAt,
        userPrimaryEmail: input.userPrimaryEmail,
        importantRecent: input.importantRecent,
        awaited: input.awaited,
        vipContacts: input.vipContacts,
        inspected: input.inspected,
        learnedImportantCategories: input.learnedImportantCategories,
        senderDirectory: input.senderDirectory,
        ...(triageInPrompt
          ? {
              unreadForTriage: input.unreadForTriage,
              triageWithinDays: input.triageWithinDays,
            }
          : {}),
      };
  return compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
}
