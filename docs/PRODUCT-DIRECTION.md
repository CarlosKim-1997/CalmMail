# CalmMail — 제품·기술 방향 (한 장 요약)

## 한 줄 포지션

**백그라운드는 규칙으로 조용히, “메일 처리” 한 번에 AI가 메일 메타·스니펫을 읽고 오늘의 브리핑·정리 순서를 만든다.**  
메일 클라이언트가 아니라 **의사결정 보조** 앱이다.

## 두 갈래 파이프라인 (구조를 부수지 않는 핵심)

```
[수신] Gmail API / IMAP(IDLE+poll)
         │
         ▼
   규칙 엔진만 (AI 없음) ──► SQLite 메타+snippet(≤280) ──► VIP/awaited/알림
         │
         │  사용자가 「메일 처리 시작」
         ▼
   ai/briefing.ts ──► AI provider (cloud / local llama)
         │
         ├── 브리핑 prose (highlights, reasoning)
         ├── triageGroups (지금/오늘/나중에) — cloud: AI, local managed: 규칙+AI 혼합
         └── memory proposals → validator → (선택) 반영
```

| 구간 | AI | 읽는 것 |
|------|-----|---------|
| 폴링 / IDLE ingest | **사용 안 함** | subject, from, snippet, 헤더 시그널만 (본문 바이트 X) |
| **메일 처리 / 브리핑** | **핵심** | 캐시된 메타+snippet, inspected 요약, 미읽음 triage 풀(캡), VIP·awaited |
| 발송 / 라벨 편집 | 없음 | 비목표 |

**“무해한 배포”** = 스파이웨어·본문 영구 저장·백그라운드 몰래 LLM 호출이 없다는 뜻이지, **사용자가 누른 메일 처리에서 AI가 메일을 읽지 않는다**는 뜻이 아니다.

## AI가 메일을 “읽는” 코드 경로 (유지·강화 대상)

- 오케스트레이션: `electron/modules/ai/briefing.ts` → `provider.runBriefing(input)`
- 입력 조립: important recent, unread triage pool, inspected clusters, sender profiles
- 출력 검증: `parseBriefing.ts`, triage 폴백 `triage.ts`
- UX: `GenerateBriefingButton`, `BriefingProgressPanel`, `TriageGroupsPanel`
- 스펙: `docs/mail-triage.md`

로컬 AI: `local-ai-policy.md` — llama-server는 127.0.0.1, **브리핑 요청 시** 프롬프트에 메일 요약이 들어감.

## 멀티 제공자 (Gmail + IMAP)

- **데이터 plane:** `MailProvider` — ingest → 동일 규칙·동일 DB
- **AI plane:** 제공자 무관 — `emailsRepo` 캐시만 있으면 브리핑 가능
- IMAP 추가 작업은 **메일 가져오기·읽음 동기화·awaited**이지, AI 모듈 교체가 아님

## v0.1 배포까지 우선순위 (구조 유지)

1. **#9 머지** — IMAP ingest/read-state/Sent/Bridge TLS (AI 경로 그대로)
2. **브리핑 IMAP 연결** — `getConnectedEmail()` 등 Gmail 하드코딩 제거 (분류·프롬프트용)
3. **실기 스모크** — Gmail 또는 IMAP → **메일 처리 1회** → triage+브리핑 확인
4. **`docs/SHIP.md`** — 신뢰 경계 문구를 “백그라운드 vs 온디맨드 AI”로 구분
5. 태그 `v0.1.0` → Windows 설치본

## 하지 않을 것 (v0.1)

- 수신 메일마다 LLM 호출
- 풀 메일 클라이언트·작성기
- AI가 DB/메모리 직접 쓰기 (validator 우회)

## 이후 (PMF 이후)

- `local-ai-io-improvements.md` 2-pass / triage 품질
- Microsoft Graph, 다계정
- 구조화된 proposal 검토 UI (README Phase 4)
