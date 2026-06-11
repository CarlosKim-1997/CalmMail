/**
 * Morning briefing orchestrator.
 *
 * This is the *only* place outside the AI module that knows the AI is being
 * invoked. The flow:
 *   1. Gather already-classified important emails + awaited replies (no AI).
 *   2. Compute a deterministic "inspected" summary (counts, categories).
 *   3. Hand both to the active provider.
 *   4. Sanitize the AI's JSON output.
 *   5. Run the validator over AI memory proposals.
 *   6. Persist the briefing and update learned category preferences.
 *
 * Step (5) is the trust boundary: AI proposals never reach storage directly.
 */

import type { BriefingInput, BriefingSenderProfile } from './provider';
import { CloudBriefingLimitError, LocalAiNotReadyError, ProviderNotConfiguredError } from './provider';
import { inspectManagedReadiness } from './providers/managedProvider';
import type {
  BriefingInspectionSummary,
  EmailCategory,
  EmailSummary,
  InspectionCluster,
  InspectionClusterSender,
  MorningBriefing,
  SenderKind,
  SenderProfile,
} from '@shared/types';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';
import { contactsRepo } from '@main/modules/persistence/repositories/contactsRepo';
import { senderProfilesRepo } from '@main/modules/persistence/repositories/senderProfilesRepo';
import { briefingsRepo } from '@main/modules/persistence/repositories/briefingsRepo';
import { sessionMemory } from '@main/modules/memory/session';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { getConnectedEmail } from '@main/modules/gmail/client';
import {
  ensureInboxCachedForBriefing,
  noMailErrorDetail,
} from '@main/modules/gmail/inboxBootstrap';
import { localAiManager } from '@main/modules/localAi/manager';
import { getActiveProvider } from './registry';
import { ruleEngine } from '@main/modules/rules/engine';
import type { ClassifyContext } from '@main/modules/rules/engine';
import { hasPaidFeatures } from '@main/modules/monetization/snapshot';
import { BRIEFING_IMPORTANT_EMAIL_CAP } from '@shared/monetization';
import { isCloudQuotaExceeded } from './quota';
import {
  estimateBriefingDuration,
  snapshotBriefingWorkload,
} from './estimateBriefing';
import type { BriefingDurationEstimate, BriefingProgress } from '@shared/types';
import { briefingPerfMark, briefingPerfStart } from './briefingPerf';
import {
  LOCAL_TRIAGE_UNREAD_AI_CAP,
  TRIAGE_UNREAD_AI_CAP,
  resolveTriageWindowDays,
} from '@shared/triage';
import {
  buildInspectionClusterHint,
  buildTriageScopeReasoning,
} from '@shared/briefingReasoning';

export class AiDisabledError extends Error {
  constructor() {
    super('CALMMAIL_AI_DISABLED');
    this.name = 'AiDisabledError';
  }
}

export class BriefingGmailNotConnectedError extends Error {
  constructor() {
    super('CALMMAIL_BRIEFING_GMAIL_NOT_CONNECTED');
    this.name = 'BriefingGmailNotConnectedError';
  }
}

export class BriefingNoMailError extends Error {
  constructor(detail = 'cache_empty') {
    super(`CALMMAIL_BRIEFING_NO_MAIL:${detail}`);
    this.name = 'BriefingNoMailError';
  }
}

const SCAN_WINDOW_LIMIT = 200;
const LEARNED_CATEGORY_CAP = 5;

export type BriefingProgressSender = (progress: BriefingProgress) => void;

