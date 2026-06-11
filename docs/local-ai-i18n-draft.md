# Local AI — i18n copy draft (Phase 0)

Drafts of every user-visible string the Apache-2.0 transition needs.
Approved drafts here are moved into `src/i18n/dictionaries.ts` in **Phase 3**
(UI re-skin). Nothing in this file is wired up yet — this is the
single-source review surface so we agree on tone before touching code.

Conventions:

- `[var]` denotes an i18n placeholder.
- Each key is shown once with `ko` and `en`.
- The current copy (kept for reference) is shown in italics under the new
  one when applicable.

---

## 1. Mode picker (existing `localAi.modeOpt.*`)

### `localAi.modeOpt.local.hint`

- ko: `이 PC에서만 브리핑 (CalmMail 관리형 · Apache 2.0 모델)`
- en: `On-device briefings (CalmMail-managed, Apache 2.0 models)`

> _Current:_ ko: `Ollama 등으로 이 PC에서만 브리핑` · en: `Briefings on this
> computer (e.g. Ollama)` — both must lose the "Ollama" mention.

---

## 2. Setup home (replaces today's two-card "Ollama / llama.cpp" picker)

### `localAi.wizard.recommendedTag`
- ko: `권장`
- en: `Recommended`

### `localAi.wizard.managedTitle` (new)
- ko: `CalmMail 관리형 (권장)`
- en: `CalmMail-managed (recommended)`

### `localAi.wizard.managedDesc` (new)
- ko: `CalmMail이 직접 관리하는 로컬 서버에서 Apache 2.0 모델만 사용합니다. 메일 내용은 외부로 나가지 않습니다.`
- en: `Uses a CalmMail-managed local server with Apache 2.0 models only. Your mail never leaves this computer.`

### `localAi.wizard.managedCta` (new)
- ko: `시작하기`
- en: `Get started`

### `localAi.wizard.advancedToggle` (new — disclosure)
- ko: `고급 옵션 보기`
- en: `Show advanced option`

### `localAi.wizard.ollamaAdvancedTitle` (replaces today's `wizard.ollamaTitle`)
- ko: `Ollama (고급)`
- en: `Ollama (advanced)`

### `localAi.wizard.ollamaAdvancedDesc` (replaces today's `wizard.ollamaDesc`)
- ko: `직접 받은 모델을 Ollama로 돌립니다. 모델 라이선스와 출처는 본인이 책임집니다.`
- en: `Run models you fetch yourself through Ollama. You are responsible for each model's license and source.`

> The `llamacppTitle` / `llamacppDesc` keys can be removed — the managed
> flow absorbs them.

---

## 3. Apache-2.0 notice modal (new — gates first managed setup)

### `localAi.notice.title`
- ko: `로컬 AI 사용 안내`
- en: `Local AI notice`

### `localAi.notice.bodyKo` / `bodyEn`

- ko:
  > CalmMail의 로컬 AI는 이 컴퓨터에서만 동작합니다. 메일 내용은 외부로 전송되지 않습니다.
  >
  > 표준 옵션은 CalmMail이 관리하는 llama.cpp 런타임에서 Apache 2.0 라이선스 모델만 사용하며, 모든 다운로드는 검증된 출처와 체크섬으로 보호됩니다.
  >
  > 진행하면 위 정책에 동의한 것으로 간주됩니다.

- en:
  > CalmMail's local AI runs only on this computer. No mail content leaves
  > your device.
  >
  > The standard option uses a CalmMail-managed `llama.cpp` runtime with
  > Apache 2.0 licensed models only. Every download is verified by source
  > and checksum.
  >
  > By continuing you accept this policy.

### `localAi.notice.policyLink`
- ko: `자세히 보기 (오픈소스 고지)`
- en: `Learn more (open source notices)`

### `localAi.notice.accept`
- ko: `동의하고 계속`
- en: `Accept and continue`

### `localAi.notice.cancel`
- ko: `나중에`
- en: `Not now`

---

## 4. Ollama advanced warning (new — gates first Ollama setup)

### `localAi.ollamaAdvanced.warningTitle`
- ko: `Ollama는 고급 옵션입니다`
- en: `Ollama is an advanced option`

### `localAi.ollamaAdvanced.warningBody`
- ko:
  > CalmMail은 Ollama로 받은 모델의 라이선스와 출처를 검증하지 않습니다.
  > 상업적으로 사용하려는 경우 각 모델의 라이선스를 직접 확인해 주세요.
