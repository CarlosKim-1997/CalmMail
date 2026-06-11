/**
 * Shared domain types used by both the Electron main process and the renderer.
 *
 * These types are *transport types*: they cross the IPC boundary and must stay
 * plain-data (JSON-serializable). Internal implementation types of individual
 * layers may live next to those layers.
 */

// ---------- Email primitives (minimal, anti-creepy on purpose) ----------

export interface EmailAddress {
  name: string | null;
  email: string;
}

/**
 * A *minimal* projection of an email. We deliberately do not transport raw
 * body HTML into the renderer unless the user has explicitly opened the item.
 * The monitoring / rule layer mostly works off of metadata + a snippet.
 */
export interface EmailSummary {
  id: string;          // Gmail message id
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  snippet: string;     // short preview, capped
  receivedAt: number;  // unix ms
  isUnread: boolean;
  labels: string[];
  importanceScore: number;   // 0..100 from the rule engine
  priority: NotificationPriority;
  reasons: ImportanceReason[]; // why the rule engine scored this
  /**
   * Coarse, deterministic bucket derived primarily from Gmail's category
   * labels (`CATEGORY_PROMOTIONS` etc.). Used to group dashboard rows and
   * to decide which messages live in the "non-important" section.
   */
  category: EmailCategory;
  /** How many times the user clicked-through to read this email in Gmail. */
  openCount: number;
  /**
   * User dismissed this row in mail triage without marking read in Gmail.
   * Maps to `emails.seen_by_user` in SQLite.
   */
  triageDismissed: boolean;
}

/**
 * Coarse bucket for an incoming email. Driven by Gmail category labels first
 * and falls back to "personal" when no category hint is present.
 */
export type EmailCategory =
  | 'personal'      // 1:1 or small-group mail with no marketing label
  | 'work'          // routed to user directly, business context
  | 'transactional' // receipts, security alerts, billing, calendar
  | 'notification'  // updates / forums / system notifications
  | 'social'        // social platform notifications
  | 'newsletter'    // user-subscribed digests
  | 'promotion'     // marketing / advertising
  | 'other';

export type ImportanceReason =
  | { kind: 'vip_sender'; contact: string }
  | { kind: 'awaited_reply'; threadId: string }
  | { kind: 'priority_keyword'; keyword: string }
  | { kind: 'direct_to_user' }
  | { kind: 'first_contact_unknown' }
  | { kind: 'frequent_correspondent'; contact: string };

// ---------- Notifications ----------

export type NotificationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AppNotification {
  id: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  emailId?: string;
  createdAt: number;
  delivered: boolean;
}

// ---------- Memory system ----------

export interface ContactMemory {
  email: string;
  displayName: string | null;
  isVip: boolean;
  importance: number;          // 0..100, decays over time
  averageReplyMinutes: number | null;
  lastInteractionAt: number | null;
  topicTags: string[];         // free-form, capped
  notes: string | null;        // user-set, never AI-set
}

/**
 * Coarse "what kind of sender is this" label, learned over time from headers,
 * domain shape, recurrence, and (eventually) user pins. Drives:
 *   - automatic email category override (e.g. force `promotion` for company)
 *   - briefing cluster badges so the user can see *why* the AI grouped them
 *   - dampening / boosting in importance scoring
 *
 * Buckets are deliberately small and orthogonal — finer-grained tags belong
 * in `topicTags` on the contact, not here.
 */
export type SenderKind =
  | 'person'        // a human; their messages can be `personal` or `work`
  | 'company'       // marketing / promotional sender (List-Unsubscribe etc.)
  | 'newsletter'    // user-subscribed digest
  | 'transactional' // receipts, billing, security alerts
  | 'notification'  // automated app / system notifications
  | 'unknown';      // not enough signal yet — treat conservatively

export interface SenderProfile {
  email: string;
  domain: string;
  displayName: string | null;
  kind: SenderKind;
  /**
   * Free-form short label of the inferred organisation ("Coupang") or, for a
   * person, a workplace if we have one ("Acme Inc"). Null when unknown.
   */
  affiliation: string | null;
  messageCount: number;
  /** How many bulk/marketing signals we observed (headers, hints). */
  bulkSignalCount: number;
  /** How many human signals (direct to user, replies, user opens). */
  humanSignalCount: number;
  /** 0..100. Raised by repeated observations agreeing with `kind`. */
  confidence: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /** User explicitly fixed the kind — never auto-overwrite. */
  pinned: boolean;
  notes: string | null;
}

