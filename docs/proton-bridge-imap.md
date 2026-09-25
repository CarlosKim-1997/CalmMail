# Proton Mail + Proton Bridge — CalmMail IMAP 설정

CalmMail은 **Proton Mail 웹/API에 직접 연결하지 않습니다.** Proton은 표준 IMAP를 클라우드에 열어 두지 않고, 대신 **Proton Mail Bridge**가 이 PC에서 로컬 IMAP 서버(`127.0.0.1`)를 띄웁니다. CalmMail은 Gmail과 같은 방식으로 **IMAP 제공자**로 Bridge에 붙습니다.

이 문서는 Bridge + CalmMail 조합으로 **조용한 수신함 감시**, **온디맨드 브리핑**, **답장 대기(awaited)** 를 쓰는 절차를 정리합니다.

## 전제 조건

| 항목 | 설명 |
|------|------|
| Proton 계정 | Bridge는 [Proton Mail Bridge](https://proton.me/mail/bridge)가 지원하는 요금제·계정이 필요합니다. |
| 동일 PC | Bridge와 CalmMail **Electron 앱이 같은 머신**에서 실행되어야 합니다. Bridge는 루프백 IMAP만 제공합니다. |
| Bridge 실행 | CalmMail을 켜기 **전에** Bridge 앱을 로그인한 상태로 실행해 두세요. |
| CalmMail 역할 | 메일 **클라이언트가 아님** — 읽기·분류·브리핑·알림만. Bridge SMTP로 보내는 기능은 CalmMail에 없습니다. |

공식 Bridge 포트·인증서 안내: [Comprehensive guide to Bridge settings](https://proton.me/support/comprehensive-guide-to-bridge-settings)

## 1. Proton Mail Bridge 설치

1. [Proton Mail Bridge](https://proton.me/mail/bridge)에서 OS에 맞는 Bridge를 설치합니다 (Windows / macOS / Linux).
2. Bridge에 Proton 계정으로 로그인합니다.
3. Bridge UI에서 **IMAP/SMTP용 비밀번호**(Bridge password)를 확인합니다.  
   - 이 값은 **Proton 웹 로그인 비밀번호가 아닙니다.**  
   - Bridge가 메일 클라이언트용으로 발급하는 전용 비밀번호입니다.

포트 충돌 시 Bridge **Settings → Advanced settings → Default ports**에서 IMAP 포트(기본 `1143`)를 바꿀 수 있습니다. [포트 점유 오류 가이드](https://proton.me/support/port-already-occupied-error)

## 2. Bridge IMAP 값 (기본)

Bridge **기본 연결 모드는 STARTTLS**입니다(SSL/implicit TLS가 아님).

| 필드 | 값 |
|------|-----|
| IMAP 호스트 | `127.0.0.1` (또는 `localhost`) |
| IMAP 포트 | `1143` (Bridge에서 변경했다면 그 포트) |
| 암호화 | **STARTTLS** — CalmMail 고급 설정에서 **「TLS 사용」을 끔** (`secure: false`) |
| 사용자 이름 | Proton 주소 전체 (`you@proton.me`, `you@pm.me` 등) |
| 비밀번호 | Bridge에서 표시하는 **Bridge password** |

Bridge 설정에서 **Connection mode**를 implicit TLS(SSL)로 바꾼 경우에만 CalmMail에서 「TLS 사용」을 켜고, Bridge UI에 표시된 포트·모드와 **정확히 일치**시키세요.

## 3. CalmMail에서 연결

1. CalmMail 실행 → 온보딩 또는 설정에서 **「IMAP로 연결」** (`ImapLogin` 화면).
2. **이메일 주소**에 Proton 주소 입력.  
   - `@proton.me` 등은 자동 완성이 **공식 Proton IMAP 호스트**를 제안할 수 있습니다. Bridge는 **`127.0.0.1`만** 사용하므로 자동 완성 값은 **무시**하고 고급 설정을 여세요.
3. **고급 설정** 열기:
   - **IMAP 호스트:** `127.0.0.1`
   - **포트:** `1143` (또는 Bridge에 표시된 값)
   - **TLS 사용:** **끔** (STARTTLS, Bridge 기본)
   - **비밀번호:** Bridge password
4. **연결**을 누릅니다. 성공 시 IMAP이 활성 제공자로 전환되고, 수신함 부트스트랩·IMAP IDLE 감시가 시작됩니다.

자격 증명은 OS 암호화 저장소(`safeStorage`)에만 저장되며, CalmMail 서버로 전송되지 않습니다.

## 4. Bridge + CalmMail에서 기대할 수 있는 것

| 기능 | Bridge + CalmMail |
|------|-------------------|
| 수신함 감시 | IMAP IDLE(가능한 경우) + 주기적 안전 재동기화 |
| 규칙 엔진 / 알림 | Gmail과 동일 파이프라인 (메일당 AI 없음) |
| 브리핑 | 사용자가 요청할 때만 |
| 답장 대기 | Sent 폴더(`\\Sent`) 스캔 + 질문 휴리스틱 *(IMAP Sent 연동이 포함된 빌드)* |
| 웹에서 스레드 열기 | **없음** (`canOpenInWeb: false`) — Proton 웹 UI 딥링크 미지원 |
| 메일 보내기 / 초안 | CalmMail **비목표** (Bridge SMTP 미사용) |

메일 본문은 CalmMail 신뢰 경계와 같이 **디스크에 저장하지 않습니다.** 스니펫만 transient하게 생성합니다.

## 5. 문제 해결

### 「IMAP connection failed」 / 연결 거부

- Bridge가 **실행 중**이고 로그인되어 있는지 확인합니다.
- 호스트가 `127.0.0.1`, 포트가 Bridge UI와 **일치**하는지 확인합니다.
- 비밀번호가 **Bridge password**인지 다시 확인합니다 (Proton 로그인 PW 아님).

### 포트 이미 사용 중 (Bridge)

Bridge 설정에서 IMAP 포트를 `1144` 등으로 올린 뒤, CalmMail 고급 설정 포트도 같이 바꿉니다.

### 인증서 / `self signed certificate` 오류

Bridge IMAP은 **자체 서명 TLS 인증서**를 씁니다.

**CalmMail 기본 동작:** IMAP 호스트가 `127.0.0.1` / `localhost` / `::1` 이면 루프백 전용으로 Bridge 자체 서명 인증서를 허용합니다 (트래픽이 PC 밖으로 나가지 않음). 별도 설정 없이 연결되는 경우가 많습니다.

**선택 (CA 고정):** Bridge에서 **TLS 인증서 내보내기** 후 `.env`에 경로를 지정하면 해당 CA로 검증합니다 ([Bridge settings — certificate export](https://proton.me/support/comprehensive-guide-to-bridge-settings)):

```bash
CALMMAIL_IMAP_TLS_CA_FILE=/path/to/cert.pem
```

`.env` 변경 후 CalmMail을 트레이에서 **완전 종료**한 뒤 다시 실행하세요.

원격 IMAP 호스트(루프백이 아님)는 시스템 기본 CA 검증을 유지합니다. 여전히 실패하면 오류 메시지 전체를 이슈에 남겨 주세요.

### 연결은 되는데 브리핑/수신함이 비어 있음

- Bridge 계정에 INBOX 메일이 있는지 Bridge/Proton 웹에서 확인합니다.
- CalmMail을 트레이에서 **완전 종료 후** 재실행해 부트스트랩을 다시 돌립니다.
- 방화벽이 **로컬** `127.0.0.1:1143`을 막지 않는지 확인합니다.

### 답장 대기가 비어 있음

- 최근 **Sent**에서 **질문 형태**로 보낸 메일이 있어야 `sentPoller`가 awaited 후보를 잡습니다.
- Sent 폴더 이름이 특이한 서버는 IMAP `\\Sent` 또는 일반 경로 fallback에 의존합니다. Bridge는 표준 Sent 매핑을 제공합니다.

## 6. 보안 메모

- IMAP 트래픽은 **루프백**에서만 흐릅니다. Bridge가 Proton 서버와의 암호화·복호화를 담당합니다.
- CalmMail **로컬 AI** 모드는 메일을 원격 LLM으로 보내지 않습니다. 클라우드 AI 모드는 빌드/설정에 따라 별도 신뢰 경계가 적용됩니다 (`README.md` Trust boundaries 참고).
- PC를 공유하는 환경에서는 Bridge + CalmMail 모두 로그아웃/종료하세요.

## 7. 관련 코드·문서

- IMAP 엔진: `electron/modules/mail/imap/imapClient.ts`
- IMAP UI: `src/screens/ImapLogin.tsx`
- 제공자 capability: `electron/modules/mail/capabilities.ts`
- 아키텍처: `docs/ARCHITECTURE.md`

---

**요약:** Bridge를 켠 뒤 CalmMail IMAP 고급 설정에 `127.0.0.1:1143`, STARTTLS(TLS 끔), Bridge password를 넣으면 Proton 수신함을 CalmMail의 조용한 감시·브리핑 파이프라인에 태울 수 있습니다.
