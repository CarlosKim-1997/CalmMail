# 메일 정리 (Mail Triage) — 구현 로드맵

> 단일 CTA(메일 처리 시작) → AI 1회 → 브리핑 + 미리 살펴본 흔적 + 확인 순서 그룹

## 확정 사항

| 항목 | 내용 |
|------|------|
| 진입 | 브리핑 생성 버튼 **하나** — 별도 정리 버튼 없음 |
| 범위 | 받은편지함 · **미읽음** · 기본 **7일** (설정에서 14일 선택 가능) |
| 그룹 | 3개 — **지금(Now)** / **오늘(Today)** / **나중에(Later)** |
| 완료 | 그룹 내 미읽음이 0이면 UI에서 그룹 숨김 (스냅샷은 브리핑에 유지) |
| 일괄 읽음 | 나중에 그룹 — 설정에서 Gmail `modify` 옵트인 (읽음 라벨만) |

## 단계별 진행

### ✅ 1단계 — 백엔드
- [x] `TriageGroups` 타입 · `MorningBriefing.triage`
- [x] `emailsRepo.unreadWithinDays` / `countUnreadWithinDays`
- [x] 프롬프트 `triageGroups` 스키마
- [x] `parseBriefing` 검증 + `triage.ts` 폴백
- [x] `briefingsRepo`에 스냅샷 저장

### ✅ 2단계 — UI (읽기 전용)
- [x] `TriageGroupsPanel` — 지금/오늘/나중에 표시
- [x] 미읽음 아닌 항목 로컬 캐시 기준 필터 · 빈 그룹 숨김
- [x] 항목 클릭 → Gmail (`openEmailInGmail`)
- [x] i18n · 스타일

### ✅ 3단계 — 행동
- [x] `readStateSync` — 폴링·`inboxRefreshReadState`로 Gmail 읽음 동기화
- [x] 메일 클릭 후 읽음 상태 갱신 + `evtMonitorTick` 시 inbox refresh
- [x] 「나중에」`inboxTriageDismiss` — CalmMail 내부 정리 완료 (`seen_by_user`)
- [x] 브리핑 진입 시 triage id 기준 읽음 상태 refresh

### ✅ 4단계 — 통합 CTA
- [x] 버튼 카피 통합 — `mailProcess.start` 「메일 처리 시작」
- [x] 홈 CTA와 브리핑 탭 CTA 정렬 (`GenerateBriefingButton` · 홈에서 탭 이동+자동 시작)
- [x] 진행 패널에 `triage` 단계 + 6단계 스텝 레일

### ✅ 5단계 — 신뢰·설정
- [x] `gmail.modify` 옵트인 — `gmailRequestModifyScope` IPC
- [x] 나중에 일괄 읽음 — 설정 켜고 권한 허용 시 Gmail UNREAD 제거
- [x] 정리 기간 7/14일 · 나중에 그룹 접기 — 설정 화면

## 파일 맵

| 영역 | 경로 |
|------|------|
| 상수 | `electron/shared/triage.ts` |
| 타입 | `electron/shared/types.ts` |
| 수집·오케스트레이션 | `electron/modules/ai/briefing.ts` |
| 파서·폴백 | `electron/modules/ai/parseBriefing.ts`, `triage.ts` |
| 프롬프트 | `electron/modules/ai/prompts.ts` |
| UI | `src/components/TriageGroupsPanel.tsx`, `GenerateBriefingButton.tsx`, `BriefingProgressPanel.tsx`, `src/screens/Briefing.tsx`, `src/screens/Home.tsx` |
| i18n | `src/i18n/dictionaries.ts` (`mailProcess.*`, `settings.triage.*`) |
| Gmail 읽음 | `electron/modules/gmail/auth.ts`, `client.ts` (`markMessagesAsRead`) |
| 설정 | `src/screens/Settings.tsx` |
