/**
 * Canonical list of IPC channels and their typed request/response shapes.
 *
 * Renderer code should NEVER hardcode channel names — always import from here.
 * This file is the single source of truth for the renderer <-> main contract.
 */

import type {
  BillingApplyResult,
  BillingStatus,
  AiQuotaStatus,
  AppNotification,
  AuthStatus,
  AwaitedReply,
  BriefingDurationEstimate,
  BriefingProgress,
  CachedHardwareCapability,
  CategorySuggestion,
  CategorySuggestionResolution,
  VipSuggestion,
  CloudConnectivityPingRow,
  ContactMemory,
  EmailSummary,
  HardwareCapability,
  InboxSyncSnapshot,
  LocalAiManagedSetupResult,
  LocalAiManagedStatus,
  LocalAiModelId,
  LocalAiModelInfo,
  LocalAiPrepareResult,
  MonetizationSnapshot,
  MorningBriefing,
  SenderKind,
  SenderProfile,
  UserPreferences,
} from './types';

export const IpcChannels = {
  // Auth / Gmail
  authStatus: 'auth:status',
  gmailConnect: 'gmail:connect',
  gmailReconnect: 'gmail:reconnect',
  gmailDisconnect: 'gmail:disconnect',
  gmailRequestModifyScope: 'gmail:requestModifyScope',
  shellOpenExternal: 'shell:openExternal',

  // Inbox (read-only projections)
  inboxRecent: 'inbox:recent',
  inboxImportant: 'inbox:important',
  inboxNonImportant: 'inbox:nonImportant',
  inboxOpenInGmail: 'inbox:openInGmail',
  inboxRefreshReadState: 'inbox:refreshReadState',
  inboxTriageDismiss: 'inbox:triageDismiss',
  inboxSuggestionsList: 'inbox:suggestions:list',
  inboxSuggestionsResolve: 'inbox:suggestions:resolve',
  vipSuggestionsList: 'inbox:vipSuggestions:list',
  vipSuggestionsResolve: 'inbox:vipSuggestions:resolve',

  // Memory
  contactsList: 'memory:contacts:list',
  contactUpsert: 'memory:contacts:upsert',
  awaitedList: 'memory:awaited:list',
  awaitedMark: 'memory:awaited:mark',
  awaitedResolve: 'memory:awaited:resolve',
  // Sender profile cache (read + user pin/edit)
  senderProfilesList: 'memory:senderProfiles:list',
  senderProfilePin: 'memory:senderProfiles:pin',

  // Preferences
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  monetizationGet: 'monetization:get',
  premiumLearnMore: 'monetization:premiumLearnMore',
  billingGetStatus: 'billing:getStatus',
  billingRefresh: 'billing:refresh',
  billingPlansSetTier: 'billing:plansSetTier',
  billingStubApply: 'billing:stubApply',
  billingOpenCheckout: 'billing:openCheckout',
  billingOpenPortal: 'billing:openPortal',
  billingCompleteCheckout: 'billing:completeCheckout',

  // AI / briefing
  briefingGenerate: 'ai:briefing:generate',
  briefingEstimate: 'ai:briefing:estimate',
  briefingLatest: 'ai:briefing:latest',
  aiProvidersStatus: 'ai:providers:status',
  aiCloudPing: 'ai:cloud:ping',
  aiQuotaStatus: 'ai:quota:status',
  aiByokKeysStatus: 'ai:byok:keysStatus',
  aiByokKeySet: 'ai:byok:keySet',

  // Local AI / hardware
  hardwareAnalyze: 'hardware:analyze',
  hardwareGetCached: 'hardware:getCached',

  // Local AI setup (main → renderer progress on evtLocalAiSetupProgress)
  localAiOpenOllamaDownloadPage: 'localAi:openOllamaDownload',
  localAiRefreshOllama: 'localAi:refreshOllama',
  /** @deprecated Pre-Apache-2.0 stub. Will be removed in Phase 3. */
  localAiPrepareLlamacpp: 'localAi:prepareLlamacpp',
  // Managed (Apache-2.0) lane — Phase 2 backend; Phase 3 wires UI.
  localAiManagedListModels: 'localAi:managed:listModels',
  localAiManagedStatus: 'localAi:managed:status',
  localAiManagedSetup: 'localAi:managed:setup',
  localAiManagedStopServer: 'localAi:managed:stopServer',
  /** Records acceptance of the current Local AI policy version. */
  localAiAcceptNotice: 'localAi:acceptNotice',
  /** Reads the generated THIRD_PARTY_NOTICES.md for the in-app viewer. */
  localAiReadNotices: 'localAi:readNotices',

  // Notifications
  notificationsList: 'notify:list',
  notificationsDismiss: 'notify:dismiss',

  // Lifecycle / monitor
  monitorRunNow: 'monitor:runNow',
  inboxSyncStatus: 'inbox:syncStatus',

  // Renderer-bound push events from main
  evtNewNotification: 'evt:newNotification',
  evtAuthChanged: 'evt:authChanged',
  evtMonitorTick: 'evt:monitorTick',
  evtLocalAiSetupProgress: 'evt:localAiSetupProgress',
  evtBriefingProgress: 'evt:briefingProgress',
  evtBillingChanged: 'evt:billingChanged',
} as const;

