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
  /** Short snippet for disambiguation (cloud / local pass-2). */
  snippet?: string;
  cat: string;
  pri: string;
  ruleDefault: TriageGroupId;
};

const MAX_PER_GROUP = 60;
const SNIPPET_CLAMP = 96;
const RECENT_NOW_MS = 6 * 60 * 60 * 1000;
const RECENT_TODAY_MS = 36 * 60 * 60 * 1000;

export type TriageRuleContext = {
  learnedCategories: Set<EmailCategory>;
  awaitedThreadIds: Set<string>;
  nowMs: number;
};

export function buildTriageRuleContext(input: BriefingInput): TriageRuleContext {
  return {
    learnedCategories: new Set(input.learnedImportantCategories ?? []),
    awaitedThreadIds: new Set(input.awaited.map((a) => a.threadId)),
    nowMs: input.generatedAt,
  };
}
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
  const ctx = buildTriageRuleContext(input);
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
      out[groupId].push(enrichItem(item, row, groupId, lang, ctx));
    }
  }

  for (const row of input.unreadForTriage) {
    if (assigned.has(row.id)) continue;
    const groupId = fallbackGroup(row, ctx);
    if (out[groupId].length >= MAX_PER_GROUP) continue;
    assigned.add(row.id);
    out[groupId].push({
      emailId: row.id,
      threadId: row.threadId,
      from: row.from,
      subject: row.subject,
      reason: fallbackReason(row, groupId, lang, ctx),
    });
  }

  sortTriageBucket(out.now, pool);
  sortTriageBucket(out.today, pool);
  sortTriageBucket(out.later, pool);

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
  groupId: TriageGroupId,
  lang: AppLanguage,
  ctx: TriageRuleContext,
): TriageItem {
  return {
    emailId: partial.emailId,
    threadId: partial.threadId || row.threadId,
    from: partial.from?.trim() ? partial.from : row.from,
    subject: partial.subject?.trim() ? partial.subject : row.subject,
    reason: clampStr(
      partial.reason?.trim() || fallbackReason(row, groupId, lang, ctx),
      REASON_LIMIT,
    ),
  };
}

/** Rule bucket before any model override (exported for cloud sparse prompts). */
export function ruleGroupFor(row: UnreadTriageRow, input: BriefingInput): TriageGroupId {
  return fallbackGroup(row, buildTriageRuleContext(input));
}

/** Rows the rule engine is uncertain about — cloud / local pass-2 may override. */
export function isAmbiguousTriageRow(
  row: UnreadTriageRow,
  input: BriefingInput,
): boolean {
  const ctx = buildTriageRuleContext(input);
  const bucket = fallbackGroup(row, ctx);
  if (row.priority === 'HIGH') return false;
  if (row.reasons.includes('awaited_reply') || row.reasons.includes('vip_sender')) {
    return false;
  }
  if (row.reasons.includes('priority_keyword')) return false;
  if (ctx.awaitedThreadIds.has(row.threadId)) return false;
  if (NON_IMPORTANT_CATEGORIES.has(row.category as EmailCategory)) return false;
  if (row.priority === 'LOW' && row.importanceScore < 20) return false;
  if (
    ctx.learnedCategories.has(row.category as EmailCategory) &&
    row.importanceScore >= 45
  ) {
    return false;
  }
  if (bucket === 'later') return false;
  if (bucket === 'now') return false;
  return true;
}

export function listAmbiguousTriageRows(input: BriefingInput): UnreadTriageRow[] {
  return input.unreadForTriage.filter((r) => isAmbiguousTriageRow(r, input));
}

