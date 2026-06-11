/**
 * Estimates briefing prompt/output token burden (char÷3 heuristic, same as localBriefingBudget).
 * Run: node scripts/estimate-briefing-tokens.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const promptsSrc = readFileSync(join(root, 'electron/modules/ai/prompts.ts'), 'utf8');

function extractSystemPrompt(src) {
  const m = src.match(/export const BRIEFING_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (!m) throw new Error('BRIEFING_SYSTEM_PROMPT not found');
  return m[1];
}

function est(text) {
  return Math.ceil(text.length / 3);
}

function mockEmail(i, withSnippet = true) {
  return {
    id: `msg_${String(i).padStart(18, '0')}`,
    threadId: `thr_${String(i).padStart(18, '0')}`,
    from: `sender${i % 12}@example-brand.co.kr`,
    subject: `제목 샘플 ${i} — 주문 확인 및 배송 안내 메일`,
    snippet: withSnippet
      ? '안녕하세요. 주문하신 상품이 발송되었습니다. 배송 조회는 아래 링크에서 확인하실 수 있습니다.'
      : undefined,
    receivedAt: Date.now() - i * 3600_000,
    importanceScore: 0.2 + (i % 5) * 0.1,
    category: ['promotions', 'notifications', 'personal', 'work'][i % 4],
    reasons: ['bulk_sender', 'low_engagement'],
    priority: 'LOW',
  };
}

function mockInput(unreadCount, withSnippet = true) {
  const unread = Array.from({ length: unreadCount }, (_, i) => mockEmail(i, withSnippet));
  return {
    generatedAt: Date.now(),
    outputLanguage: 'ko',
    userPrimaryEmail: 'user@gmail.com',
    importantRecent: Array.from({ length: 15 }, (_, i) => mockEmail(100 + i, withSnippet)),
    awaited: [
      {
        threadId: 'thr_await_1',
        contact: 'colleague@work.com',
        subject: 'Re: 프로젝트 일정',
        sentAt: Date.now() - 86400_000,
        expectedByMinutes: 1440,
      },
    ],
    vipContacts: ['boss@company.com', 'partner@startup.io'],
    inspected: {
      totalScanned: 120,
      importantReviewed: 15,
      awaitedTracked: 1,
      vipMessages: 2,
      byCategory: { promotions: 40, notifications: 30, personal: 20, work: 10 },
      clusters: Array.from({ length: 6 }, (_, i) => ({
        category: ['promotions', 'notifications', 'personal'][i % 3],
        count: 10 + i,
        topSenders: [`brand${i}@shop.com`, `notify${i}@service.io`],
        sampleSubjects: [`샘플 제목 A${i}`, `샘플 제목 B${i}`],
      })),
      vipSenders: [{ email: 'boss@company.com', count: 2 }],
      awaitedTopics: [{ threadId: 'thr_await_1', subject: 'Re: 프로젝트 일정' }],
    },
    learnedImportantCategories: ['work', 'personal'],
    senderDirectory: Array.from({ length: 20 }, (_, i) => ({
      email: `sender${i}@example.com`,
      kind: ['company', 'newsletter', 'person', 'notification'][i % 4],
      affiliation: i % 2 === 0 ? 'Example Corp' : null,
      confidence: 0.7,
      recentCount: 3 + (i % 4),
    })),
    unreadForTriage: unread,
    triageWithinDays: 7,
    unreadInScope: unreadCount,
  };
}

function clampSubject(s, n) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function buildUserLegacy(input) {
  const payload = {
    outputLanguage: input.outputLanguage,
    generatedAt: input.generatedAt,
    userPrimaryEmail: input.userPrimaryEmail,
    importantRecent: input.importantRecent,
    awaited: input.awaited,
    vipContacts: input.vipContacts,
    inspected: input.inspected,
    learnedImportantCategories: input.learnedImportantCategories,
    senderDirectory: input.senderDirectory,
  };
  return JSON.stringify(payload, null, 2);
}

function buildUserCloudTriage(input) {
  const payload = {
    outputLanguage: input.outputLanguage,
    generatedAt: input.generatedAt,
    userPrimaryEmail: input.userPrimaryEmail,
    importantRecent: input.importantRecent,
    awaited: input.awaited,
    vipContacts: input.vipContacts,
    inspected: input.inspected,
    learnedImportantCategories: input.learnedImportantCategories,
    senderDirectory: input.senderDirectory,
    unreadForTriage: input.unreadForTriage,
    triageWithinDays: input.triageWithinDays,
  };
  return JSON.stringify(payload, null, 2);
}

function buildUserLocalCompact(input, unreadCap) {
  const compactInspected = {
    totalScanned: input.inspected.totalScanned,
    importantReviewed: input.inspected.importantReviewed,
    awaitedTracked: input.inspected.awaitedTracked,
    vipMessages: input.inspected.vipMessages,
    byCategory: input.inspected.byCategory,
    clusters: input.inspected.clusters.map((c) => ({
      category: c.category,
      count: c.count,
      topSenders: c.topSenders.slice(0, 2),
      sampleSubjects: c.sampleSubjects.slice(0, 2),
    })),
    vipSenders: input.inspected.vipSenders.slice(0, 6),
    awaitedTopics: input.inspected.awaitedTopics.slice(0, 5),
  };
  const payload = {
    outputLanguage: input.outputLanguage,
    inspected: compactInspected,
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
    unreadForTriage: input.unreadForTriage.slice(0, unreadCap).map((e) => ({
      emailId: e.id,
      threadId: e.threadId,
      from: e.from,
      subject: clampSubject(e.subject, 72),
      cat: e.category,
      pri: e.priority,
    })),
    triageWithinDays: input.triageWithinDays,
    unreadInScope: input.unreadInScope,
  };
  return JSON.stringify(payload);
}

function mockOutputLegacy() {
  return JSON.stringify({
    highlights: [],
    attentionAreas: ['배송 알림 2건'],
    toneNote: '오늘은 긴급한 회신이 없어 보입니다.',
    reasoning: '최근 24통을 살펴봤어요. 광고·알림 위주였고 우선 신호는 없었습니다.',
    memoryProposals: [],
  });
}

function mockOutputTriage(n) {
  const bucket = (start) =>
    Array.from({ length: Math.ceil(n / 3) }, (_, i) => ({
      emailId: `msg_${String(start + i).padStart(18, '0')}`,
      threadId: `thr_${String(start + i).padStart(18, '0')}`,
      reason: i % 2 === 0 ? '프로모션·뉴스레터' : '자동 알림',
    }));
  return JSON.stringify({
    highlights: [],
    attentionAreas: [],
    toneNote: '오늘은 긴급한 회신이 없어 보입니다.',
    reasoning: '최근 미읽음을 3그룹으로 나눴습니다.',
    memoryProposals: [],
    triageGroups: {
      now: bucket(0).slice(0, 3),
      today: bucket(10).slice(0, 8),
      later: bucket(20).slice(0, Math.max(0, n - 11)),
    },
  });
}

const systemFull = extractSystemPrompt(promptsSrc);
const systemLegacy = systemFull.replace(
  /,\s*"triageGroups":[\s\S]*?Rules for triageGroups:[\s\S]*?If unreadForTriage is empty, return empty arrays for all three buckets\.\s*/,
  '\n',
);

