# CalmMail

A quiet AI-assisted background companion for Gmail users.

CalmMail is **not** an email client. It is a calm assistant that:

- Watches your inbox in the background via lightweight rules (no AI per email).
- Surfaces only the things that truly matter — VIPs, awaited replies, urgent threads.
- Generates a structured morning briefing **only when you ask**.
- Stays out of your way the rest of the time.

## Philosophy

- **Quiet intelligence.** AI runs on demand, never on every message.
- **Minimal interruption.** Notifications are rare, high-confidence, calm.
- **Context awareness.** Rule engine + memory layers, not chat history.
- **Trust-first design.** OS-encrypted secrets, no body storage, AI cannot mutate memory directly.

## Tech stack

- **Electron** + **electron-vite**
- **React** + **TypeScript**
- **Zustand** (renderer state)
- **better-sqlite3** (local persistence)
- **googleapis** (Gmail API, read-only)
- **openai** / **@anthropic-ai/sdk** (cloud AI providers)
- **systeminformation** (PC capability check for local AI)

## Project layout

```
calmmail/
├── electron/                     Electron main process + shared types
│   ├── main.ts                   Entry: window, tray, scheduler, IPC
│   ├── preload.ts                Typed bridge exposed as window.calm
│   ├── tray.ts                   Tray icon + menu
│   ├── ipc/registerHandlers.ts   Single IPC routing surface
│   ├── shared/                   Cross-process types & channel constants
│   │   ├── types.ts
│   │   └── ipc.ts
│   └── modules/                  9 architecture layers, one folder each
│       ├── gmail/                Gmail Integration Layer (auth, client)
│       ├── monitor/              Monitoring Layer (poller, scheduler)
│       ├── rules/                Rule Engine (scoring, awaited, validator)
│       ├── memory/               Memory System (session/prefs/relationships, decay)
│       ├── ai/                   AI Analysis Layer (provider abstraction)
│       │   └── providers/        OpenAI / Anthropic / Local (stub)
│       ├── notification/         Notification System (policy + manager)
│       ├── localAi/              Managed llama.cpp runtime + capability check
│       └── persistence/          SQLite DB, migrations, secure storage
│
├── src/                          Renderer (React + TS)
│   ├── App.tsx                   Route shell
│   ├── components/Sidebar.tsx
│   ├── screens/                  10 onboarding + product screens
│   ├── state/appStore.ts         Zustand store calling IPC
│   ├── lib/ipc.ts                Typed IPC wrapper
│   └── theme/tokens.css          Quiet "paper" design tokens
│
├── electron.vite.config.ts
├── tsconfig.{node,web,json}      Project references
└── package.json
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

`npm install` runs **`postinstall` → `electron-rebuild -f -w better-sqlite3`**, so the SQLite native addon is compiled for **Electron’s Node**, not your system Node. If you ever see `NODE_MODULE_VERSION` / “compiled against a different Node.js version”, run:

```bash
npm run rebuild:native
```

On Windows you still need a C++ build toolchain for native modules (e.g. **Visual Studio Build Tools** with “Desktop development with C++” or the standalone **windows-build-tools** flow on older setups).

### 2. Create Google OAuth credentials

1. Open https://console.cloud.google.com/.
2. Create a project (or reuse one) and **enable the Gmail API**.
3. Configure the OAuth consent screen (External, your email as a test user).
4. Create OAuth credentials of type **"Desktop app"**.
5. Copy the client ID + client secret into a local `.env` file:

```bash
cp .env.example .env
# Then edit .env with your Google credentials.
```

The dev server reads `.env` automatically.

The **Electron main process** loads the same `.env` at startup (`electron/bootstrapEnv.ts` via `dotenv`), so `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` are visible to Gmail OAuth. If you change `.env`, fully quit the app (tray → Quit) and start `npm run dev` again.

### 2b. Proton Mail (IMAP via Proton Bridge)

CalmMail does not connect to Proton’s cloud IMAP directly. Install **[Proton Mail Bridge](https://proton.me/mail/bridge)** on the **same machine**, then use the in-app **Connect IMAP** flow with host `127.0.0.1`, port `1143`, Bridge password, and STARTTLS (turn **off** “Use TLS” in Advanced unless Bridge is set to implicit TLS).

Step-by-step setup, troubleshooting, and security notes: [`docs/proton-bridge-imap.md`](./docs/proton-bridge-imap.md).

### 3. (Optional) Cloud AI for dev / distributor builds

The app **does not ask users for API keys**. Cloud mode is only available when
this build ships with credentials already wired in (for example `OPENAI_API_KEY`
or `ANTHROPIC_API_KEY` in `.env` next to `package.json`, loaded by the main
process at startup). Retail builds would typically use your own backend or
on-device AI instead.

### 4. Run in development

```bash
npm run dev
```

The Electron window will open. Closing the window does NOT quit the app —
quit from the tray menu.

### 5. Build for distribution

```bash
npm run make
```

Artifacts land in `release/`.

## Trust boundaries (read me before touching the AI module)

CalmMail makes several promises in code, not just in copy:

1. **Email bodies are never stored.** Only metadata + the Gmail-provided
   snippet (capped to 280 chars) lives in SQLite.
2. **AI is never invoked on every email.** The poller uses only the
   deterministic rule engine.
3. **AI cannot mutate memory.** AI returns *proposals*. They pass through
   `proposalValidator.ts`, which enforces per-proposal and per-day budgets
   and rejects forbidden actions (`mark_vip`, hallucinated thread IDs,
   over-budget deltas). Every proposal is logged in `proposal_log`.
4. **AI cannot impersonate the user.** No send / modify Gmail scopes are
   requested.
5. **Secrets need OS encryption.** If `safeStorage.isEncryptionAvailable()`
   returns false, we refuse to store the secret rather than fall back to
   plaintext.

When changing the AI layer, keep these invariants intact. The parser in
`electron/modules/ai/parseBriefing.ts` is the final filter for everything
the AI says — anything new flowing out of an AI call must pass through it
or an equivalent sanitizer.

## Phased roadmap (the spec)

- Phase 1 (this commit): app shell, Gmail OAuth, inbox reading, tray,
  monitoring, rule engine, memory, briefing, notifications, cloud AI,
  capability analysis.
- Phase 2: refined background behavior + on-device notifications polish.
- Phase 3: deeper relationship memory + per-thread expectations.
- Phase 4: alternate AI providers + structured proposal review UI.
- Phase 5: local AI runtime management — a CalmMail-managed `llama.cpp`
  runtime with Apache 2.0 GGUF models (default: Qwen3-4B-Instruct). Ollama
  remains as an opt-in **advanced** path; CalmMail does not ship, mirror,
  or recommend models loaded that way. See
  [`docs/local-ai-policy.md`](./docs/local-ai-policy.md) and
  [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Local AI standard

CalmMail's local AI runs on a **CalmMail-managed `llama.cpp` server** that
ships with the installer, loading only models distributed under
**Apache 2.0** (or, where noted, MIT). The current default is
**Qwen3-4B-Instruct (Apache 2.0)**.

- The model and runtime never see the network: `llama-server` is bound to
  `127.0.0.1` on an ephemeral port and is terminated when CalmMail quits.
- Mail bodies are never written to disk (existing trust boundary) and are
  not sent anywhere remote.
- Every binary and model is downloaded over HTTPS from an allowlisted
  source and verified by SHA-256.
- **Ollama is an advanced opt-in path.** The user is responsible for the
  licenses of any model loaded through it; CalmMail does not redistribute
  those models.

The full policy is in `docs/local-ai-policy.md` (versioned, re-prompted on
change). Third-party licenses live in `THIRD_PARTY_NOTICES.md`.

## License

UNLICENSED — internal project.