export async function generateMorningBriefing(
  onProgress?: BriefingProgressSender,
): Promise<MorningBriefing> {
  briefingPerfStart();
  const prefs = preferencesMemory.get();
  if (prefs.aiMode === 'off') {
    throw new AiDisabledError();
  }

  const emit = (phase: BriefingProgress['phase'], percent: number, est: BriefingDurationEstimate) => {
    onProgress?.({
      phase,
      percent,
      estimatedTotalMs: est.estimatedMs,
      estimatedMinSec: est.estimatedMinSec,
      estimatedMaxSec: est.estimatedMaxSec,
      totalScanned: est.totalScanned,
      isCloud: est.isCloud,
    });
  };

  const workloadEarly = snapshotBriefingWorkload();
  let estimate = estimateBriefingDuration(workloadEarly, { aiMode: prefs.aiMode });
  emit('prepare', 4, estimate);

  if (prefs.aiMode === 'local') {
    await localAiManager.refresh();
  }

  const provider = getActiveProvider();
  if (!provider.isConfigured()) {
    if (prefs.aiMode === 'local') {
      const readiness = inspectManagedReadiness();
      throw new LocalAiNotReadyError(readiness.reason ?? 'artifacts_missing');
    }
    throw new ProviderNotConfiguredError(provider.id);
  }

  estimate = estimateBriefingDuration(workloadEarly, {
    aiMode: prefs.aiMode,
    isCloud: provider.isCloud,
  });

  // Free-tier guard: only applies to cloud providers; local mode is exempt.
  if (provider.isCloud) {
    const q = isCloudQuotaExceeded();
    if (q.exceeded) {
      throw new CloudBriefingLimitError(q.resetAt, q.limit);
    }
  }

  emit('gather', 10, estimate);

  const inboxSync = await ensureInboxCachedForBriefing();
  if (inboxSync.reason === 'gmail_not_connected') {
    throw new BriefingGmailNotConnectedError();
  }
  if (inboxSync.reason?.startsWith('gmail_list_failed')) {
    throw new BriefingNoMailError('gmail_api');
  }

  const workloadAfterSync = snapshotBriefingWorkload();
  estimate = estimateBriefingDuration(workloadAfterSync, {
    aiMode: prefs.aiMode,
    isCloud: provider.isCloud,
  });
  emit('gather', 14, estimate);

  const importantPool = emailsRepo.important(
    hasPaidFeatures(prefs)
      ? BRIEFING_IMPORTANT_EMAIL_CAP.premium
      : BRIEFING_IMPORTANT_EMAIL_CAP.free,
  );
  const classifyCtx: ClassifyContext = {
    preferences: prefs,
    userPrimaryEmail: getConnectedEmail(),
  };
  const allRecent = reclassifyForInspection(
    emailsRepo.recent(SCAN_WINDOW_LIMIT),
    classifyCtx,
  );
  estimate = estimateBriefingDuration(
    {
      totalScanned: allRecent.length,
      importantPoolSize: importantPool.length,
      awaitedWaiting: 0,
    },
    { aiMode: prefs.aiMode, isCloud: provider.isCloud },
  );
  emit('gather', 22, estimate);
  briefingPerfMark('gather_done', `scanned=${allRecent.length}`);

  const vipContactList = contactsRepo.list().filter((c) => c.isVip);
  const vipContacts = vipContactList.map((c) => c.email);
  const vipSet = new Set(vipContacts.map((e) => e.toLowerCase()));

  const importantRecent = importantPool.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    from: e.from.name ? `${e.from.name} <${e.from.email}>` : e.from.email,
    subject: e.subject,
    snippet: e.snippet,
    receivedAt: e.receivedAt,
    importanceScore: e.importanceScore,
    category: e.category,
    reasons: e.reasons.map((r) => r.kind),
  }));

  const awaited = awaitedRepo.list({ status: 'waiting' }).map((a) => ({
    threadId: a.threadId,
    contact: a.contact,
    subject: a.subject,
    sentAt: a.sentAt,
    expectedByMinutes: a.expectedByMinutes,
  }));

  // Pre-load sender profiles for every distinct from-address in the scan
  // window. The classifier wrote them during polling; here we just read them
  // back to enrich the inspection and feed them to the AI.
  const distinctSenders = Array.from(
    new Set(allRecent.map((e) => e.from.email.toLowerCase())),
  );
  const profileMap = senderProfilesRepo.getMany(distinctSenders);

  const inspected = computeInspection(
    allRecent,
    importantPool,
    awaited.length,
    vipSet,
    awaitedRepo.list({ status: 'waiting' }),
    profileMap,
  );

  emit('inspect', 32, estimate);

  if (allRecent.length === 0) {
    throw new BriefingNoMailError(noMailErrorDetail(inboxSync));
  }

  const senderDirectory = buildSenderDirectory(allRecent, profileMap);

  const triageDays =
    prefs.aiMode === 'local' ? 7 : resolveTriageWindowDays(prefs.triageWindowDays);
  const unreadInScope = emailsRepo.countUnreadWithinDays(triageDays);
  const triageAiCap =
    prefs.aiMode === 'local' ? LOCAL_TRIAGE_UNREAD_AI_CAP : TRIAGE_UNREAD_AI_CAP;
  briefingPerfMark('triage_pool', `unread=${unreadInScope} cap=${triageAiCap}`);
  const unreadPool = reclassifyForInspection(
    emailsRepo.unreadWithinDays(triageDays, triageAiCap),
    classifyCtx,
  );
  const unreadForTriage = unreadPool.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    from: senderLabel(e.from.name, e.from.email),
    subject: e.subject,
    snippet: e.snippet,
    receivedAt: e.receivedAt,
    importanceScore: e.importanceScore,
    category: e.category,
    priority: e.priority,
    reasons: e.reasons.map((r) => r.kind),
    openCount: e.openCount,
  }));

  const input: BriefingInput = {
    generatedAt: Date.now(),
    importantRecent,
    awaited,
    vipContacts,
    userPrimaryEmail: getConnectedEmail(),
    outputLanguage: prefs.language ?? 'ko',
    inspected,
    learnedImportantCategories: prefs.learnedImportantCategories ?? [],
    senderDirectory,
    unreadForTriage,
    triageWithinDays: triageDays,
    unreadInScope,
  };

  emit('ai', 38, estimate);

  // Single round-trip: providers return briefing + (untrusted) proposals
  // together. We then validate proposals through the rule engine before
  // touching memory. This halves cloud cost for free accounts.
  const { briefing, proposals } = await provider.runBriefing(input);
  briefingPerfMark('ai_done', `triageItems=${unreadForTriage.length}`);

  emit('triage', 82, estimate);

  // Defensive: ensure inspected summary is attached even if the provider
  // dropped it (shouldn't happen for current providers).
  briefing.inspected = inspected;

  let appliedCount = 0;
  try {
    const results = ruleEngine.applyProposals(proposals);
    appliedCount = results.filter((r) => r.applied).length;
  } catch {
    // proposals are best-effort; briefing is the primary deliverable
  }

  ensureToneAndReasoning(briefing, prefs.language ?? 'ko', appliedCount);

  // Learn user's category interests from the highlights AI actually surfaced.
  const newLearned = updateLearnedCategories(
    prefs.learnedImportantCategories ?? [],
    briefing.highlights
      .map((h) => importantPool.find((p) => p.id === h.emailId)?.category)
      .filter((c): c is EmailCategory => !!c),
  );
  if (!sameArray(newLearned, prefs.learnedImportantCategories ?? [])) {
    preferencesMemory.patch({ learnedImportantCategories: newLearned });
  }

  emit('finalize', 94, estimate);

  briefingsRepo.insert(briefing);
  sessionMemory.markBriefing(briefing.generatedAt);

  emit('done', 100, estimate);
  briefingPerfMark('complete');
  return briefing;
}

