import { create } from 'zustand';
import type {
  AiQuotaStatus,
  AppNotification,
  AuthStatus,
  AwaitedReply,
  CategorySuggestion,
  CategorySuggestionResolution,
  VipSuggestion,
  ContactMemory,
  EmailSummary,
  MorningBriefing,
  BriefingProgress,
  InboxSyncSnapshot,
  MonitorPollReport,
  UserPreferences,
  MonetizationSnapshot,
  BillingApplyResult,
} from '@shared/types';
import { ipc } from '@renderer/lib/ipc';

export type RouteId =
  | 'onboarding'
  | 'gmail-login'
  | 'ai-mode'
  | 'capability'
  | 'home'
  | 'briefing'
  | 'settings'
  | 'vips'
  | 'awaited'
  | 'local-ai'
  | 'plans';

interface AppState {
  route: RouteId;
  goto: (r: RouteId) => void;

  /** Gmail OAuth 실패 시 메시지; 온보딩에서 표시 후 재시도 시 초기화 */
  gmailConnectError: string | null;
  clearGmailConnectError: () => void;
  gmailReconnectError: string | null;
  clearGmailReconnectError: () => void;

  authStatus: AuthStatus | null;
  preferences: UserPreferences | null;
  monetization: MonetizationSnapshot | null;
  briefing: MorningBriefing | null;
  important: EmailSummary[];
  nonImportant: EmailSummary[];
  recent: EmailSummary[];
  awaited: AwaitedReply[];
  contacts: ContactMemory[];
  notifications: AppNotification[];
  categorySuggestions: CategorySuggestion[];
  vipSuggestions: VipSuggestion[];
  /** Daily cloud-AI briefing quota; null until first refresh. */
  aiQuota: AiQuotaStatus | null;

  isBootstrapped: boolean;
  busy: { briefing: boolean; poll: boolean };
  /** Raw IPC error message from last briefing attempt (optional UI). */
  briefingError: string | null;
  /** Live milestones while `briefingGenerate` runs (main → renderer). */
  briefingProgress: BriefingProgress | null;
  inboxSync: InboxSyncSnapshot | null;

  refreshAll: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  refreshInbox: () => Promise<void>;
  refreshMemory: () => Promise<void>;
  refreshPrefs: () => Promise<void>;
  refreshMonetization: () => Promise<void>;
  refreshBilling: () => Promise<void>;
  applyBillingResult: (res: BillingApplyResult) => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshBriefing: () => Promise<void>;
  refreshSuggestions: () => Promise<void>;
  refreshVipSuggestions: () => Promise<void>;
  resolveVipSuggestion: (
    id: number,
    resolution: CategorySuggestionResolution,
  ) => Promise<void>;
  refreshAiQuota: () => Promise<void>;
  openEmailInGmail: (email: EmailSummary) => Promise<void>;
  refreshTriageState: (emailIds?: string[]) => Promise<void>;
  dismissTriageEmails: (emailIds: string[]) => Promise<void>;
  resolveCategorySuggestion: (
    id: number,
    resolution: CategorySuggestionResolution,
  ) => Promise<void>;

  setPrefs: (patch: Partial<UserPreferences>) => Promise<void>;
  connectGmail: () => Promise<void>;
  reconnectGmail: () => Promise<void>;
  disconnectGmail: () => Promise<void>;
  requestGmailModifyScope: () => Promise<void>;
  refreshInboxSync: () => Promise<void>;
  runPollNow: () => Promise<void>;
  onMonitorTick: (report: MonitorPollReport) => void;
  generateBriefing: () => Promise<MorningBriefing | null>;
  clearBriefingError: () => void;
}

function ipcErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return String(err);
}

/**
 * When the renderer is up-to-date but the main process is still running stale
 * code (e.g. after editing main files without restarting `electron-vite dev`),
 * IPC invokes for newly-added channels throw "No handler registered ...". We
 * stop calling those channels for the rest of the session so the console
 * isn't flooded; the next `npm run dev` cycle clears this set.
 */
const unsupportedChannels = new Set<string>();
function isMissingHandlerError(msg: string): boolean {
  return msg.includes('No handler registered');
}