export type IpcChannelName = (typeof IpcChannels)[keyof typeof IpcChannels];

// ---------- Request/response payload contracts ----------

export interface IpcContract {
  [IpcChannels.authStatus]: { req: void; res: AuthStatus };
  [IpcChannels.gmailConnect]: { req: void; res: AuthStatus };
  [IpcChannels.gmailReconnect]: { req: void; res: AuthStatus };
  [IpcChannels.gmailDisconnect]: { req: void; res: AuthStatus };
  [IpcChannels.gmailRequestModifyScope]: { req: void; res: AuthStatus };
  [IpcChannels.shellOpenExternal]: { req: { url: string }; res: { ok: true } };

  [IpcChannels.inboxRecent]: { req: { limit?: number }; res: EmailSummary[] };
  [IpcChannels.inboxImportant]: { req: { limit?: number }; res: EmailSummary[] };
  [IpcChannels.inboxNonImportant]: { req: { limit?: number }; res: EmailSummary[] };
  [IpcChannels.inboxOpenInGmail]: {
    req: { emailId: string; threadId: string };
    res: { ok: true; openCount: number };
  };
  [IpcChannels.inboxRefreshReadState]: {
    req: { emailIds?: string[] } | void;
    res: { updated: number };
  };
  [IpcChannels.inboxTriageDismiss]: {
    req: { emailIds: string[] };
    res: { dismissed: number; gmailMarked: number };
  };
  [IpcChannels.inboxSuggestionsList]: { req: void; res: CategorySuggestion[] };
  [IpcChannels.inboxSuggestionsResolve]: {
    req: { id: number; resolution: CategorySuggestionResolution };
    res: { ok: true };
  };
  [IpcChannels.vipSuggestionsList]: { req: void; res: VipSuggestion[] };
  [IpcChannels.vipSuggestionsResolve]: {
    req: { id: number; resolution: CategorySuggestionResolution };
    res: { ok: true };
  };

  [IpcChannels.contactsList]: { req: void; res: ContactMemory[] };
  [IpcChannels.contactUpsert]: { req: Partial<ContactMemory> & { email: string }; res: ContactMemory };
  [IpcChannels.awaitedList]: { req: void; res: AwaitedReply[] };
  [IpcChannels.awaitedMark]: { req: { threadId: string; expectedByMinutes?: number }; res: AwaitedReply };
  [IpcChannels.awaitedResolve]: { req: { threadId: string }; res: void };
  [IpcChannels.senderProfilesList]: {
    req: { kind?: SenderKind; limit?: number };
    res: SenderProfile[];
  };
  [IpcChannels.senderProfilePin]: {
    req: { email: string; kind: SenderKind; affiliation?: string | null };
    res: SenderProfile;
  };