export interface AwaitedReply {
  threadId: string;
  contact: string;             // email
  subject: string;
  sentAt: number;
  expectedByMinutes: number | null;
  status: 'waiting' | 'received' | 'dropped';
  reason: 'user_marked' | 'ai_proposed' | 'auto_inferred';
}

export interface SessionState {
  todayPriorityThreads: string[];
  recentAlertIds: string[];
  lastBriefingAt: number | null;
}

/** Background poller tick summary (main → renderer). */
export interface MonitorPollReport {
  ran: boolean;
  reason?: string;
  fetched: number;
  classified: number;
  newHighPriority: number;
  newMediumPriority: number;
}

/** Inbox cache / Gmail metadata sync state for the home screen. */
export interface InboxSyncSnapshot {
  phase: 'idle' | 'syncing';
  lastSyncAt: number | null;
  cachedMessageCount: number;
  lastNewClassified: number;
  lastReason?: string;
}

// ---------- Preferences ----------

export interface QuietHours {
  enabled: boolean;
  startHour: number;   // 0..23, local time
  endHour: number;     // 0..23, local time, exclusive
}

export type NotificationSensitivity = 'minimal' | 'balanced' | 'strict';

export type AppLanguage = 'ko' | 'en';
/**
 * Local AI runtime the user last finished setup for.
 *
 * - `none` — no runtime configured.
 * - `managed` — CalmMail-managed `llama.cpp` server with Apache-2.0 models
 *   (the standard lane). See `docs/local-ai-policy.md`.
 * - `ollama_advanced` — user-managed Ollama install. Advanced opt-in only;
 *   CalmMail does not validate the licenses of models loaded this way.
 *
 * Legacy values (`ollama`, `llamacpp`) are migrated on read in
 * `preferencesRepo.normalizeMerged`.
 */
export type LocalAiPreferredRuntime = 'none' | 'managed' | 'ollama_advanced';

/**
 * Approved standard-lane model identifiers. Must match exactly one entry in
 * {@link LOCAL_AI_MODEL_IDS} (`electron/shared/localAiPolicy.ts`).
 * Keeping the type literal here avoids a circular import for renderer code
 * that only needs the type.
 */
export type LocalAiModelId =
  | 'qwen3-4b-instruct'
  | 'mistral-7b-instruct-v0.3'
  | 'smollm2-1.7b-instruct'
  | 'phi-3.5-mini-instruct';

/**
 * Record of the user accepting the current Local AI policy
 * (`docs/local-ai-policy.md`). Setup flows refuse to download anything
 * until this is set to the current `LOCAL_AI_POLICY_VERSION`.
 */
export interface LocalAiAcceptedNotices {
  policyVersion: number;
  /** Unix-ms of acceptance. */
  acceptedAt: number;
}

export interface CategorySuggestion {
  id: number;
  senderEmail: string;
  senderName: string | null;
  category: EmailCategory;
  openCount: number;
  createdAt: number;
}

export type CategorySuggestionResolution = 'promoted_vip' | 'kept' | 'dismissed';

/** One-shot prompt: promote a frequent awaited-reply contact to VIP. */
export interface VipSuggestion {
  id: number;
  contactEmail: string;
  displayName: string | null;
  awaitedCount: number;
  createdAt: number;
}

/**
 * Daily quota snapshot for AI briefings. `limit` is null when the user is
 * unlimited (premium, AI off, or local mode). `resetAt` is the next local
 * midnight at which the counter rolls over. `mode` lets the UI tailor the
 * hint text without re-fetching prefs.
 */
export interface AiQuotaStatus {
  used: number;
  limit: number | null;
  resetAt: number;
  mode: 'cloud' | 'local' | 'off';
}

/** Cached subscription; future billing sync updates these fields. */
export type SubscriptionTier = 'free' | 'byok' | 'premium';

