/**
 * Briefing JSON parser & sanitizer.
 *
 * The AI's output is treated as untrusted input. We:
 *   - Try to extract a JSON object even if surrounding prose slipped in.
 *   - Drop unknown fields / clamp lengths.
 *   - Cross-check `emailId` and `threadId` against the input set; any
 *     hallucinated reference is dropped.
 *   - Cap counts (highlights, proposals, etc).
 *
 * This is the boundary that keeps the trust-first promise: anything the AI
 * produces is filtered through here before it reaches storage or UI.
 */

import type {
  AiProviderId,
  BriefingHighlight,
  ImportanceReason,
  MemoryProposal,
  MorningBriefing,
  TriageGroupId,
  TriageItem,
} from '@shared/types';
import type { BriefingInput } from './provider';
import {
  applyTriageOverrides,
  buildRuleTriageGroups,
  finalizeTriageGroups,
  listAmbiguousTriageRows,
  type TriageOverride,
} from './triage';
import type { TriageGroups } from '@shared/types';

const MAX_HIGHLIGHTS = 8;
const MAX_PROPOSALS = 5;
const MAX_ATTENTION = 3;
const TONE_NOTE_LIMIT = 110;
const REASONING_LIMIT = 320;

interface RawPayload {
  highlights?: unknown;
  attentionAreas?: unknown;
  toneNote?: unknown;
  reasoning?: unknown;
  memoryProposals?: unknown;
  triageGroups?: unknown;
  triageOverrides?: unknown;
}

interface RawTriageOverride {
  emailId?: unknown;
  group?: unknown;
  reason?: unknown;
}

interface RawTriageItem {
  emailId?: unknown;
  threadId?: unknown;
  reason?: unknown;
}

interface RawTriageGroups {
  now?: unknown;
  today?: unknown;
  later?: unknown;
}

interface RawHighlight {
  emailId?: unknown;
  threadId?: unknown;
  from?: unknown;
  subject?: unknown;
  oneLineSummary?: unknown;
  whyItMatters?: unknown;
}

interface RawProposal {
  action?: unknown;
  targetContact?: unknown;
  targetThreadId?: unknown;
  delta?: unknown;
  topic?: unknown;
  reasonType?: unknown;
}

export function parseBriefingPayload(
  text: string,
  input: BriefingInput,
  generatedBy: AiProviderId,
): { briefing: MorningBriefing; proposals: MemoryProposal[] } {
  const raw = safeJson(text);
  const emailIdSet = new Set(input.importantRecent.map((e) => e.id));
  const threadIdSet = new Set([
    ...input.importantRecent.map((e) => e.threadId),
    ...input.awaited.map((a) => a.threadId),
  ]);
  const unreadIdSet = new Set(input.unreadForTriage.map((e) => e.id));
  const unreadThreadSet = new Set(input.unreadForTriage.map((e) => e.threadId));

  const highlights = sanitizeHighlights(raw.highlights, emailIdSet, threadIdSet);
  const attentionAreas = sanitizeAttention(raw.attentionAreas);
  const toneNote = sanitizeToneNote(raw.toneNote);
  const reasoning = sanitizeReasoning(raw.reasoning);
  const proposals = sanitizeProposals(raw.memoryProposals, threadIdSet);
  const triage = resolveTriage(
    generatedBy,
    raw,
    input,
    unreadIdSet,
    unreadThreadSet,
  );

  const briefing: MorningBriefing = {
    generatedAt: input.generatedAt,
    generatedBy,
    highlights,
    awaited: input.awaited.map((a) => ({
      ...a,
      status: 'waiting',
      reason: 'auto_inferred',
    })),
    attentionAreas,
    toneNote,
    reasoning,
    inspected: input.inspected,
    triage,
  };

  return { briefing, proposals };
}

function sanitizeReasoning(v: unknown): string {
  const s = asString(v) ?? '';
  return clampStr(s.replace(/\s+/g, ' ').trim(), REASONING_LIMIT);
}

function safeJson(text: string): RawPayload {
  if (!text) return {};
  try {
    return JSON.parse(text) as RawPayload;
  } catch {
    // try to extract a JSON object from prose
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as RawPayload;
      } catch {
        return {};
      }
    }
    return {};
  }
}

function sanitizeHighlights(
  v: unknown,
  emailIds: Set<string>,
  threadIds: Set<string>,
): BriefingHighlight[] {
  if (!Array.isArray(v)) return [];
  const out: BriefingHighlight[] = [];
  for (const item of v) {
    if (out.length >= MAX_HIGHLIGHTS) break;
    if (!isObj(item)) continue;
    const r = item as RawHighlight;
    const emailId = asString(r.emailId);
    const threadId = asString(r.threadId);
    if (!emailId || !threadId) continue;
    if (!emailIds.has(emailId) || !threadIds.has(threadId)) continue; // anti-hallucination
    out.push({
      emailId,
      threadId,
      from: clampStr(asString(r.from) ?? '', 120),
      subject: clampStr(asString(r.subject) ?? '(no subject)', 200),
      oneLineSummary: clampStr(asString(r.oneLineSummary) ?? '', 180),
      whyItMatters: sanitizeReasons(r.whyItMatters),
    });
  }
  return out;
}