const CLUSTER_CAP = 8;
const CLUSTER_SUBJECT_CAP = 3;
const CLUSTER_SENDER_CAP = 3;
const SUBJECT_CHAR_CAP = 80;
const VIP_SENDER_CAP = 5;
const AWAITED_TOPIC_CAP = 5;

function computeInspection(
  scanned: EmailSummary[],
  important: EmailSummary[],
  awaitedCount: number,
  vipSet: Set<string>,
  awaitedThreads: Array<{ subject: string }>,
  profileMap: Map<string, SenderProfile>,
): BriefingInspectionSummary {
  const byCategory: Partial<Record<EmailCategory, number>> = {};
  let vipMessages = 0;
  const reasonCounts = new Map<string, number>();
  const byCategoryEmails = new Map<EmailCategory, EmailSummary[]>();
  const vipSenderCounts = new Map<string, { label: string; count: number }>();

  for (const e of scanned) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;

    const arr = byCategoryEmails.get(e.category) ?? [];
    arr.push(e);
    byCategoryEmails.set(e.category, arr);

    if (vipSet.has(e.from.email.toLowerCase())) {
      vipMessages += 1;
      const key = e.from.email.toLowerCase();
      const label = senderLabel(e.from.name, e.from.email);
      const cur = vipSenderCounts.get(key);
      if (cur) cur.count += 1;
      else vipSenderCounts.set(key, { label, count: 1 });
    }
    for (const r of e.reasons) {
      reasonCounts.set(r.kind, (reasonCounts.get(r.kind) ?? 0) + 1);
    }
  }

  const triggeredReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind]) => kind)
    .slice(0, 5);

  const clusters: InspectionCluster[] = [...byCategoryEmails.entries()]
    .map(([category, emails]) => buildCluster(category, emails, profileMap))
    .sort((a, b) => b.count - a.count)
    .slice(0, CLUSTER_CAP);

  const awaitedTopics = awaitedThreads
    .map((a) => clamp(a.subject ?? '', SUBJECT_CHAR_CAP))
    .filter((s) => s.length > 0)
    .slice(0, AWAITED_TOPIC_CAP);

  const vipSenders = [...vipSenderCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, VIP_SENDER_CAP)
    .map((v) => v.label);

  return {
    totalScanned: scanned.length,
    importantReviewed: important.length,
    awaitedTracked: awaitedCount,
    vipMessages,
    byCategory,
    triggeredReasons,
    clusters,
    awaitedTopics,
    vipSenders,
  };
}