/**
 * How a `PriorityKeywordRule.pattern` should be matched against a message.
 * - `contains`: substring match (the most lenient; default for legacy rules).
 * - `word`: word-boundary match. Best for Latin-alphabet keywords; for Korean
 *   prefer `contains` since CJK characters aren't covered by `\w`/`\W`.
 * - `exact`: full-string equality, e.g. when matching exact subjects.
 */
export type KeywordMatchType = 'contains' | 'word' | 'exact';

/**
 * A single user-defined priority keyword. Replaces the legacy
 * `priorityKeywords: string[]` field with a richer form so users can tag
 * rules by language and weight, choose match semantics, and toggle them
 * without deleting.
 */
export interface PriorityKeywordRule {
  /** Stable id; auto-generated. Used for React keys + edits. */
  id: string;
  /** Created timestamp (unix ms). Used for UI sorting/highlight only. */
  createdAt: number;
  pattern: string;
  matchType: KeywordMatchType;
  /** `any` = applies to all emails; `ko` / `en` gate by detected language. */
  language: AppLanguage | 'any';
  caseSensitive: boolean;
  /** Importance bonus tier — low = 4, medium = 8, high = 14 (capped). */
  weight: 'low' | 'medium' | 'high';
  enabled: boolean;
}

export interface UserPreferences {
  quietHours: QuietHours;
  notificationSensitivity: NotificationSensitivity;
  /**
   * @deprecated Migrated automatically into `priorityKeywordRules` on first
   * read. Kept for one release so old prefs JSON loads cleanly.
   */
  priorityKeywords: string[];
  /** Canonical priority keyword rules; preferred over `priorityKeywords`. */
  priorityKeywordRules: PriorityKeywordRule[];
  aiMode: AiMode;
  aiProvider: AiProviderId;
  monitoringIntervalMinutes: number;
  retainEmailMetadataDays: number;  // how long EmailSummary rows are kept locally
  /** UI language. Default Korean. */
  language: AppLanguage;
  /**
   * Categories the user has historically engaged with in briefings. We
   * recompute this from the highlights set after each briefing (capped to 5).
   * Used to gently bias future briefings toward "the things you usually care
   * about" without ever overriding deterministic rules.
   */
  learnedImportantCategories: EmailCategory[];
  /** Last completed local runtime setup (wizard). */
  localAiPreferredRuntime: LocalAiPreferredRuntime;
  /**
   * Chosen standard-lane model (only meaningful when
   * `localAiPreferredRuntime === 'managed'`). Null until the user picks
   * one in the Phase 3 model picker.
   */
  localAiModelId: LocalAiModelId | null;
  /**
   * User acceptance of the Local AI policy (`docs/local-ai-policy.md`).
   * Null means the policy modal must be shown before any binary or model
   * download starts.
   */
  localAiAcceptedNotices: LocalAiAcceptedNotices | null;
  /**
   * User skipped the optional onboarding PC check (local AI). When true we
   * do not route through the capability screen on every login.
   */
  hardwareCheckDismissed: boolean;
  /** Gmail + AI setup wizard finished at least once (re-login skips wizard). */
  onboardingCompleted: boolean;
  /** Unread mail lookback for triage (7 or 14 days). */
  triageWindowDays: 7 | 14;
  /** Start with the Later group collapsed on the briefing screen. */
  triageCollapseLater: boolean;
  /**
   * Opt-in: when granted `gmail.modify`, Later dismiss also removes UNREAD in Gmail.
   * Does not send mail or change labels beyond read state.
   */
  triageGmailMarkReadEnabled: boolean;
  /** Cached tier; payment provider integration will refresh this later. */
  subscriptionTier: SubscriptionTier;
  /**
   * When set, premium features expire after this instant (ISO 8601).
   * Null means no fixed expiry in cache (e.g. legacy or dev).
   */
  premiumValidUntil: string | null;
}

