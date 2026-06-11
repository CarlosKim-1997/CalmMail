# CalmMail — Architecture notes

This document explains how the nine architecture layers fit together and why
boundaries are drawn the way they are.

## Flow of an incoming email

```
Gmail API ──► Gmail Integration Layer (client.ts)
                   │ EmailSummary (no body bytes)
                   ▼
            Monitoring Layer (poller.ts)
                   │
                   ▼
            Rule Engine
              importance.ts  ──┐
              awaitedReply.ts  │
                               ▼
            Persistence Layer (emailsRepo)
                               │
                               ▼
            Notification System (policy + manager)
                               │
                               ▼
                Renderer (Dashboard)
```

No AI is involved in this path. The AI module sits *to the side*, invoked
only when the user asks for a briefing.

## Flow of a morning briefing

```
User clicks "Generate" in Briefing.tsx
   │ IPC briefingGenerate
   ▼
ai/briefing.ts
   │
   ├─► reads important emails + awaited + VIPs
   │
   ├─► selects provider via ai/registry.ts
   │
   ├─► provider.generateBriefing()  ──► (OpenAI | Anthropic | local)
   │
   ├─► provider.proposeMemoryUpdates()
   │
   ▼
ai/parseBriefing.ts  ── sanitizer (anti-hallucination, JSON guard)
   │
   ├─► briefingsRepo.insert(...)
   │
   └─► ruleEngine.applyProposals([...])
            │
            ▼
   rules/proposalValidator.ts
       │ per-proposal & per-day budgets
       │ forbidden actions filtered
       ▼
   memory/relationships.ts  (only via validated paths)
```

`parseBriefing.ts` and `proposalValidator.ts` are the **two trust boundaries**.
The AI module never has a direct write path to the database or memory layers.

## Memory model

Three layers from the brief:

| Layer | Where | Mutability |
|------|-------|------------|
| Session state | `memory/session.ts` + `session_state` table | All writers |
| Persistent preferences | `memory/preferences.ts` + `preferences` table | User only (via `sanitize`) |
| Relationship memory | `memory/relationships.ts` + `contacts` table | User direct + validated proposals + decay |

Decay sweep runs once a day inside the scheduler and on app start. See
`memory/decay.ts`.

## Threading & process boundaries

- **Main process**: Gmail, scheduler, rules, AI, persistence, notifications.
- **Renderer**: read-only views + intent IPCs.
- **Preload**: typed bridge (`window.calm`) backed by `electron/shared/ipc.ts`.

The renderer cannot touch Node APIs. Adding a new feature follows the same
pattern every time:

1. Add types to `electron/shared/types.ts`.
2. Add an IPC channel + contract to `electron/shared/ipc.ts`.
3. Implement the handler in `electron/ipc/registerHandlers.ts`.
4. Add a method to `src/state/appStore.ts`.
5. Build the UI in a `src/screens/*.tsx` file.

## Adding a new AI provider

1. Create `electron/modules/ai/providers/<id>Provider.ts` implementing the
   `AiProvider` interface.
2. Read credentials only from **build-time env** (`electron/bootstrapEnv.ts`
   loads `.env`) and/or optional legacy `secureStore` keys — never from the
   renderer UI. See `electron/modules/ai/cloudKeys.ts` for the OpenAI/Anthropic
   pattern.
3. Register it in `ai/registry.ts`.
4. Optionally add an option in the AI Mode screen.

The provider must call `parseBriefingPayload` on its raw response — never
return raw model text up the stack.

## Adding a new memory proposal action

1. Add the action name to the `MemoryProposalAction` union.
2. Implement a case in `proposalValidator.ts` with explicit budget / safety
   logic. **Reject by default**; opt in to allowed mutations.
3. Update the system prompt in `ai/prompts.ts` so the AI knows the action
   exists, and what its rules are.

## Non-goals (do not add to MVP)

- A full email composer
- Calendar / Slack / voice
- A chat UI
- Aggressive Gmail mutations (labels, archive, send)
- Emotion / sentiment / mood inference about the user