export const useAppStore = create<AppState>((set, get) => ({
  route: 'onboarding',
  goto: (r) =>
    set(() => ({
      route: r,
      ...(r === 'gmail-login' ? { gmailConnectError: null } : {}),
    })),

  gmailConnectError: null,
  clearGmailConnectError: () => set({ gmailConnectError: null }),
  gmailReconnectError: null,
  clearGmailReconnectError: () => set({ gmailReconnectError: null }),

  clearBriefingError: () => set({ briefingError: null }),

  authStatus: null,
  preferences: null,
  monetization: null,
  briefing: null,
  important: [],
  nonImportant: [],
  recent: [],
  awaited: [],
  contacts: [],
  notifications: [],
  categorySuggestions: [],
  vipSuggestions: [],
  aiQuota: null,

  isBootstrapped: false,
  busy: { briefing: false, poll: false },
  briefingError: null,
  briefingProgress: null,
  inboxSync: null,

  async refreshAll() {
    await Promise.all([
      get().refreshAuth(),
      get().refreshPrefs(),
      get().refreshBilling(),
      get().refreshInbox(),
      get().refreshMemory(),
      get().refreshNotifications(),
      get().refreshBriefing(),
      get().refreshSuggestions(),
      get().refreshVipSuggestions(),
      get().refreshAiQuota(),
      get().refreshInboxSync(),
    ]);
    set({ isBootstrapped: true });
  },

  async refreshInboxSync() {
    if (unsupportedChannels.has(ipc.channels.inboxSyncStatus)) return;
    try {
      const inboxSync = await ipc.invoke(ipc.channels.inboxSyncStatus);
      set({ inboxSync });
    } catch (err) {
      const msg = ipcErrorMessage(err);
      if (isMissingHandlerError(msg)) {
        unsupportedChannels.add(ipc.channels.inboxSyncStatus);
      }
    }
  },

  onMonitorTick(report: MonitorPollReport) {
    set((s) => ({
      inboxSync: {
        phase: 'idle',
        lastSyncAt: report.ran ? Date.now() : s.inboxSync?.lastSyncAt ?? null,
        cachedMessageCount: s.inboxSync?.cachedMessageCount ?? 0,
        lastNewClassified: report.classified,
        lastReason: report.reason,
      },
    }));
  },

  async refreshAiQuota() {
    if (unsupportedChannels.has(ipc.channels.aiQuotaStatus)) return;
    try {
      const aiQuota = await ipc.invoke(ipc.channels.aiQuotaStatus);
      set({ aiQuota });
    } catch (err) {
      const msg = ipcErrorMessage(err);
      if (isMissingHandlerError(msg)) {
        unsupportedChannels.add(ipc.channels.aiQuotaStatus);
        console.warn(
          '[aiQuota] main process is missing this handler — restart `npm run dev` to pick up new IPC channels.',
        );
        return;
      }
      console.warn('aiQuota refresh failed', err);
    }
  },

  async refreshAuth() {
    const s = await ipc.invoke(ipc.channels.authStatus);
    set({ authStatus: s });
  },

  async refreshInbox() {
    const [important, recent, nonImportant] = await Promise.all([
      ipc.invoke(ipc.channels.inboxImportant, { limit: 50 }),
      ipc.invoke(ipc.channels.inboxRecent, { limit: 50 }),
      ipc.invoke(ipc.channels.inboxNonImportant, { limit: 30 }),
    ]);
    set({ important, recent, nonImportant });
  },

  async refreshSuggestions() {
    const categorySuggestions = await ipc.invoke(ipc.channels.inboxSuggestionsList);
    set({ categorySuggestions });
  },

  async refreshVipSuggestions() {
    const vipSuggestions = await ipc.invoke(ipc.channels.vipSuggestionsList);
    set({ vipSuggestions });
  },

  async resolveVipSuggestion(id, resolution) {
    await ipc.invoke(ipc.channels.vipSuggestionsResolve, { id, resolution });
    await Promise.all([
      get().refreshVipSuggestions(),
      get().refreshMemory(),
    ]);
  },

  async refreshTriageState(emailIds) {
    await ipc.invoke(
      ipc.channels.inboxRefreshReadState,
      emailIds?.length ? { emailIds } : {},
    );
    await get().refreshInbox();
  },

  async dismissTriageEmails(emailIds) {
    if (emailIds.length === 0) return;
    await ipc.invoke(ipc.channels.inboxTriageDismiss, { emailIds });
    await get().refreshInbox();
  },

  async openEmailInGmail(email) {
    await ipc.invoke(ipc.channels.inboxOpenInGmail, {
      emailId: email.id,
      threadId: email.threadId,
    });
    await get().refreshTriageState([email.id]);
    await get().refreshSuggestions();
  },

  async resolveCategorySuggestion(id, resolution) {
    await ipc.invoke(ipc.channels.inboxSuggestionsResolve, { id, resolution });
    await Promise.all([
      get().refreshSuggestions(),
      get().refreshMemory(),
    ]);
  },

  async refreshMemory() {
    const [awaited, contacts] = await Promise.all([
      ipc.invoke(ipc.channels.awaitedList),
      ipc.invoke(ipc.channels.contactsList),
    ]);
    set({ awaited, contacts });
  },

  async refreshPrefs() {
    const preferences = await ipc.invoke(ipc.channels.prefsGet);
    set({ preferences });
  },

  async refreshMonetization() {
    const monetization = await ipc.invoke(ipc.channels.monetizationGet);
    set({ monetization });
  },

  async refreshBilling() {
    const res = await ipc.invoke(ipc.channels.billingRefresh);
    set({ preferences: res.preferences, monetization: res.monetization });
  },

  async applyBillingResult(res) {
    set({ preferences: res.preferences, monetization: res.monetization });
    await get().refreshAiQuota();
  },

  async refreshNotifications() {
    const notifications = await ipc.invoke(ipc.channels.notificationsList);
    set({ notifications });
  },

  async refreshBriefing() {
    const briefing = await ipc.invoke(ipc.channels.briefingLatest);
    set({ briefing });
  },

  async setPrefs(patch) {
    const preferences = await ipc.invoke(ipc.channels.prefsSet, patch);
    set({ preferences });
    await Promise.all([
      get().refreshBilling(),
      get().refreshAiQuota(),
    ]);
  },

  async connectGmail() {
    set({ gmailConnectError: null, gmailReconnectError: null });
    try {
      const authStatus = await ipc.invoke(ipc.channels.gmailConnect);
      set({ authStatus });
    } catch (err) {
      const message = ipcErrorMessage(err);
      try {
        await get().refreshAuth();
      } catch {
        /* ignore */
      }
      set({ gmailConnectError: message });
      get().goto('onboarding');
    }
  },

  async reconnectGmail() {
    set({ gmailReconnectError: null });
    try {
      const authStatus = await ipc.invoke(ipc.channels.gmailReconnect);
      set({ authStatus });
      await get().runPollNow();
      await get().refreshInbox();
    } catch (err) {
      const message = ipcErrorMessage(err);
      try {
        await get().refreshAuth();
      } catch {
        /* ignore */
      }
      set({ gmailReconnectError: message });
    }
  },

  async disconnectGmail() {
    const authStatus = await ipc.invoke(ipc.channels.gmailDisconnect);
    set({ authStatus });
  },

  async requestGmailModifyScope() {
    const authStatus = await ipc.invoke(ipc.channels.gmailRequestModifyScope);
    set({ authStatus });
  },

  async runPollNow() {
    set((s) => ({
      busy: { ...s.busy, poll: true },
      inboxSync: {
        phase: 'syncing',
        lastSyncAt: s.inboxSync?.lastSyncAt ?? null,
        cachedMessageCount: s.inboxSync?.cachedMessageCount ?? 0,
        lastNewClassified: 0,
        lastReason: s.inboxSync?.lastReason,
      },
    }));
    try {
      const inboxSync = await ipc.invoke(ipc.channels.monitorRunNow);
      await Promise.all([
        get().refreshInbox(),
        get().refreshMemory(),
        get().refreshNotifications(),
        get().refreshSuggestions(),
        get().refreshVipSuggestions(),
      ]);
      set({ inboxSync });
    } finally {
      set((s) => ({ busy: { ...s.busy, poll: false } }));
    }
  },

  async generateBriefing() {
    set((s) => ({
      busy: { ...s.busy, briefing: true },
      briefingError: null,
      briefingProgress: null,
    }));

    const offProgress = ipc.on(
      ipc.channels.evtBriefingProgress,
      (p: BriefingProgress) => {
        set({ briefingProgress: p });
      },
    );

    try {
      const briefing = await ipc.invoke(ipc.channels.briefingGenerate);
      set({ briefing, briefingError: null });
      await Promise.all([
        get().refreshMemory(),
        get().refreshAiQuota(),
        get().refreshVipSuggestions(),
      ]);
      return briefing;
    } catch (err) {
      console.error('briefing failed', err);
      set({ briefingError: ipcErrorMessage(err) });
      await get().refreshAiQuota();
      return null;
    } finally {
      offProgress();
      set((s) => ({
        busy: { ...s.busy, briefing: false },
        briefingProgress: null,
      }));
    }
  },
}));