/** Main-computed view for UI (includes dev-only premium bypass from env). */
export interface MonetizationSnapshot {
  /** Resolved tier after expiry checks and `CALMMAIL_DEV_PREMIUM`. */
  effectiveTier: SubscriptionTier;
  /** BYOK or Premium (or dev bypass): premium feature caps, no ads, no cloud quota. */
  hasPaidFeatures: boolean;
  /** @deprecated Use `hasPaidFeatures`; kept for existing renderer checks. */
  effectivePremium: boolean;
  showSponsorSlots: boolean;
  freeMaxAwaitedWaitingThreads: number;
  freeMinMonitoringIntervalMinutes: number;
  freeMaxCloudBriefingsPerDay: number;
  freeBriefingImportantCap: number;
  premiumBriefingImportantCap: number;
  /** Dev/test: CALMMAIL_DEV_PREMIUM=1 */
  devPremiumBypass: boolean;
  localAiRequiresPremiumBuildFlag: boolean;
  /** Dev/QA: CALMMAIL_BILLING_STUB=1 enables in-app Premium stub buttons. */
  billingStubEnabled: boolean;
  /** True when CALMMAIL_CHECKOUT_URL is set (opens external checkout). */
  checkoutUrlConfigured: boolean;
  /** STRIPE_SECRET_KEY + STRIPE_PRICE_ID_PREMIUM in operator .env. */
  stripeConfigured: boolean;
  /** Cached Stripe Customer id after Checkout. */
  stripeCustomerLinked: boolean;
}

/** Cached subscription + billing integration flags (main process). */
export interface BillingStatus {
  storedTier: SubscriptionTier;
  premiumValidUntil: string | null;
  effectiveTier: SubscriptionTier;
  hasPaidFeatures: boolean;
  billingStubEnabled: boolean;
  checkoutUrlConfigured: boolean;
  stripeConfigured: boolean;
  stripeCustomerLinked: boolean;
  /** `active` when Premium is backed by Stripe; otherwise `none`. */
  stripeSubscriptionStatus: 'active' | 'none';
}

/** Result after a billing-controlled tier change. */
export interface BillingApplyResult {
  preferences: UserPreferences;
  monetization: MonetizationSnapshot;
}

/** Result of a lightweight cloud API reachability check (main process only). */
export interface CloudConnectivityPingRow {
  id: string;
  label: string;
  configured: boolean;
  ok: boolean;
  message: string;
}

// ---------- AI ----------

export type AiMode = 'cloud' | 'local' | 'off';
export type AiProviderId = 'openai' | 'anthropic' | 'openrouter' | 'gemini' | 'local';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  isCloud: boolean;
  configured: boolean;
}

/** Mail triage bucket: read order for unread mail in scope. */
export type TriageGroupId = 'now' | 'today' | 'later';

export interface TriageItem {
  emailId: string;
  threadId: string;
  from: string;
  subject: string;
  /** One-line reason this message is in this group (user language). */
  reason: string;
}

export interface TriageScope {
  /** Window length in days (e.g. 7). */
  withinDays: number;
  /** Unread messages in inbox within the window (local cache). */
  unreadInScope: number;
  /** Unread rows assigned to triage groups (may be capped for AI). */
  triagedCount: number;
}

/** AI + sanitizer output: snapshot until the next briefing run. */
export interface TriageGroups {
  scope: TriageScope;
  now: TriageItem[];
  today: TriageItem[];
  later: TriageItem[];
}

/** Output of a morning briefing. Always structured. */
export interface MorningBriefing {
  generatedAt: number;
  generatedBy: AiProviderId;
  highlights: BriefingHighlight[];
  awaited: AwaitedReply[];
  attentionAreas: string[];   // calm, short bullets
  toneNote: string;           // single short sentence
  /**
   * Deterministic summary of *what was actually reviewed* during this
   * briefing pass. We compute this outside the AI so the UI can always show
   * the user "we did this work" even when the AI returned no highlights.
   */
  inspected: BriefingInspectionSummary;
  /**
   * Short factual reasoning the UI shows below the headline. Always present;
   * the AI is asked to fill it in the user's language, and we provide a
   * deterministic fallback derived from `inspected` when the AI omits it.
   */
  reasoning: string;
  /**
   * Unread mail sorted into Now / Today / Later. Optional for older briefings.
   */
  triage?: TriageGroups;
}

export interface BriefingInspectionSummary {
  totalScanned: number;
  importantReviewed: number;
  awaitedTracked: number;
  vipMessages: number;
  /** Category histogram across what was just scanned. */
  byCategory: Partial<Record<EmailCategory, number>>;
  /** Short slugs of the strongest reasons that fired in the rule engine. */
  triggeredReasons: string[];
  /**
   * Report-style clusters: per-category breakdown of who sent what. Lets the
   * UI prove "we already looked through this" instead of just saying
   * "nothing important". Optional for backwards-compat with old briefings.
   */
  clusters?: InspectionCluster[];
  /** Sample subjects from threads still awaiting replies. */
  awaitedTopics?: string[];
  /** VIP-sender labels that appeared in the scan window. */
  vipSenders?: string[];
}

