/**
 * Seeds SQLite + preferences so the renderer shows Home / Briefing / triage
 * without Gmail or IMAP credentials. Enable with CALMMAIL_DEMO_UI=1.
 */

import type { EmailSummary, MorningBriefing } from '@shared/types';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { briefingsRepo } from '@main/modules/persistence/repositories/briefingsRepo';
import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';
import { ruleEngine } from '@main/modules/rules/engine';
import { isDemoUiEnabled } from './demoUiEnv';

const now = Date.now();

function seedEmail(row: EmailSummary, providerMessageId: string): void {
  emailsRepo.upsert(row, {
    provider: 'gmail',
    accountId: 'gmail',
    canonicalId: row.id,
    providerMessageId,
    rfcMessageId: null,
    threadKey: row.threadId,
  });
}

function buildDemoBriefing(): MorningBriefing {
  return {
    generatedAt: now,
    generatedBy: 'openai',
    highlights: [
      {
        emailId: 'demo-msg-1',
        threadId: 'demo-thread-1',
        from: '김민수',
        subject: 'Re: 3월 일정 확인',
        oneLineSummary: '일정 조율 답장이 필요해 보여요.',
        whyItMatters: [{ kind: 'direct_to_user' }],
      },
    ],
    awaited: [
      {
        threadId: 'demo-thread-await',
        contact: 'park@work.example',
        subject: '견적서 검토 부탁드립니다',
        sentAt: now - 2 * 86400_000,
        expectedByMinutes: 2880,
        status: 'waiting',
        reason: 'auto_inferred',
      },
    ],
    attentionAreas: ['답장 대기 1건', '오늘 work 2건'],
    toneNote: '조용한 아침이에요. 우선 확인할 몇 통만 골라 두었어요.',
    inspected: {
      totalScanned: 12,
      importantReviewed: 4,
      awaitedTracked: 1,
      vipMessages: 1,
      byCategory: {
        personal: 3,
        work: 4,
        transactional: 2,
        notification: 2,
        promotion: 1,
        social: 0,
        newsletter: 0,
        other: 0,
      },
      triggeredReasons: ['direct_to_user', 'vip_sender', 'frequent_correspondent'],
      clusters: [
        {
          category: 'work',
          count: 4,
          topSenders: [{ label: '박지영 <park@work.example>', count: 2 }],
          sampleSubjects: ['견적서 검토', 'Re: 3월 일정'],
        },
      ],
      vipSenders: ['CEO <ceo@company.example>'],
      awaitedTopics: ['견적서 검토 (park@work.example)'],
    },
    reasoning:
      '최근 7일 미읽음 12건을 정리했어요. work 쪽에서 답장이 필요한 스레드가 있고, VIP 1건은 지금 확인하는 편이 좋아요.',
    triage: {
      scope: { withinDays: 7, unreadInScope: 12, triagedCount: 8 },
      now: [
        {
          emailId: 'demo-msg-1',
          threadId: 'demo-thread-1',
          from: '김민수 <minsu@example.com>',
          subject: 'Re: 3월 일정 확인',
          reason: '직접 질문 · 답장 필요',
        },
        {
          emailId: 'demo-msg-2',
          threadId: 'demo-thread-vip',
          from: 'CEO <ceo@company.example>',
          subject: '분기 목표 공유',
          reason: 'VIP 발신',
        },
      ],
      today: [
        {
          emailId: 'demo-msg-3',
          threadId: 'demo-thread-3',
          from: '박지영 <park@work.example>',
          subject: '견적서 검토 부탁드립니다',
          reason: '오늘 안에 확인',
        },
        {
          emailId: 'demo-msg-4',
          threadId: 'demo-thread-4',
          from: 'Coupang <noreply@coupang.com>',
          subject: '주문이 배송 중입니다',
          reason: '거래·알림 — 오늘 중 확인',
        },
      ],
      later: [
        {
          emailId: 'demo-msg-5',
          threadId: 'demo-thread-5',
          from: 'Newsletter <news@digest.example>',
          subject: 'Weekly digest',
          reason: '참고·낮은 신호',
        },
      ],
    },
  };
}

