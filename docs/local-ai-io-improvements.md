# 로컬 AI 입·출력 구조 개선안

현재 메일 처리 1회 = **단일 추론**으로 (1) 브리핑 prose, (2) `triageGroups`, (3) `memoryProposals` JSON을 한꺼번에 생성한다.  
8192 ctx + `max_tokens: 1024` 제약 안에서 품질·속도·안정성을 나누는 설계 옵션을 정리한다.

## 현재 구조 (as-is)

```
[Gmail 메타] → BriefingInput
                    ↓
        system (고정 ~1.6k tok) + user compact (~4.3k @40건)
                    ↓
           llama-server 1회 (max_tokens 1024)
                    ↓
     highlights + reasoning + triageGroups(≤40) + proposals
```

**병목**

| 단계 | 이슈 |
|------|------|
| 입력 | 40건 id·subject·from + inspected + system triage 규칙 → ctx 상한 근접 |
| 출력 | triage 40건 × (id+reason) → 생성 토큰·시간 선형 증가 |
| 실패 | overflow 시 cap 축소 1회 재시도 (전체 재추론) |

## 개선 옵션

### A. 2-pass 분리 (추천 — 중기)

| Pass | 입력 | 출력 | 목적 |
|------|------|------|------|
| 1 | inspected + importantRecent (compact) | highlights, reasoning, toneNote | 짧은 max_tokens (~400) |
| 2 | unreadForTriage only + bucket 규칙 | triageGroups only | max_tokens 동적 `min(1024, 24×N)` |

**장점**: 1차 결과를 UI에 먼저 노출 가능, 2차 실패해도 브리핑은 유지.  
**단점**: 로컬에서 추론 2회 → 총 wall time은 비슷하거나 약간 증가. UX는 체감 개선.

### B. 규칙 triage + AI 보정 (추천 — 단기)

```
unreadForTriage
    → 규칙: promotions/newsletter/notification → later (이미 폴백 일부 존재)
    → 규칙: VIP/awaited/high score → now 후보
    → AI: 애매한 나머지만 today/now/later + reason
```

**장점**: 출력 토큰·할루시네이션 감소, overflow 여유.  
**단점**: 규칙과 AI 불일치 시 사용자 혼란 — reasoning에 “규칙 N건 + AI M건” 명시 필요.

### C. 출력 스키마 축소

- `reason` 제거 또는 20자 코드만 (`promo`, `notify`, `vip`)
- `threadId`는 입력에서 lookup — 출력에 `emailId`만

**절감**: 출력 ~30–40% (40건 기준 ~250–330 tok).  
**리스크**: UI 힌트 품질 하락 — 나중에 칸은 제목 중심이라 영향 적음.

### D. 동적 max_tokens

```ts
max_tokens = clamp(128 + unreadCap * 18, 256, 768);
```

지금은 항상 1024 슬롯을 ctx에서 빼 두어 **프롬프트 예산을 줄인다**.  
실제 필요 출력만 예약하면 unread 20건 이하에서 입력 cap을 48→56까지 올릴 여지.

### E. 로컬 전용 짧은 system prompt

클라우드용 장문 지시(예시 문장·senderDirectory 설명)를 로컬용 `BRIEFING_SYSTEM_PROMPT_LOCAL`로 분리.

**절감**: system ~400–600 tok → 40건당 1–2건 분 추가 여유.

### F. ctx 16k (하드웨어 옵션)

`llamacppRuntime` `--ctx-size 16384` — RAM·prefill 시간 증가, 80건 단일 패스 가능.  
v2: 사용자 “느리지만 한 번에” 토글.

## 권장 로드맵

| 단계 | 작업 | 기대 효과 |
|------|------|-----------|
| **v1.1** ✅ | 로컬 managed: **규칙 triage + briefing-only 프롬프트** + `planLocalBriefingRequest` 사전 차단 (재시도 제거) | 출력 ~15배↓, infer 시간 레거시 근접 |
| **v1.2** ✅ | 클라우드: 규칙 선분류 + `ambiguousForTriage` + `triageOverrides` sparse | 입력·출력 토큰 대폭↓ |
| **v2** | A (2-pass) 또는 F (16k 옵션) | UX·대량 미읽음 |

### v1.1 구현 요약 (managed local)

1. **양식은 코드가 채움** — `buildRuleTriageGroups` / `finalizeTriageGroups`가 `fallbackGroup`·`fallbackReason`으로 3칸 JSON을 조립.
2. **AI는 브리핑 prose만** — `BRIEFING_SYSTEM_PROMPT_BRIEFING_ONLY`, user에 `unreadForTriage` 미포함, `max_tokens: 512`.
3. **모델 전 preflight** — `planLocalBriefingRequest`: `estIn + maxOut + safety ≤ 8192` 아니면 `BriefingContextOverflowError`, **cap-down 재시도 없음**.

### v1.2 클라우드 (적용됨)

```
unreadPool → buildRuleTriageGroups (규칙 baseline)
           → ambiguousForTriage (~35%) 만 user JSON에 포함 + ruleDefault
           → model: triageOverrides[] (sparse, 동의 없으면 [])
           → applyTriageOverrides(baseline, overrides)
```

애매분 0건이면 로컬과 같이 briefing-only 프롬프트.

## 측정

- `[briefing:perf]` — `local_ai_request`, `inferMs`, `cloud_tokens`
- `scripts/estimate-briefing-tokens.mjs` — 프롬프트 변경 전후 diff
- 사용자-facing: 프리플라이트 ETA는 출력 토큰 추정 반영 (`estimateBriefing.ts`)

## 관련

- `docs/local-ai-limits.md` — 40건·7일·6분 원인
- `docs/briefing-token-impact.md` — 클라우드 비용 보고