export interface InspectionClusterSender {
  /** "Name <email>" when a name is available, otherwise the email. */
  label: string;
  count: number;
}

export interface InspectionCluster {
  category: EmailCategory;
  count: number;
  topSenders: InspectionClusterSender[];
  /** Up to 3 representative subjects, most-recent first. */
  sampleSubjects: string[];
  /**
   * Mix of sender kinds in this cluster. Lets the UI explain a cluster as
   * e.g. "8 promotions (all company senders)" or call out the rare personal
   * email hiding in a noisy bucket.
   */
  kindBreakdown?: Partial<Record<SenderKind, number>>;
}

export interface BriefingHighlight {
  emailId: string;
  threadId: string;
  from: string;
  subject: string;
  oneLineSummary: string;
  whyItMatters: ImportanceReason[];
}

/** Main → renderer while `briefingGenerate` runs. */
export type BriefingProgressPhase =
  | 'prepare'
  | 'gather'
  | 'inspect'
  | 'ai'
  | 'triage'
  | 'finalize'
  | 'done';

export interface BriefingProgress {
  phase: BriefingProgressPhase;
  /** 0..100 — authoritative milestones from the main process. */
  percent: number;
  estimatedTotalMs: number;
  estimatedMinSec: number;
  estimatedMaxSec: number;
  totalScanned: number;
  isCloud: boolean;
}

/** Prefetch estimate (optional IPC before starting a briefing). */
export interface BriefingDurationEstimate {
  estimatedMs: number;
  estimatedMinSec: number;
  estimatedMaxSec: number;
  totalScanned: number;
  importantPoolSize: number;
  /** Unread in triage window (inbox DB). */
  unreadInScope: number;
  /** Unread rows triaged this pass (capped). */
  aiTriageCount: number;
  /** Cloud: rows the model may override (rest are rule-sorted). */
  ambiguousTriageCount: number;
  /** Local: all triage by rules; cloud: rules + sparse AI overrides. */
  triageByRules: boolean;
  aiMode: AiMode;
  isCloud: boolean;
  hardwareVerdict: HardwareCapability['verdict'] | null;
}

// ---------- Memory proposals (AI -> rule engine -> persistence) ----------

export type MemoryProposalAction =
  | 'increase_importance'
  | 'decrease_importance'
  | 'add_topic_tag'
  | 'mark_vip'
  | 'unmark_vip'
  | 'flag_awaited_reply'
  | 'resolve_awaited_reply';

export interface MemoryProposal {
  action: MemoryProposalAction;
  targetContact?: string;      // email
  targetThreadId?: string;
  delta?: number;
  topic?: string;
  reasonType: string;          // structured short code, not free-form prose
}

export interface MemoryProposalResult {
  applied: boolean;
  rejectionReason?: string;
  finalDelta?: number;
}

// ---------- Hardware capability ----------

export interface HardwareCapability {
  totalRamGb: number;
  freeRamGb: number;
  cpuCores: number;
  cpuBrand: string;
  hasGpu: boolean;
  gpuVramGb: number | null;
  /** Single, user-friendly summary line (no ML jargon). */
  verdict: 'comfortable' | 'limited' | 'not_recommended';
  verdictMessage: string;
}

/** Last hardware probe persisted in SQLite (meta table). */
export interface CachedHardwareCapability {
  capability: HardwareCapability;
  analyzedAt: number;
}

/**
 * Progress events while preparing the managed llama.cpp runtime
 * (main → renderer). Phases are localized via i18n keys
 * `localAi.setupPhase.<phase>`; new phases must ship matching i18n.
 *
 * Legacy phases (`dirs`, `platform`) are kept for the pre-Phase 2 setup
 * path. Phase 2+ uses the explicit `binaryDownload` / `binaryVerify`
 * naming so the UI can distinguish binary vs model.
 */
