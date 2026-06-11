# CalmMail Local AI Policy

**Policy version:** 1
**Effective from:** Phase 1 of the Apache-2.0 transition
**Status:** Source of truth. Any deviation in code, UI, or marketing copy is a bug.

CalmMail is distributed commercially. This document fixes the rules we follow
for everything that runs an AI model locally on a user's machine, so that:

1. The user keeps the privacy promise we already give them (no mail content
   ever leaves their device in local mode).
2. CalmMail does not redistribute or recommend a model whose license is
   incompatible with our commercial use.
3. The user understands what they are running and consents once, explicitly.

---

## 1. Scope

This policy covers any LLM that:

- Is downloaded by CalmMail or its installer, or
- Is launched as a child process by CalmMail, or
- Is recommended in CalmMail's UI as a setup path.

It does **not** cover models the user fetches and points CalmMail at outside
of the recommended flow ("advanced" path). Those are the user's
responsibility; CalmMail still refuses to upload their content anywhere
remote.

## 2. Permitted licenses (the "standard lane")

CalmMail's **standard local AI lane** ships only models distributed under one
of the following licenses, in this order of preference:

1. **Apache License 2.0**
2. **MIT License**
3. **BSD-2-Clause / BSD-3-Clause**

Models under any of the following are **excluded** from the standard lane,
regardless of how good they are:

- Meta Llama Community License (MAU clause + attribution obligations).
- Gemma Terms of Use (use restrictions + license inheritance for derivatives).
- Tongyi Qianwen License (custom commercial terms; MAU caveats).
- Any license that prohibits commercial use, requires re-licensing, or
  imposes user-count thresholds.

Excluded models may still be reachable through the "advanced" Ollama path
(see §6); CalmMail does not host, mirror, or recommend them in that case.

## 3. Default standard model

**Qwen3-4B-Instruct** (Apache-2.0), 4-bit quantized GGUF.

Rationale: Apache-2.0 with no MAU clauses, decent Korean coverage, ~2.5 GB
on disk, runs on common laptops without GPUs. Used as the recommended
default whenever the user's capability check is `comfortable` or `limited`.

Approved alternates (Apache-2.0 unless noted):

- **Mistral-7B-Instruct v0.3** (Apache-2.0) — for users with ≥16 GB RAM who
  prefer a larger model. Slower briefings.
- **SmolLM2-1.7B-Instruct** (Apache-2.0) — fallback for `not_recommended`
  PCs. Briefings are noticeably terser.
- **Phi-3.5-mini-instruct** (MIT) — opt-in alternate if Qwen output quality
  ever regresses for a specific build.

Any addition to this list requires:

- A pinned upstream source (Hugging Face revision pin preferred).
- A SHA-256 hash in `electron/modules/localAi/modelCatalog.ts`.
- The license file copied into `THIRD_PARTY_NOTICES.md`.

## 4. Runtime

CalmMail's **standard runtime** is `llama.cpp`'s `llama-server`, MIT-licensed
and bundled with the installer. CalmMail spawns it as a child process bound
to `127.0.0.1` on an ephemeral port. The process is terminated when CalmMail
quits.

CalmMail does **not** ship the runtime over a third-party package manager
(no `winget`, no `brew`, no Ollama). The binary is part of the CalmMail
installer artifact and its checksum is verified at startup.

## 5. Privacy guarantees (unchanged from existing trust boundaries)

- The model runs on `127.0.0.1`. No outbound network traffic is initiated
  by the runtime.
- Mail body content is never written to disk by CalmMail; the runtime sees
  only the snippet + metadata used for the current briefing call and
  releases it from memory at end of request.
- Briefing logs already in CalmMail apply unchanged: AI proposals pass
  through `proposalValidator.ts` before any persistence.

## 6. Ollama: advanced lane only

Ollama itself is MIT-licensed and acceptable. However, the **models** users
typically pull through Ollama (Llama 3.x, Gemma 2/3, Qwen2.5 with Tongyi
license, etc.) are **not all Apache-compatible**. We therefore:

- Move the Ollama setup card out of the recommended flow.
- Place it under an "Advanced" disclosure with a one-time warning modal:
  > "CalmMail does not verify or distribute the models you load through
  > Ollama. Their licenses are your responsibility, especially if you use
  > CalmMail commercially."
- Stop showing Ollama in onboarding copy / hints.
- Keep the code path working for users who already chose it. Their
  `localAiPreferredRuntime` migrates to `ollama_advanced` automatically.

The plan to fully remove the Ollama code path (Phase 6) is conditional on
telemetry-free signals: continued breakage reports, user feedback, and the
maturity of the managed runtime. There is no fixed removal date.

## 7. Download integrity

Every binary and model file CalmMail downloads must:

- Use HTTPS.
- Come from a host on the allowlist in `modelCatalog.ts` (Hugging Face
  `huggingface.co`, llama.cpp official GitHub releases, CalmMail's own
  release mirror).
- Match the SHA-256 checksum recorded in the catalog. Failures delete the
  partial file and surface a plain-language error.

## 8. User consent

