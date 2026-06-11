/**
 * Mail triage: finalize AI group assignments and deterministic fallback.
 */

import { NON_IMPORTANT_CATEGORIES } from '@main/modules/rules/categorize';
import type {
  AppLanguage,
  EmailCategory,
  NotificationPriority,
  TriageGroupId,
  TriageGroups,
  TriageItem,
} from '@shared/types';
import type { BriefingInput } from './provider';

export type UnreadTriageRow = BriefingInput['unreadForTriage'][number];

export type TriageOverride = {
  emailId: string;
  group: TriageGroupId;
  reason?: string;
};

export type AmbiguousTriagePromptRow = {
  emailId: string;
  threadId: string;
  from: string;
  subject: string;
  cat: string;
  pri: string;
  ruleDefault: TriageGroupId;
};

const MAX_PER_GROUP = 60;
const REASON_LIMIT = 120;
const SUBJECT_CLAMP = 72;

/** Deterministic triage from rules only (no model). */
export function buildRuleTriageGroups(
  input: BriefingInput,
  unreadInScope: number,
): TriageGroups {
  return finalizeTriageGroups(undefined, input, unreadInScope);
}

export function finalizeTriageGroups(
  aiGroups: Partial<Record<TriageGroupId, TriageItem[]>> | undefined,
  input: BriefingInput,
  unreadInScope: number,
): TriageGroups {
  const pool = new Map(input.unreadForTriage.map((e) => [e.id, e]));
  const assigned = new Set<string>();
  const out: Record<TriageGroupId, TriageItem[]> = {
    now: [],
    today: [],
    later: [],
  };

  const lang = input.outputLanguage;

  for (const groupId of ['now', 'today', 'later'] as const) {
    const items = aiGroups?.[groupId] ?? [];
    for (const item of items) {
      if (out[groupId].length >= MAX_PER_GROUP) break;
      if (!pool.has(item.emailId) || assigned.has(item.emailId)) continue;
      const row = pool.get(item.emailId)!;
      assigned.add(item.emailId);
      out[groupId].push(enrichItem(item, row, lang));
    }
  }

  for (const row of input.unreadForTriage) {
    if (assigned.has(row.id)) continue;
    const groupId = fallbackGroup(row);
    if (out[groupId].length >= MAX_PER_GROUP) continue;
    assigned.add(row.id);
    out[groupId].push({
      emailId: row.id,
      threadId: row.threadId,
      from: row.from,
      subject: row.subject,
      reason: fallbackReason(row, groupId, lang),
    });
  }

  return {
    scope: {
      withinDays: input.triageWithinDays,
      unreadInScope,
      triagedCount: assigned.size,
    },
    now: out.now,
    today: out.today,
    later: out.later,
  };
}

function enrichItem(
  partial: TriageItem,
  row: UnreadTriageRow,
  lang: AppLanguage,
): TriageItem {
  const groupGuess =
    partial.reason?.trim() ? 'today' : fallbackGroup(row);
  return {
    emailId: partial.emailId,
    threadId: partial.threadId || row.threadId,
    from: partial.from?.trim() ? partial.from : row.from,
    subject: partial.subject?.trim() ? partial.subject : row.subject,
    reason: clampStr(
      partial.reason?.trim() || fallbackReason(row, groupGuess, lang),
      REASON_LIMIT,
    ),
  };
}

/** Rule bucket before any model override (exported for cloud sparse prompts). */
export function ruleGroupFor(row: UnreadTriageRow): TriageGroupId {
  return fallbackGroup(row);
}

/** Rows the rule engine is uncertain about — cloud model may override only these. */
export function isAmbiguousTriageRow(row: UnreadTriageRow): boolean {
  if (row.priority === 'HIGH') return false;
  if (row.reasons.includes('awaited_reply') || row.reasons.includes('vip_sender')) {
    return false;
  }
  if (NON_IMPORTANT_CATEGORIES.has(row.category as EmailCategory)) return false;
  if (row.priority === 'LOW' && row.importanceScore < 20) return false;
  return true;
}

export function listAmbiguousTriageRows(input: BriefingInput): UnreadTriageRow[] {
  return input.unreadForTriage.filter(isAmbiguousTriageRow);
}

export function buildAmbiguousTriagePromptRows(
  input: BriefingInput,
): AmbiguousTriagePromptRow[] {
  return listAmbiguousTriageRows(input).map((e) => ({
    emailId: e.id,
    threadId: e.threadId,
    from: e.from,
    subject: clampSubject(e.subject, SUBJECT_CLAMP),
    cat: e.category,
    pri: e.priority,
    ruleDefault: ruleGroupFor(e),
  }));
}

/** Apply sparse model overrides on top of a rule-sorted baseline. */
export function applyTriageOverrides(
  base: TriageGroups,
  overrides: TriageOverride[],
  input: BriefingInput,
): TriageGroups {
  if (overrides.length === 0) return base;

  const pool = new Map(input.unreadForTriage.map((e) => [e.id, e]));
  const lang = input.outputLanguage;
  const out: Record<TriageGroupId, TriageItem[]> = {
    now: [...base.now],
    today: [...base.today],
    later: [...base.later],
  };

  const removeFrom = (emailId: string) => {
    for (const groupId of ['now', 'today', 'later'] as const) {
      out[groupId] = out[groupId].filter((i) => i.emailId !== emailId);
    }
  };

  for (const ov of overrides) {
    const row = pool.get(ov.emailId);
    if (!row) continue;
    if (ov.group !== 'now' && ov.group !== 'today' && ov.group !== 'later') continue;
    removeFrom(ov.emailId);
    const reason = ov.reason?.trim()
      ? clampStr(ov.reason, REASON_LIMIT)
      : fallbackReason(row, ov.group, lang);
    if (out[ov.group].length >= MAX_PER_GROUP) continue;
    out[ov.group].push({
      emailId: row.id,
      threadId: row.threadId,
      from: row.from,
      subject: row.subject,
      reason,
    });
  }

  const triagedCount = out.now.length + out.today.length + out.later.length;
  return {
    scope: { ...base.scope, triagedCount },
    now: out.now,
    today: out.today,
    later: out.later,
  };
}

function fallbackGroup(row: UnreadTriageRow): TriageGroupId {
  if (row.priority === 'HIGH') return 'now';
  if (row.reasons.includes('awaited_reply')) return 'now';
  if (row.reasons.includes('vip_sender')) return 'now';
  if (NON_IMPORTANT_CATEGORIES.has(row.category as EmailCategory)) return 'later';
  if (row.priority === 'LOW' && row.importanceScore < 20) return 'later';
  if (row.priority === 'MEDIUM') return 'today';
  return 'today';
}

function fallbackReason(
  row: UnreadTriageRow,
  group: TriageGroupId,
  lang: AppLanguage,
): string {
  const ko = lang === 'ko';
  if (group === 'now') {
    if (row.reasons.includes('awaited_reply')) {
      return ko ? '답장 대기 중인 스레드' : 'Awaited reply thread';
    }
    if (row.reasons.includes('vip_sender')) {
      return ko ? 'VIP 발신' : 'VIP sender';
    }
    return ko ? '우선 확인 신호' : 'Priority signal';
  }
  if (group === 'later') {
    return ko ? '참고·낮은 신호' : 'Low-signal / reference';
  }
  return ko ? '오늘 안에 확인' : 'Review today';
}

function clampStr(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function clampSubject(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