export interface LocalAiSetupProgress {
  phase:
    | 'init'
    | 'dirs'
    | 'platform'
    | 'download'
    | 'verify'
    | 'modelDownload'
    | 'modelVerify'
    | 'serverStart'
    | 'done'
    | 'error';
  percent: number;
}

export interface LocalAiPrepareResult {
  ok: boolean;
  /** True when folders are ready but no download URL was configured. */
  skippedBinaryDownload?: boolean;
  error?: string;
}

/**
 * Managed-runtime setup outcome (Phase 2). Returned by the IPC channel
 * that downloads + verifies both the binary and the requested model.
 */
export interface LocalAiManagedSetupResult {
  ok: boolean;
  /**
   * Machine-readable failure code (renderer localizes via
   * `localAi.setupError.<code>`). Absent when `ok === true`.
   */
  errorCode?:
    | 'policy_blocked_unpinned_sha'
    | 'policy_blocked_host'
    | 'platform_unsupported'
    | 'unknown_model'
    | 'network_error'
    | 'http_error'
    | 'hf_auth_required'
    | 'sha_mismatch'
    | 'fs_error'
    | 'notice_not_accepted'
    | 'binary_missing'
    | 'model_missing';
  /** Human-readable detail; not user-facing copy. Useful for support. */
  errorDetail?: string;
}

/**
 * Snapshot of the managed runtime's on-disk + process state, for the UI.
 * `modelId` is taken from prefs and may not match the actually-running
 * server if the user just switched models; the renderer must compare.
 */
export interface LocalAiManagedStatus {
  /** True when the platform-appropriate llama-server file is on disk. */
  binaryReady: boolean;
  /** True when the gguf file for `modelId` is on disk and passes catalog SHA. */
  modelReady: boolean;
  /** True when a llama-server child process is alive. */
  serverRunning: boolean;
  /** Loopback port of the running server, if any. */
  port: number | null;
  /** Currently-loaded model id (server-side, not prefs). */
  loadedModelId: LocalAiModelId | null;
}

/** Catalog snapshot for the model picker — pure data, no UI strings. */
export interface LocalAiModelInfo {
  id: LocalAiModelId;
  displayName: string;
  shortDescription: string;
  license: 'Apache-2.0' | 'MIT';
  minRamGb: number;
  approxBytes: number;
}

/**
 * How well a given model is expected to run on the user's PC.
 *
 * - `recommended` — comfortable headroom + acceleration (GPU or strong CPU).
 * - `usable` — fits in RAM and will run at acceptable speed.
 * - `slow` — runs, but briefings will feel noticeably slow (or RAM is tight).
 * - `too_heavy` — not enough RAM; downloading would likely waste disk.
 *
 * The lightest catalog model is floored at `slow` so a fallback always
 * exists, per `docs/local-ai-policy.md` §3.
 */
export type LocalAiModelFit = 'recommended' | 'usable' | 'slow' | 'too_heavy';

export interface LocalAiModelRecommendation {
  modelId: LocalAiModelId;
  fit: LocalAiModelFit;
  /** The single pre-selected pick the UI should default to. */
  isPrimary: boolean;
}

/**
 * Result of {@link recommendLocalAiModels}. `models` is ordered best→worst
 * and contains every catalog model exactly once.
 */
export interface LocalAiRecommendation {
  models: LocalAiModelRecommendation[];
  /** Pre-select target; null only when the catalog is empty. */
  primaryModelId: LocalAiModelId | null;
  /**
   * True when a real hardware probe backed the ranking. When false the
   * ranking is a conservative catalog-order fallback and the UI should
   * nudge the user to run the PC check.
   */
  basedOnHardware: boolean;
}

// ---------- Auth ----------

export interface AuthStatus {
  gmailConnected: boolean;
  gmailEmail: string | null;
  /** True when stored tokens can reach the Gmail API right now. */
  gmailSessionHealthy: boolean;
  /** True when tokens exist but need a one-tap browser re-approval. */
  gmailReconnectNeeded: boolean;
  /** True when the stored token includes `gmail.modify` (opt-in bulk read). */
  gmailModifyScopeGranted: boolean;
  cloudProviderConfigured: boolean;
  /** True when GOOGLE_OAUTH_CLIENT_ID / SECRET are present in the environment. */
  gmailOAuthConfigured: boolean;
}