function buildCluster(
  category: EmailCategory,
  emails: EmailSummary[],
  profileMap: Map<string, SenderProfile>,
): InspectionCluster {
  const senderCounts = new Map<string, InspectionClusterSender>();
  const kindBreakdown: Partial<Record<SenderKind, number>> = {};
  for (const e of emails) {
    const key = e.from.email.toLowerCase();
    const label = senderLabel(e.from.name, e.from.email);
    const cur = senderCounts.get(key);
    if (cur) cur.count += 1;
    else senderCounts.set(key, { label, count: 1 });

    const profileKind = profileMap.get(key)?.kind ?? 'unknown';
    kindBreakdown[profileKind] = (kindBreakdown[profileKind] ?? 0) + 1;
  }
  const topSenders = [...senderCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, CLUSTER_SENDER_CAP);

  // Most-recent first; dedupe by case-insensitive subject prefix.
  const sortedByDate = [...emails].sort((a, b) => b.receivedAt - a.receivedAt);
  const seen = new Set<string>();
  const sampleSubjects: string[] = [];
  for (const e of sortedByDate) {
    const subject = (e.subject ?? '').trim();
    if (!subject) continue;
    const key = subject.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    sampleSubjects.push(clamp(subject, SUBJECT_CHAR_CAP));
    if (sampleSubjects.length >= CLUSTER_SUBJECT_CAP) break;
  }

  return {
    category,
    count: emails.length,
    topSenders,
    sampleSubjects,
    kindBreakdown,
  };
}

/**
 * Compact projection of the per-sender profile cache, scoped to senders that
 * actually appeared in this briefing window. The AI sees this so it can
 * recognise "Coupang, 11st, etc. are company senders" and stop calling them
 * personal. Capped tightly to keep token usage flat.
 */
const SENDER_DIRECTORY_CAP = 24;