  [IpcChannels.prefsGet]: { req: void; res: UserPreferences };
  [IpcChannels.prefsSet]: { req: Partial<UserPreferences>; res: UserPreferences };
  [IpcChannels.monetizationGet]: { req: void; res: MonetizationSnapshot };
  [IpcChannels.premiumLearnMore]: { req: void; res: { ok: true } };
  [IpcChannels.billingGetStatus]: { req: void; res: BillingStatus };
  [IpcChannels.billingRefresh]: { req: void; res: BillingApplyResult };
  [IpcChannels.billingPlansSetTier]: {
    req: { tier: 'free' | 'byok' };
    res: BillingApplyResult;
  };
  [IpcChannels.billingStubApply]: {
    req: { tier: 'premium' | 'free'; premiumValidUntil?: string | null };
    res: BillingApplyResult;
  };
  [IpcChannels.billingOpenCheckout]: {
    req: void;
    res: { ok: true; url: string; source: 'stripe' | 'static' | 'info' };
  };
  [IpcChannels.billingOpenPortal]: { req: void; res: { ok: true; url: string } };
  [IpcChannels.billingCompleteCheckout]: {
    req: { sessionId: string };
    res: BillingApplyResult;
  };
  [IpcChannels.evtBillingChanged]: { req: BillingApplyResult; res: void };

  [IpcChannels.briefingGenerate]: { req: void; res: MorningBriefing };
  [IpcChannels.briefingEstimate]: { req: void; res: BriefingDurationEstimate };
  [IpcChannels.briefingLatest]: { req: void; res: MorningBriefing | null };
  [IpcChannels.aiProvidersStatus]: {
    req: void;
    res: Array<{ id: string; label: string; configured: boolean; isCloud: boolean }>;
  };
  [IpcChannels.aiCloudPing]: { req: void; res: CloudConnectivityPingRow[] };
  [IpcChannels.aiQuotaStatus]: { req: void; res: AiQuotaStatus };
  [IpcChannels.aiByokKeysStatus]: {
    req: void;
    res: { openai: boolean; anthropic: boolean; secureStoreAvailable: boolean };
  };
  [IpcChannels.aiByokKeySet]: {
    req: { provider: 'openai' | 'anthropic'; apiKey: string | null };
    res: { ok: true };
  };

  [IpcChannels.hardwareAnalyze]: { req: void; res: HardwareCapability };
  [IpcChannels.hardwareGetCached]: { req: void; res: CachedHardwareCapability | null };

  [IpcChannels.localAiOpenOllamaDownloadPage]: { req: void; res: { ok: true } };
  [IpcChannels.localAiRefreshOllama]: { req: void; res: { detected: boolean } };
  [IpcChannels.localAiPrepareLlamacpp]: { req: void; res: LocalAiPrepareResult };
  [IpcChannels.localAiManagedListModels]: { req: void; res: LocalAiModelInfo[] };
  [IpcChannels.localAiManagedStatus]: { req: void; res: LocalAiManagedStatus };
  [IpcChannels.localAiManagedSetup]: {
    req: { modelId: LocalAiModelId };
    res: LocalAiManagedSetupResult;
  };
  [IpcChannels.localAiManagedStopServer]: { req: void; res: { ok: true } };
  [IpcChannels.localAiAcceptNotice]: { req: void; res: UserPreferences };
  [IpcChannels.localAiReadNotices]: {
    req: void;
    res: { ok: boolean; content: string };
  };

  [IpcChannels.notificationsList]: { req: void; res: AppNotification[] };
  [IpcChannels.notificationsDismiss]: { req: { id: string }; res: void };

  [IpcChannels.monitorRunNow]: { req: void; res: InboxSyncSnapshot };
  [IpcChannels.inboxSyncStatus]: { req: void; res: InboxSyncSnapshot };
}

export type IpcRequest<K extends keyof IpcContract> = IpcContract[K]['req'];
export type IpcResponse<K extends keyof IpcContract> = IpcContract[K]['res'];