Before any model or binary is downloaded for the first time, CalmMail
displays the **Local AI notice** (drafted in §Appendix A below). The user
must explicitly accept. The acceptance is stored in
`UserPreferences.localAiAcceptedNotices` as
`{ policyVersion: 1, acceptedAt: <unix-ms> }`. Re-prompting happens only
when `policyVersion` is bumped.

## 9. Notices file

`THIRD_PARTY_NOTICES.md` (root) lists every distributed third-party asset
with its license text and source URL. The file is generated by
`scripts/build-notices.ts` from the model catalog + a static map for
runtime/binary dependencies, so the repo never drifts from what we ship.

A direct link to this file is shown in the app's "About / Open source
notices" screen.

## 10. Changes to this policy

Any change to §2 (license list) or §3 (default model) requires:

- A bump of the `policyVersion` constant.
- A new acceptance prompt for existing users on next launch.
- A changelog entry in this file.

---

## Appendix A — Local AI notice (draft text, to be wired in Phase 3)

**Korean (ko)**

> CalmMail의 로컬 AI는 이 컴퓨터에서만 동작하며, 메일 내용은 외부로
> 전송되지 않습니다.
>
> 표준 옵션은 CalmMail이 직접 관리하는 llama.cpp 런타임 위에서 Apache 2.0
> 라이선스 모델만 사용합니다. 모든 다운로드는 검증된 출처와 체크섬으로
> 보호됩니다.
>
> 진행하면 위 정책에 동의한 것으로 간주됩니다. 사용된 오픈소스 라이선스는
> 설정 → 정보 → "오픈소스 고지"에서 언제든 확인할 수 있습니다.

**English (en)**

> CalmMail's local AI runs only on this computer. No mail content leaves
> your device.
>
> The standard option uses a CalmMail-managed `llama.cpp` runtime with
> Apache 2.0 licensed models only. Every download is verified by source
> and checksum.
>
> By continuing you accept this policy. The full open source notices are
> always available under Settings → About → "Open source notices".

## Appendix B — Advanced (Ollama) warning (draft text)

**Korean (ko)**

> 고급 옵션입니다. CalmMail은 Ollama로 받은 모델의 라이선스나 출처를
> 검증하지 않습니다. 상업적으로 사용하려는 경우 각 모델의 라이선스를
> 직접 확인하셔야 합니다.

**English (en)**

> This is an advanced option. CalmMail does not verify the license or
> origin of models loaded through Ollama. If you intend to use this
> commercially, you are responsible for each model's license.

## Appendix C — Ollama lane lifecycle (deprecation plan)

The Ollama path is **legacy / advanced only**. It is not part of the
standard lane and is on a deprecation track. Removal is **feedback-gated,
not date-gated**: because CalmMail ships no telemetry, the trigger is the
volume of users who still rely on Ollama (support requests, reviews,
direct feedback), not a fixed release count.

| Stage | Meaning | Trigger | Status |
|-------|---------|---------|--------|
| A. Demotion | Ollama moved behind an "advanced" disclosure + warning modal; managed runtime is the default/recommended lane. | — | Done |
| B. Deprecation notice | A visible "kept for legacy compatibility, may be removed" note in the advanced section. No behavior change. | Ships immediately. | Done |
| C. Soft removal | Advanced lane hidden by default; reachable only via an env/flag. Migration banner keeps nudging toward managed. | Confirmed very low real usage. | Pending feedback |
| D. Code removal | Delete the Ollama provider and UI; collapse the runtime router; force-migrate the preference; clean up IPC + i18n. | 1–2 stable releases after C. | Pending feedback |

### Stage D removal checklist (mechanical, when triggered)

When usage justifies full removal, these are the exact touch points:

- `electron/modules/ai/providers/ollamaProvider.ts` — delete.
- `electron/modules/ai/providers/localProvider.ts` — drop the
  `ollama_advanced` branch; the router becomes managed-only.
- `electron/modules/localAi/manager.ts` — remove the `probeOllama()` call
  and Ollama-detection state.
- `electron/shared/types.ts` — change `LocalAiPreferredRuntime` to
  `'none' | 'managed'` (remove `'ollama_advanced'`).
- `electron/modules/persistence/repositories/preferencesRepo.ts` —
  `migrateLocalAiRuntime` should coerce a stored `'ollama_advanced'` to
  `'none'` (forces a one-time managed setup), and bump
  `LOCAL_AI_POLICY_VERSION` so affected users are re-prompted.
- `electron/shared/ipc.ts` + `electron/ipc/registerHandlers.ts` — remove
  `localAiOpenOllamaDownloadPage`, `localAiRefreshOllama`, and any
  Ollama-only channels.
- `src/screens/LocalAi.tsx` — remove the advanced disclosure, the Ollama
  warning modal, and related state.
- `src/i18n/dictionaries.ts` — remove the `localAi.ollama*` keys.
- Confirm `docs/local-ai-policy.md` and `THIRD_PARTY_NOTICES.md` no longer
  reference an in-app Ollama path (the "excluded families" note stays).