- en:
  > CalmMail does not verify the license or origin of models loaded through
  > Ollama. If you intend to use this commercially, you are responsible for
  > each model's license.

### `localAi.ollamaAdvanced.iUnderstand`
- ko: `이해했습니다, 계속`
- en: `I understand, continue`

---

## 5. Model picker (new — Phase 3)

### `localAi.model.title`
- ko: `사용할 모델`
- en: `Model`

### `localAi.model.recommendedFor` (interpolated)
- ko: `이 PC에 권장 · 약 [size]GB · [license]`
- en: `Recommended for this PC · ~[size]GB · [license]`

### `localAi.model.other` (interpolated)
- ko: `다른 옵션 · 약 [size]GB · [license]`
- en: `Alternate · ~[size]GB · [license]`

### `localAi.model.unsupportedWarning`
- ko: `이 PC 사양에서는 응답이 느릴 수 있습니다.`
- en: `On this PC, responses may be noticeably slower.`

---

## 6. Setup progress (extends existing `localAi.setupPhase.*`)

Add three new phases on top of the current `init / dirs / platform /
download / verify / done / error`:

### `localAi.setupPhase.modelDownload`
- ko: `모델을 받는 중… (한 번만 진행됩니다)`
- en: `Downloading the model… (one-time)`

### `localAi.setupPhase.modelVerify`
- ko: `모델을 검증하는 중… (체크섬 확인)`
- en: `Verifying the model… (checksum)`

### `localAi.setupPhase.serverStart`
- ko: `로컬 서버를 켜는 중…`
- en: `Starting the local server…`

> Today's `setupPhase.download` keeps its meaning for the runtime binary.
> `setupPhase.platform` can be renamed to `runtimeCheck` if we want;
> low priority.

---

## 7. Settings → About → Open source notices

### `about.notices.title`
- ko: `오픈소스 고지`
- en: `Open source notices`

### `about.notices.intro`
- ko: `CalmMail이 함께 배포하는 오픈소스 구성요소와 라이선스 전문입니다.`
- en: `Open source components shipped with CalmMail and the full text of their licenses.`

### `about.notices.localAiSection`
- ko: `로컬 AI 런타임 · 모델`
- en: `Local AI runtime & models`

### `about.notices.openFile`
- ko: `전체 보기 (THIRD_PARTY_NOTICES.md)`
- en: `View full file (THIRD_PARTY_NOTICES.md)`

---

## 8. Migration banner (one-time, for existing Ollama users)

Shown once on first launch after the Phase 1 migration converts their
`localAiPreferredRuntime` from `'ollama'` to `'ollama_advanced'`.

### `localAi.migration.title`
- ko: `Ollama 설정이 "고급" 옵션으로 옮겨졌어요`
- en: `Your Ollama setup is now under "Advanced"`

### `localAi.migration.body`
- ko:
  > CalmMail의 표준 로컬 AI는 이제 Apache 2.0 모델만 사용하는 관리형 옵션입니다.
  > 기존 Ollama 설정은 그대로 작동하며, "고급 옵션" 아래에서 계속 사용할 수 있습니다.
- en:
  > CalmMail's standard local AI now uses an Apache 2.0–only managed option.
  > Your existing Ollama setup keeps working under the new "Advanced" disclosure.

### `localAi.migration.trySwitch`
- ko: `관리형 옵션으로 바꾸기`
- en: `Switch to managed`

### `localAi.migration.keepOllama`
- ko: `지금은 그대로 두기`
- en: `Keep as is for now`

---

## Removal checklist (when Phase 3 wires these in)

Keys to **remove** from `dictionaries.ts`:

- `localAi.wizard.llamacppTitle`
- `localAi.wizard.llamacppDesc`
- `localAi.wizard.selectOllama`
- `localAi.wizard.selectLlamacpp`
- `localAi.llamacpp.start`
- `localAi.llamacpp.skipHint`
- `localAi.llamacpp.done`

Keys to **rewrite** (keep id, swap text):

- `localAi.modeOpt.local.hint` (drop "Ollama")
- `localAi.wizard.ollamaTitle` → renamed to `localAi.wizard.ollamaAdvancedTitle`
- `localAi.wizard.ollamaDesc` → renamed to `localAi.wizard.ollamaAdvancedDesc`
- `localAi.ollama.*` step copy stays but is shown only inside the Advanced
  disclosure.