function buildSenderDirectory(
  scanned: EmailSummary[],
  profileMap: Map<string, SenderProfile>,
): BriefingSenderProfile[] {
  const seenCount = new Map<string, number>();
  for (const e of scanned) {
    const key = e.from.email.toLowerCase();
    seenCount.set(key, (seenCount.get(key) ?? 0) + 1);
  }
  const rows: BriefingSenderProfile[] = [];
  for (const [email, count] of seenCount.entries()) {
    const p = profileMap.get(email);
    rows.push({
      email,
      kind: p?.kind ?? 'unknown',
      affiliation: p?.affiliation ?? null,
      confidence: p?.confidence ?? 0,
      recentCount: count,
    });
  }
  rows.sort((a, b) => b.recentCount - a.recentCount);
  return rows.slice(0, SENDER_DIRECTORY_CAP);
}

/**
 * Re-derive category + sender profiles for the briefing window and persist
 * fixes so the dashboard stays aligned after the user runs "분석하기".
 */
function reclassifyForInspection(
  emails: EmailSummary[],
  ctx: ClassifyContext,
): EmailSummary[] {
  const out: EmailSummary[] = [];
  for (const email of emails) {
    const next = ruleEngine.reclassifyStored(email, ctx);
    if (
      next.category !== email.category ||
      next.priority !== email.priority ||
      next.importanceScore !== email.importanceScore
    ) {
      emailsRepo.upsert(next);
    }
    out.push(next);
  }
  return out;
}

function senderLabel(name: string | null, email: string): string {
  if (name && name.trim().length > 0) return `${name.trim()} <${email}>`;
  return email;
}