const scenarios = [
  { label: 'legacy (pre-triage)', unread: 0, system: systemLegacy },
  { label: 'cloud triage 40 unread', unread: 40, system: systemFull },
  { label: 'cloud triage 80 unread', unread: 80, system: systemFull },
  { label: 'local compact 40 unread', unread: 40, system: systemFull, local: true },
];

console.log('CalmMail briefing token estimate (char÷3)\n');
console.log('| Scenario | System | User | Input total | Output (est.) | Request total |');
console.log('|----------|--------|------|-------------|---------------|---------------|');

for (const s of scenarios) {
  const input = mockInput(s.unread, true);
  const user =
    s.unread === 0
      ? buildUserLegacy(input)
      : s.local
        ? buildUserLocalCompact(input, 40)
        : buildUserCloudTriage(input);
  const sys = s.system;
  const sysT = est(sys);
  const userT = est(user);
  const inT = sysT + userT;
  const outT = est(s.unread === 0 ? mockOutputLegacy() : mockOutputTriage(s.unread));
  const total = inT + outT;
  console.log(
    `| ${s.label} | ${sysT} | ${userT} | ${inT} | ${outT} | ${total} |`,
  );
}

const gptMiniIn = 0.15;
const gptMiniOut = 0.6;
const cloud40 = scenarios.find((s) => s.label === 'cloud triage 40 unread');
const legacy = scenarios.find((s) => s.label === 'legacy (pre-triage)');
const in40 = mockInput(40);
const user40 = buildUserCloudTriage(in40);
const user0 = buildUserLegacy(mockInput(0));
const inLegacy = est(systemLegacy) + est(user0);
const in40t = est(systemFull) + est(user40);
const outLegacy = est(mockOutputLegacy());
const out40 = est(mockOutputTriage(40));
const costLegacy = (inLegacy / 1e6) * gptMiniIn + (outLegacy / 1e6) * gptMiniOut;
const cost40 = (in40t / 1e6) * gptMiniIn + (out40 / 1e6) * gptMiniOut;

console.log('\nGPT-4o-mini $/request (hosted, illustrative @ $0.15/$0.60 per 1M in/out):');
console.log(`  legacy:  $${costLegacy.toFixed(5)}`);
console.log(`  triage40: $${cost40.toFixed(5)} (+${(((cost40 - costLegacy) / costLegacy) * 100).toFixed(0)}%)`);
