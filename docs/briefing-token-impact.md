# 메일 처리 — 클라우드 API 토큰·비용 영향 보고

메일 정리(triage) 추가 **이전 vs 이후** 요청당 토큰·비용 증가를 정리한다.  
재현: `node scripts/estimate-briefing-tokens.mjs`

## 방법론

| 항목 | 내용 |
|------|------|
| 토큰 추정 | `localBriefingBudget.estimatePromptTokens`와 동일 — **문자 수 ÷ 3** (보수적) |
| 레거시 시나리오 | `unreadForTriage`·`triageGroups` 없는 구 브리핑 프롬프트 (시스템에서 triage 섹션 제거) |
| 클라우드 입력 | `buildBriefingUserPrompt(input)` — **pretty JSON + snippet 포함** full payload |
| 로컬 입력 | `compact: true`, unread cap 40 — subject 72자 클램프, snippet 제외 |
| 출력 추정 | 레거시 소형 JSON vs 40건 triage `emailId`+`reason` 포함 JSON |

실제 청구 토큰은 모델·언어·ID 길이에 따라 ±15% 흔들릴 수 있다.  
클라우드 호출 후 터미널 `[briefing:perf] cloud_tokens` 로그로 **실측** 가능 (OpenAI·Anthropic).

## 요청당 토큰 (모의 40건 미읽음, 15건 importantRecent)

| 시나리오 | System | User | **입력 합** | 출력(추정) | **요청 합** |
|----------|--------|------|------------|------------|------------|
| 레거시 (triage 없음) | ~1,324 | ~4,197 | **~5,521** | ~52 | **~5,573** |
| 클라우드 triage 40건 | ~1,588 | ~10,385 | **~11,973** | ~825 | **~12,798** |
| 클라우드 triage 80건 | ~1,588 | ~16,560 | **~18,148** | ~1,224 | **~19,372** |
| 로컬 compact 40건 | ~1,588 | ~4,320 | **~5,908** | ~825 | **~6,733** |

### 증가율 (40건 미읽음 기준)

| 구분 | 레거시 대비 |
|------|------------|
| **입력 토큰** | **+117%** (5.5k → 12.0k) |
| **출력 토큰** | **+~15배** (52 → 825) |
| **요청 전체** | **+129%** (5.6k → 12.8k) |

입력 증가의 주요 원인:

1. 시스템 프롬프트에 `triageGroups` 스키마·규칙 (~+260 tok)
2. `unreadForTriage` 40행 — 클라우드는 **snippet·pretty JSON** 포함 (~+6k tok)

출력 증가의 주요 원인:

- 미읽음 N건 각각 `emailId` + `threadId` + `reason` JSON 배열 3벌

## 호스팅 비용 감 (GPT-4o-mini, 2025년 공시 단가 기준)

단가 (참고): 입력 $0.15 / 1M, 출력 $0.60 / 1M

| 시나리오 | 추정 $/요청 |
|----------|------------|
| 레거시 | ~$0.00086 |
| triage 40건 | ~$0.00229 (**+167%**) |
| triage 80건 | ~$0.00346 |

### Free 플랜 (2회/일) 관점

- **일일 토큰 예산**: 레거시 ~11k → triage40 ~26k (**약 2.3배**)
- **일일 호스팅 원가** (40건×2회): ~$0.0017 → ~$0.0046
- 횟수 한도는 그대로여도, **같은 2회가 서버·API 부담은 약 2배**에 가깝다.

Anthropic Haiku 등 다른 모델도 입력·출력 비율은 유사하고, 출력 단가가 더 높으면 triage 추가 영향이 더 크다.

## 로컬 vs 클라우드 입력 격차

로컬은 `compact`로 user 토큰이 레거시 수준(~4.3k)을 유지하지만, **출력 825 tok**은 동일하다.  
→ 로컬 체감 지연의 주원인은 입력보다 **생성(tok/s)·max_tokens 1024** 쪽 (see `local-ai-limits.md`).

## v1.2 클라우드 (적용됨)

- **입력**: `compact` + `ambiguousForTriage`만 전송 (전체 unread 대신 ~35% 애매분)
- **출력**: `triageOverrides` sparse (`emailId`+`group`+optional `reason`) — 동의 없으면 `[]`
- **병합**: `buildRuleTriageGroups` → `applyTriageOverrides`
- **코드**: `cloudBriefingRun.ts`, `BRIEFING_SYSTEM_PROMPT_CLOUD_SPARSE`

## 권장 후속 (v2)

1. **`cloud_tokens` 로그 집계** — 주간 평균 in/out, 플랜별 대시보드
2. **2-pass** — 필요 시 브리핑·override 완전 분리

## 관련 파일

- `electron/modules/ai/prompts.ts` — 시스템·user 프롬프트
- `electron/modules/ai/localBriefingBudget.ts` — 로컬 예산
- `electron/modules/ai/providers/openaiProvider.ts` — usage 로그
- `scripts/estimate-briefing-tokens.mjs` — 표 재현 스크립트