function clamp(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function ensureToneAndReasoning(
  briefing: MorningBriefing,
  lang: 'ko' | 'en',
  appliedCount: number,
): void {
  const ko = lang === 'ko';

  if (!briefing.toneNote) {
    briefing.toneNote =
      appliedCount > 0
        ? ko
          ? '맥락이 조용히 일부 갱신되었습니다.'
          : 'Some context has been quietly updated.'
        : ko
          ? '오늘은 비교적 여유로워 보입니다.'
          : 'Today looks manageable.';
  }

  if (briefing.triage) {
    briefing.reasoning = buildFallbackReasoning(briefing, lang);
  } else if (
    !briefing.reasoning ||
    reasoningLooksDeficient(briefing.reasoning, briefing.inspected)
  ) {
    briefing.reasoning = buildFallbackReasoning(briefing, lang);
  }
}

/** Local models sometimes claim input was missing when context was truncated. */
function reasoningLooksDeficient(
  reasoning: string,
  inspected: BriefingInspectionSummary,
): boolean {
  const text = reasoning.trim();
  if (!text) return true;
  const lower = text.toLowerCase();

  const claimsNoInput =
    /제공되지\s*않|제공되지\s*않았|not\s+provided|not\s+supplied|was\s+not\s+given|no\s+data\s+(was\s+)?provided|senderdirectory|sender\s+directory/i.test(
      text,
    );
  if (claimsNoInput) return true;

  if (inspected.totalScanned > 0) {
    const claimsZeroScan =
      /(?:전체|최근)\s*(?:메일|이메일)?\s*(?:수|건)?\s*(?:이\s*)?(?:없|0)|0\s*(?:통|건|messages?)|zero\s+(?:messages?|emails?)/i.test(
        text,
      );
    if (claimsZeroScan) return true;
    if (
      (lower.includes('inspected') || lower.includes('클러스터') || lower.includes('cluster')) &&
      (lower.includes('없') || lower.includes('missing') || lower.includes('absent'))
    ) {
      return true;
    }
  }
  return false;
}

function buildFallbackReasoning(
  briefing: MorningBriefing,
  lang: 'ko' | 'en',
): string {
  const ins = briefing.inspected;
  if (briefing.triage) {
    const clusterSnippet = buildInspectionClusterHint(ins.clusters, lang);
    return buildTriageScopeReasoning({
      lang,
      scope: briefing.triage.scope,
      highlightCount: briefing.highlights.length,
      awaitedTracked: ins.awaitedTracked,
      clusterSnippet,
    });
  }

  const ko = lang === 'ko';
  const highlightCount = briefing.highlights.length;
  const headline = ko
    ? `최근 ${ins.totalScanned}통을 한 번 훑어봤어요.`
    : `I went through ${ins.totalScanned} recent messages.`;

  if (highlightCount === 0) {
    return headline;
  }

  const vipPart =
    ins.vipMessages > 0
      ? ko
        ? ` VIP 발신자 ${ins.vipMessages}통이 포함돼 있어요.`
        : ` ${ins.vipMessages} from VIPs.`
      : '';
  return (
    (ko
      ? `최근 ${ins.totalScanned}통 중 ${highlightCount}건을 우선순위로 골랐어요.`
      : `Picked ${highlightCount} priority item${highlightCount === 1 ? '' : 's'} from ${ins.totalScanned} recent messages.`) +
    vipPart
  );
}

function describeCluster(c: InspectionCluster, lang: 'ko' | 'en'): string {
  const ko = lang === 'ko';
  const baseLabel = ko ? KO_CATEGORY_LABEL[c.category] : EN_CATEGORY_LABEL[c.category];
  // If we've learned the cluster is dominated by company / newsletter senders,
  // overrule the raw category label so we don't claim "개인 메일 15통" for a
  // bucket that's actually all marketing.
  const catLabel = humanLabelFromKinds(c, baseLabel, lang);
  const senders = c.topSenders.slice(0, 2).map((s) => s.label).join(', ');
  if (ko) {
    return senders
      ? `${catLabel} ${c.count}통(${senders} 등).`
      : `${catLabel} ${c.count}통.`;
  }
  return senders
    ? `${c.count} ${catLabel} (e.g. ${senders}).`
    : `${c.count} ${catLabel}.`;
}

function humanLabelFromKinds(
  c: InspectionCluster,
  fallback: string,
  lang: 'ko' | 'en',
): string {
  const ko = lang === 'ko';
  const breakdown = c.kindBreakdown ?? {};
  const companyCount =
    (breakdown.company ?? 0) +
    (breakdown.newsletter ?? 0) +
    (breakdown.notification ?? 0);
  const personCount = breakdown.person ?? 0;
  const total = c.count;
  if (total === 0) return fallback;
  if (companyCount / total >= 0.6 && c.category === 'personal') {
    return ko ? '마케팅·자동발송 메일(개인 분류 보정됨)' : 'company/automated mail (re-categorised)';
  }
  if (personCount / total >= 0.6 && c.category !== 'personal') {
    return ko ? '개인이 보낸 메일' : 'mail from people';
  }
  return fallback;
}

const KO_CATEGORY_LABEL: Record<EmailCategory, string> = {
  personal: '개인 메일',
  work: '업무 메일',
  transactional: '결제·알림',
  notification: '시스템 알림',
  social: 'SNS 알림',
  newsletter: '뉴스레터',
  promotion: '광고',
  other: '기타',
};

const EN_CATEGORY_LABEL: Record<EmailCategory, string> = {
  personal: 'personal',
  work: 'work',
  transactional: 'transactional',
  notification: 'notification',
  social: 'social',
  newsletter: 'newsletter',
  promotion: 'promotional',
  other: 'other',
};

function updateLearnedCategories(
  prior: EmailCategory[],
  recent: EmailCategory[],
): EmailCategory[] {
  if (recent.length === 0) return prior;
  const counts = new Map<EmailCategory, number>();
  for (const c of prior) counts.set(c, (counts.get(c) ?? 0) + 1);
  for (const c of recent) counts.set(c, (counts.get(c) ?? 0) + 2);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
    .slice(0, LEARNED_CATEGORY_CAP);
}

function sameArray<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
