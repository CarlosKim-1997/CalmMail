# CalmMail — 배포 체크리스트 (무해한 설치본)

CalmMail은 **메일 클라이언트가 아닌** 백그라운드 동반 앱입니다. 배포본은 사용자 PC에서만 동작하고, 아래 신뢰 경계를 지키는 것이 목표입니다.

## 신뢰 경계 (배포 전 필수 확인)

| 약속 | 코드 근거 |
|------|-----------|
| 메일 **본문** 미저장 | SQLite에는 snippet(≤280자)만 |
| 메일마다 AI 호출 없음 | `poller` / IDLE → 규칙 엔진만 |
| AI가 메모리 직접 수정 불가 | `proposalValidator` + `proposal_log` |
| Gmail **읽기** scope 기본; 수정은 opt-in | OAuth scope 분리 |
| 비밀번호·토큰 OS 암호화 | `safeStorage` — 불가 시 저장 거부 |
| 로컬 AI는 127.0.0.1 llama-server | `local-ai-policy.md` |
| IMAP Proton Bridge는 루프백 TLS | `imapTls.ts` |

## 배포용 `.env` (빌드 머신만)

**설치본에 `.env`를 넣지 마세요.** 개발/CI 빌드 시:

```bash
cp .env.example .env
# Gmail OAuth (Desktop app) — 배포 채널마다 별도 OAuth 클라이언트 권장
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...

# 선택: 이 빌드에서만 클라우드 AI 제공 (비우면 UI에서 클라우드 unavailable)
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=

# 배포본에서는 끄기
# CALMMAIL_BILLING_STUB=0  (기본 off)
# CALMMAIL_DEV_PREMIUM=0
```

- **Stripe / 결제**: 실 서비스 전까지 `CALMMAIL_BILLING_STUB` 사용 금지(내부 QA만).
- **API 키**: 최종 사용자에게 입력받지 않음 — 빌드에 넣거나 로컬 AI만.

## Windows 설치 파일 만들기

```bash
npm ci
npm run make
```

산출물: `release/CalmMail-Setup-Windows-x64.exe` (unsigned — SmartScreen 경고 가능).

### GitHub Release (CI)

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release-windows.yml` 이 NSIS 설치 프로그램 + Release asset 업로드.

## 배포 전 수동 스모크 (30분)

1. **설치** → 트레이 상주, 창 닫아도 종료되지 않음.
2. **Gmail OAuth** → 수신함 부트스트랩, 폴링 tick, 브리핑 1회 생성.
3. **IMAP** (선택) → Fastmail/Naver 또는 Proton Bridge [`proton-bridge-imap.md`](./proton-bridge-imap.md).
4. **읽음 동기화** → 다른 클라이언트에서 읽음 처리 후 CalmMail triage 새로고침 / 폴링 주기 대기.
5. **로컬 AI** (선택) → 모델 다운로드, 브리핑 — 네트워크 스niffer로 127.0.0.1 외 LLM 트래픽 없음 확인.
6. **Quit** → tray Quit 시 `llama-server`·IMAP IDLE 종료.

## SmartScreen / 서명

현재 `CSC_IDENTITY_AUTO_DISCOVERY=false` — **코드 서명 없음**.  
상용 배포 시 Authenticode 인증서로 `electron-builder` 서명 파이프라인 추가 필요.

## 버전·공지

- `package.json` `version` ↔ git tag `v*` 일치.
- `npm run notices` → `THIRD_PARTY_NOTICES.md` (CI release에 포함).
- 로컬 AI 모델 라이선스: Apache 2.0 catalog — `THIRD_PARTY_NOTICES.md`, `local-ai-policy.md`.

## 1.0 직전에 하면 좋은 것 (시간 있을 때)

- [ ] 온보딩 카피: “Gmail users” → 다중 제공자
- [ ] Draft PR 정리 (#6–#8) → `main` 단일화
- [ ] `npm run typecheck` CI job
- [ ] macOS notarization (Mac 타깃 시)

---

**요약:** 비밀 `.env` 없는 설치본, 읽기 중심 권한, 본문 미저장, 온디맨드 AI — 이 네 가지를 릴리스 노트에 명시하면 “무해한 파일” 포지션과 맞습니다.