export function seedDemoUiIfEnabled(): void {
  if (!isDemoUiEnabled()) return;

  preferencesMemory.patch({
    onboardingCompleted: true,
    language: 'ko',
    aiMode: process.env.OPENAI_API_KEY?.trim() ? 'cloud' : 'off',
    triageWindowDays: 7,
  });

  const prefs = preferencesMemory.get();
  const samples: EmailSummary[] = [
    {
      id: 'demo-msg-1',
      threadId: 'demo-thread-1',
      from: { name: '김민수', email: 'minsu@example.com' },
      to: [{ name: null, email: 'demo@calmmail.dev' }],
      subject: 'Re: 3월 일정 확인',
      snippet: '목요일 오후 3시 가능하신지요?',
      receivedAt: now - 3600_000,
      isUnread: true,
      labels: ['INBOX', 'UNREAD'],
      importanceScore: 72,
      priority: 'HIGH',
      reasons: [{ kind: 'direct_to_user' }],
      category: 'work',
      openCount: 0,
      triageDismissed: false,
    },
    {
      id: 'demo-msg-2',
      threadId: 'demo-thread-vip',
      from: { name: 'CEO', email: 'ceo@company.example' },
      to: [{ name: null, email: 'demo@calmmail.dev' }],
      subject: '분기 목표 공유',
      snippet: '팀과 공유 부탁드립니다.',
      receivedAt: now - 7200_000,
      isUnread: true,
      labels: ['INBOX', 'UNREAD'],
      importanceScore: 85,
      priority: 'HIGH',
      reasons: [{ kind: 'vip_sender', contact: 'ceo@company.example' }],
      category: 'work',
      openCount: 1,
      triageDismissed: false,
    },
    {
      id: 'demo-msg-3',
      threadId: 'demo-thread-3',
      from: { name: '박지영', email: 'park@work.example' },
      to: [{ name: null, email: 'demo@calmmail.dev' }],
      subject: '견적서 검토 부탁드립니다',
      snippet: '첨부 확인 후 회신 주세요.',
      receivedAt: now - 86400_000,
      isUnread: true,
      labels: ['INBOX', 'UNREAD'],
      importanceScore: 48,
      priority: 'MEDIUM',
      reasons: [{ kind: 'frequent_correspondent', contact: 'park@work.example' }],
      category: 'work',
      openCount: 0,
      triageDismissed: false,
    },
    {
      id: 'demo-msg-5',
      threadId: 'demo-thread-5',
      from: { name: 'Newsletter', email: 'news@digest.example' },
      to: [{ name: null, email: 'demo@calmmail.dev' }],
      subject: 'Weekly digest',
      snippet: 'Top stories this week…',
      receivedAt: now - 172800_000,
      isUnread: true,
      labels: ['INBOX', 'UNREAD'],
      importanceScore: 8,
      priority: 'LOW',
      reasons: [],
      category: 'newsletter',
      openCount: 0,
      triageDismissed: false,
    },
  ];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const classified = ruleEngine.classifyIncoming(s, {
      preferences: prefs,
      userPrimaryEmail: 'demo@calmmail.dev',
    });
    seedEmail(classified, `demo-uid-${i + 1}`);
  }

  briefingsRepo.insert(buildDemoBriefing());

  awaitedRepo.upsert({
    threadId: 'demo-thread-await',
    contact: 'park@work.example',
    subject: '견적서 검토 부탁드립니다',
    sentAt: now - 2 * 86400_000,
    expectedByMinutes: 2880,
    status: 'waiting',
    reason: 'auto_inferred',
  });

  console.info('[demo-ui] Seeded demo inbox + briefing (CALMMAIL_DEMO_UI=1)');
}
