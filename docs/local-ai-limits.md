# 로컬 AI — 메일 처리 한도 & UX 계획

## 제품 스펙 (사용자-facing)

| 항목 | 로컬 AI | 클라우드 |
|------|---------|----------|
| 처리 횟수 | **무제한** | 플랜별 (Free 2회/일 등) |
| 정리 범위 | **최근 7일만** (14일 비활성) | 7일 / 14일 |
| 미읽음 3칸 분류 | **규칙 엔진 최대 40건/회** | AI 최대 80건/회 |
| AI 역할 | **브리핑 prose만** (요약·reasoning) | 브리핑 + triageGroups |
| 초과 미읽음 | 규칙으로 동일 처리 (배치 반복 v2) | 규칙 폴백 |

> 사용자 안내: **「로컬 · 규칙 분류 최대 40통 · AI는 브리핑만」**  
> 내부 상한 `LOCAL_TRIAGE_UNREAD_AI_CAP`(40) — DB·규칙 triage 풀 크기.

## 왜 40건인가 (규칙 triage 풀)

- 한 번에 UI·DB에 올릴 미읽음 분류 상한 (7일 창)
- **로컬 AI 추론과 분리** — 모델은 `unreadForTriage`를 보지 않음
- managed `llama-server`는 briefing-only JSON (`max_tokens: 512`)만 생성

## 예상 시간 (프리플라이트)

처리 시작 전에 표시:

- 미읽음 N건 (최근 7일)
- 규칙 분류: min(N, 40)건 · AI는 브리핑만
- 예상 약 **X~Y초** (하드웨어·미읽음 수 반영)

로컬 추정식 (개략):

```
prep + inspect + (18s + 0.9s × AI건수) × HW배수 × (미읽음>40 ? 1.15 : 1)
```

미읽음이 40을 넘으면 **시간만 길어질 수 있음**을 안내 (배치 반복은 v2).

## 초과 시 정책

| 단계 | 내용 | 상태 |
|------|------|------|
| v1 | 40 초과분은 **규칙 폴백**으로 triage 보완, 사전 안내 | ✅ |
| v1 | 컨텍스트 초과 시 **조용한 재시도 금지** — 예산 맞춘 1회 우선 | ✅ |
| v2 | 40건 단위 **배치 반복** (사용자 확인 후) | ⏳ |
| v2 | 진행 중 **중단** 버튼 | ⏳ |

배치 반복은 로컬에서 40×k번 추론 → 7분급 체감 가능. v1에서는 **반복 대신 시간 안내 + 클라우드/7일 유도**.

## UI 노출 위치

1. **메일 처리** 탭 — 시작 버튼 위 프리플라이트 카드
2. **설정 → 메일 정리** — 로컬 7일 고정 안내
3. **AI 설정 → 로컬 AI** — 「규칙 분류 최대 40통」
4. **진행 패널** — `briefingEstimate` 기반 ETA (미읽음 수 반영)

## triage UI

- 브리핑 스냅샷의 3그룹은 **읽음 처리된 항목도 페이드 표시** (숨기지 않음)
- `정리 완료(dismiss)`만 목록에서 제거
- 진입 시 Gmail 동기화로 전부 읽음으로 바뀌어 그룹이 사라지는 UX 버그 방지

## v1.1 아키텍처 (현재)

```
unreadPool (≤40) → buildRuleTriageGroups / finalizeTriageGroups  [규칙, 즉시]
BriefingInput   → planLocalBriefingRequest (preflight, 재시도 없음)
                → llama: briefing-only 1회 (max_tokens 512)
                → parseBriefing (local은 triageGroups 무시)
```

과거 6분 이슈(모델이 triage JSON까지 생성 + overflow 재시도)는 **로컬 managed/Ollama에서 제거**.

| 요인 | v1.1 |
|------|------|
| 출력 | reasoning·highlights만 (~100–200 tok) |
| 입력 | unread 미전송, briefing-only system prompt |
| 재시도 | 없음 — preflight `fits=false`면 모델 미호출 |
| triage | `triage.ts` `fallbackGroup` 규칙 |

진단 로그 (재시작 후 터미널):

```
[briefing:perf] local_ai_request … estInTok≈… inferMs=…
[briefing:perf] ai_done …
```

`inferMs`가 전체의 대부분이면 AI 추론이 병목이다.

## 관련 코드

| 영역 | 경로 |
|------|------|
| 상수 | `electron/shared/triage.ts` |
| 토큰·preflight | `electron/modules/ai/localBriefingBudget.ts`, `localBriefingRun.ts` |
| 규칙 triage | `electron/modules/ai/triage.ts` |
| 추정 | `electron/modules/ai/estimateBriefing.ts` |
| UI | `src/components/MailProcessPreflight.tsx` |