function sanitizeReasons(v: unknown): ImportanceReason[] {
  if (!Array.isArray(v)) return [];
  const out: ImportanceReason[] = [];
  for (const r of v) {
    if (out.length >= 5) break;
    if (!isObj(r)) continue;
    const kind = asString((r as { kind?: unknown }).kind);
    if (!kind) continue;
    switch (kind) {
      case 'vip_sender':
      case 'frequent_correspondent': {
        const contact = asString((r as { contact?: unknown }).contact);
        if (contact) out.push({ kind, contact });
        break;
      }
      case 'awaited_reply': {
        const threadId = asString((r as { threadId?: unknown }).threadId);
        if (threadId) out.push({ kind, threadId });
        break;
      }
      case 'priority_keyword': {
        const keyword = asString((r as { keyword?: unknown }).keyword);
        if (keyword) out.push({ kind, keyword });
        break;
      }
      case 'direct_to_user':
      case 'first_contact_unknown':
        out.push({ kind });
        break;
      default:
        continue;
    }
  }
  return out;
}

function sanitizeAttention(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = asString(item);
    if (!s) continue;
    out.push(clampStr(s, 140));
    if (out.length >= MAX_ATTENTION) break;
  }
  return out;
}

function sanitizeToneNote(v: unknown): string {
  const s = asString(v) ?? '';
  return clampStr(s.replace(/[\n\r]+/g, ' '), TONE_NOTE_LIMIT);
}

function resolveTriage(
  generatedBy: AiProviderId,
  raw: RawPayload,
  input: BriefingInput,
  unreadIds: Set<string>,
  unreadThreads: Set<string>,
): TriageGroups {
  if (generatedBy === 'local') {
    return buildRuleTriageGroups(input, input.unreadInScope);
  }

  const ruleBase = buildRuleTriageGroups(input, input.unreadInScope);
  const ambiguousIds = new Set(listAmbiguousTriageRows(input).map((r) => r.id));
  const overrides = sanitizeTriageOverrides(raw.triageOverrides, ambiguousIds);

  if (raw.triageOverrides !== undefined || overrides.length > 0) {
    return applyTriageOverrides(ruleBase, overrides, input);
  }

  // Legacy: full triageGroups from older prompts / model habit.
  const aiTriage = sanitizeTriageGroups(
    raw.triageGroups,
    unreadIds,
    unreadThreads,
    input,
  );
  const hasAiBuckets =
    (aiTriage.now?.length ?? 0) +
      (aiTriage.today?.length ?? 0) +
      (aiTriage.later?.length ?? 0) >
    0;
  if (hasAiBuckets) {
    return finalizeTriageGroups(aiTriage, input, input.unreadInScope);
  }

  return ruleBase;
}

function sanitizeTriageOverrides(
  v: unknown,
  ambiguousIds: Set<string>,
): TriageOverride[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: TriageOverride[] = [];
  for (const item of v) {
    if (!isObj(item)) continue;
    const r = item as RawTriageOverride;
    const emailId = asString(r.emailId);
    const group = asString(r.group);
    if (!emailId || !group) continue;
    if (!ambiguousIds.has(emailId) || seen.has(emailId)) continue;
    if (group !== 'now' && group !== 'today' && group !== 'later') continue;
    seen.add(emailId);
    const reason = asString(r.reason);
    out.push({
      emailId,
      group,
      ...(reason ? { reason: clampStr(reason, 80) } : {}),
    });
    if (out.length >= ambiguousIds.size) break;
  }
  return out;
}

function sanitizeTriageGroups(
  v: unknown,
  unreadIds: Set<string>,
  unreadThreads: Set<string>,
  input: BriefingInput,
): Partial<Record<TriageGroupId, TriageItem[]>> {
  if (!isObj(v)) return {};
  const raw = v as RawTriageGroups;
  const pool = new Map(input.unreadForTriage.map((e) => [e.id, e]));
  const out: Partial<Record<TriageGroupId, TriageItem[]>> = {};

  for (const groupId of ['now', 'today', 'later'] as const) {
    const list = raw[groupId];
    if (!Array.isArray(list)) continue;
    const items: TriageItem[] = [];
    for (const entry of list) {
      if (!isObj(entry)) continue;
      const r = entry as RawTriageItem;
      const emailId = asString(r.emailId);
      const threadId = asString(r.threadId);
      if (!emailId || !threadId) continue;
      if (!unreadIds.has(emailId) || !unreadThreads.has(threadId)) continue;
      const row = pool.get(emailId);
      if (!row || row.threadId !== threadId) continue;
      items.push({
        emailId,
        threadId,
        from: row.from,
        subject: row.subject,
        reason: clampStr(asString(r.reason) ?? '', 80),
      });
    }
    out[groupId] = items;
  }
  return out;
}

function sanitizeProposals(
  v: unknown,
  threadIds: Set<string>,
): MemoryProposal[] {
  if (!Array.isArray(v)) return [];
  const out: MemoryProposal[] = [];
  const allowed: ReadonlySet<string> = new Set([
    'increase_importance',
    'decrease_importance',
    'add_topic_tag',
    'flag_awaited_reply',
    'resolve_awaited_reply',
  ]);
  for (const item of v) {
    if (out.length >= MAX_PROPOSALS) break;
    if (!isObj(item)) continue;
    const r = item as RawProposal;
    const action = asString(r.action);
    if (!action || !allowed.has(action)) continue;
    const proposal: MemoryProposal = {
      action: action as MemoryProposal['action'],
      reasonType: clampStr(asString(r.reasonType) ?? 'ai', 60),
    };
    const targetContact = asString(r.targetContact);
    if (targetContact) proposal.targetContact = targetContact.toLowerCase();
    const targetThreadId = asString(r.targetThreadId);
    if (targetThreadId) {
      if (!threadIds.has(targetThreadId)) continue;
      proposal.targetThreadId = targetThreadId;
    }
    if (typeof r.delta === 'number' && Number.isFinite(r.delta)) {
      proposal.delta = Math.max(-10, Math.min(10, Math.round(r.delta)));
    }
    const topic = asString(r.topic);
    if (topic) proposal.topic = clampStr(topic.toLowerCase(), 40);
    out.push(proposal);
  }
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function clampStr(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