export function buildAmbiguousTriagePromptRows(
  input: BriefingInput,
): AmbiguousTriagePromptRow[] {
  return listAmbiguousTriageRows(input).map((e) => ({
    emailId: e.id,
    threadId: e.threadId,
    from: e.from,
    subject: clampSubject(e.subject, SUBJECT_CLAMP),
    snippet: clampSubject(e.snippet ?? '', SNIPPET_CLAMP),
    cat: e.category,
    pri: e.priority,
    ruleDefault: ruleGroupFor(e, input),
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

  const ctx = buildTriageRuleContext(input);
  for (const ov of overrides) {
    const row = pool.get(ov.emailId);
    if (!row) continue;
    if (ov.group !== 'now' && ov.group !== 'today' && ov.group !== 'later') continue;
    removeFrom(ov.emailId);
    const reason = ov.reason?.trim()
      ? clampStr(ov.reason, REASON_LIMIT)
      : fallbackReason(row, ov.group, lang, ctx);
    if (out[ov.group].length >= MAX_PER_GROUP) continue;
    out[ov.group].push({
      emailId: row.id,
      threadId: row.threadId,
      from: row.from,
      subject: row.subject,
      reason,
    });
  }

  sortTriageBucket(out.now, pool);
  sortTriageBucket(out.today, pool);
  sortTriageBucket(out.later, pool);

  const triagedCount = out.now.length + out.today.length + out.later.length;
  return {
    scope: { ...base.scope, triagedCount },
    now: out.now,
    today: out.today,
    later: out.later,
  };
}

function sortTriageBucket(
  items: TriageItem[],
  pool: Map<string, UnreadTriageRow>,
): void {
  items.sort((a, b) => {
    const sa = pool.get(a.emailId)?.importanceScore ?? 0;
    const sb = pool.get(b.emailId)?.importanceScore ?? 0;
    if (sb !== sa) return sb - sa;
    const ta = pool.get(a.emailId)?.receivedAt ?? 0;
    const tb = pool.get(b.emailId)?.receivedAt ?? 0;
    return tb - ta;
  });
}

function fallbackGroup(row: UnreadTriageRow, ctx: TriageRuleContext): TriageGroupId {
  if (row.priority === 'HIGH') return 'now';
  if (row.reasons.includes('awaited_reply')) return 'now';
  if (row.reasons.includes('vip_sender')) return 'now';
  if (row.reasons.includes('priority_keyword')) return 'now';
  if (ctx.awaitedThreadIds.has(row.threadId)) return 'now';

  if (NON_IMPORTANT_CATEGORIES.has(row.category as EmailCategory)) return 'later';
  if (row.priority === 'LOW' && row.importanceScore < 20) return 'later';

  const ageMs = ctx.nowMs - row.receivedAt;
  const learned = ctx.learnedCategories.has(row.category as EmailCategory);

  if (learned && row.importanceScore >= 50) return 'now';
  if (row.reasons.includes('direct_to_user') && row.importanceScore >= 35) return 'now';
  if (
    ageMs <= RECENT_NOW_MS &&
    (row.category === 'work' || row.category === 'personal') &&
    row.importanceScore >= 30
  ) {
    return 'now';
  }
  if (row.openCount >= 2 && row.importanceScore >= 25) return 'now';

  if (learned && row.importanceScore >= 28) return 'today';
  if (row.category === 'transactional') return 'today';
  if (row.reasons.includes('frequent_correspondent') && row.priority === 'MEDIUM') {
    return 'today';
  }
  if (ageMs <= RECENT_TODAY_MS && row.importanceScore >= 22) return 'today';
  if (row.priority === 'MEDIUM') return 'today';
  return 'today';
}

function fallbackReason(
  row: UnreadTriageRow,
  group: TriageGroupId,
  lang: AppLanguage,
  ctx: TriageRuleContext,
): string {
  const ko = lang === 'ko';
  if (group === 'now') {
    if (row.reasons.includes('awaited_reply') || ctx.awaitedThreadIds.has(row.threadId)) {
      return ko ? '답장 대기 중인 스레드' : 'Awaited reply thread';
    }
    if (row.reasons.includes('vip_sender')) {
      return ko ? 'VIP 발신' : 'VIP sender';
    }
    if (row.reasons.includes('priority_keyword')) {
      return ko ? '긴급·마감 키워드' : 'Priority keyword';
    }
    if (ctx.learnedCategories.has(row.category as EmailCategory)) {
      return ko ? '자주 보는 유형' : 'Category you care about';
    }
    if (row.openCount >= 2) {
      return ko ? '이미 여러 번 연 관심 메일' : 'Previously opened here';
    }
    return ko ? '우선 확인 신호' : 'Priority signal';
  }
  if (group === 'later') {
    return ko ? '참고·낮은 신호' : 'Low-signal / reference';
  }
  if (row.category === 'transactional') {
    return ko ? '거래·알림 — 오늘 중 확인' : 'Transactional — review today';
  }
  if (row.reasons.includes('first_contact_unknown')) {
    return ko ? '처음 보는 발신 — 오늘 확인' : 'New sender — review today';
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
