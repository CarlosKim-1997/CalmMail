/**
 * Registers all IPC handlers with the main process.
 *
 * Each handler is intentionally thin: it routes to a module and returns a
 * plain-data response. No business logic lives here.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IpcChannels, type IpcContract } from '@shared/ipc';
import {
  clearStoredTokens,
  getStoredTokens,
  hasGmailModifyScope,
  isGmailConfigured,
  runGmailModifyConsentFlow,
  runGmailOAuthFlow,
  runGmailReconnectFlow,
} from '@main/modules/gmail/auth';
import { notifyAuthChanged } from '@main/modules/gmail/authNotify';
import {
  getGmailSessionFlags,
  markGmailSessionHealthy,
  resetGmailSessionState,
  verifyGmailSession,
} from '@main/modules/gmail/session';
import { markMessagesAsRead } from '@main/modules/gmail/client';
import { buildGmailThreadUrl } from '@main/modules/gmail/links';
import { refreshStoredUnreadFlags } from '@main/modules/gmail/readStateSync';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';
import { contactsRepo } from '@main/modules/persistence/repositories/contactsRepo';
import { awaitedRepo } from '@main/modules/persistence/repositories/awaitedRepo';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { notificationsRepo } from '@main/modules/persistence/repositories/notificationsRepo';
import { briefingsRepo } from '@main/modules/persistence/repositories/briefingsRepo';
import { generateMorningBriefing } from '@main/modules/ai/briefing';
import { estimateBriefingNow } from '@main/modules/ai/estimateBriefing';
import type { BriefingProgress } from '@shared/types';
import {
  analyzeHardware,
  getCachedHardwareCapability,
} from '@main/modules/localAi/capabilityCheck';
import { prepareLlamacppRuntime } from '@main/modules/localAi/llamacppPrepare';
import { localAiManager } from '@main/modules/localAi/manager';
import {
  ensureBinary,
  ensureModel,
  getServerInfo,
  isBinaryReady,
  isModelReady,
  isServerRunning,
  stopServer,
} from '@main/modules/localAi/llamacppRuntime';
import {
  MODELS as LOCAL_AI_MODELS,
  getModelById,
} from '@main/modules/localAi/modelCatalog';
import {
  buildLocalAiAcceptance,
  isLocalAiNoticeCurrent,
} from '@shared/localAiPolicy';
import { listProviders } from '@main/modules/ai/registry';
import { pingCloudConnectivity } from '@main/modules/ai/connectivity';
import { getQuotaStatus } from '@main/modules/ai/quota';
import { byokKeysStatus, setByokApiKey } from '@main/modules/ai/userKeys';
import { secureStore } from '@main/modules/persistence/secureStore';
import { monitorScheduler } from '@main/modules/monitor/scheduler';
import { getInboxSyncSnapshot, runInboxSyncForUi } from '@main/modules/monitor/inboxSync';
import { userMarkAwaited } from '@main/modules/rules/awaitedReply';
import { assertCanAddAwaitedWaitingRow } from '@main/modules/monetization/limits';
import { buildMonetizationSnapshot } from '@main/modules/monetization/snapshot';
import {
  applyBillingStub,
  applyPlansTier,
  BillingError,
  buildBillingStatus,
  refreshBillingCache,
  refreshBillingFull,
} from '@main/modules/monetization/billing';
import {
  completeStripeCheckout,
  startCustomerPortal,
  startPremiumCheckout,
} from '@main/modules/monetization/stripeBilling';
import { categorySuggestionsRepo } from '@main/modules/persistence/repositories/categorySuggestionsRepo';
import { vipSuggestionsRepo } from '@main/modules/persistence/repositories/vipSuggestionsRepo';
import { senderProfilesRepo } from '@main/modules/persistence/repositories/senderProfilesRepo';
import { NON_IMPORTANT_CATEGORIES } from '@main/modules/rules/categorize';
import { relationshipMemory } from '@main/modules/memory/relationships';
import { bootstrapInboxFromGmail } from '@main/modules/gmail/inboxBootstrap';
import { backfillRecentEmails } from '@main/modules/rules/backfill';
import type {
  AuthStatus,
  AwaitedReply,
  CategorySuggestion,
  VipSuggestion,
  LocalAiManagedSetupResult,
  LocalAiManagedStatus,
  LocalAiModelInfo,
  LocalAiPrepareResult,
  LocalAiSetupProgress,
} from '@shared/types';

const PROMOTE_SUGGEST_THRESHOLD = 3;

type Handler<K extends keyof IpcContract> = (
  req: IpcContract[K]['req'],
) => IpcContract[K]['res'] | Promise<IpcContract[K]['res']>;

function register<K extends keyof IpcContract>(channel: K, fn: Handler<K>) {
  ipcMain.handle(channel as string, async (_evt, req: IpcContract[K]['req']) => fn(req));
}

export function registerIpcHandlers(): void {
  register(IpcChannels.authStatus, () => buildAuthStatus());

  register(IpcChannels.gmailConnect, async () => {
    const res = await runGmailOAuthFlow({ mode: 'initial' });
    if (!res.ok) {
      throw new Error(res.reason);
    }
    markGmailSessionHealthy();
    void bootstrapInboxFromGmail()
      .then(() => backfillRecentEmails())
      .catch((err) => {
        console.warn('[inbox] post-connect bootstrap failed', err);
      });
    return buildAuthStatus();
  });

  register(IpcChannels.gmailReconnect, async () => {
    const res = await runGmailReconnectFlow();
    if (!res.ok) {
      throw new Error(res.reason);
    }
    markGmailSessionHealthy();
    void bootstrapInboxFromGmail()
      .then(() => backfillRecentEmails())
      .catch((err) => {
        console.warn('[inbox] post-reconnect bootstrap failed', err);
      });
    return buildAuthStatus();
  });

  register(IpcChannels.gmailDisconnect, () => {
    clearStoredTokens();
    resetGmailSessionState();
    notifyAuthChanged();
    return buildAuthStatus();
  });

  register(IpcChannels.gmailRequestModifyScope, async () => {
    const res = await runGmailModifyConsentFlow();
    if (!res.ok) {
      throw new Error(res.reason);
    }
    markGmailSessionHealthy();
    return buildAuthStatus();
  });

  register(IpcChannels.shellOpenExternal, ({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { ok: true as const };
  });

  register(IpcChannels.inboxRecent, ({ limit }) =>
    emailsRepo.recent(limit ?? 50),
  );
  register(IpcChannels.inboxImportant, ({ limit }) =>
    emailsRepo.important(limit ?? 50),
  );
  register(IpcChannels.inboxNonImportant, ({ limit }) =>
    emailsRepo.nonImportant(limit ?? 30),
  );

  register(IpcChannels.inboxOpenInGmail, ({ emailId, threadId }) => {
    const email = emailsRepo.get(emailId);
    if (!email) {
      throw new Error('email_not_found');
    }
    const openCount = emailsRepo.incrementOpenCount(emailId);
    const tokens = getStoredTokens();
    const url = buildGmailThreadUrl({
      threadId: threadId || email.threadId,
      authUserEmail: tokens?.user_email,
    });
    void shell.openExternal(url);

    if (
      NON_IMPORTANT_CATEGORIES.has(email.category) &&
      openCount >= PROMOTE_SUGGEST_THRESHOLD
    ) {
      categorySuggestionsRepo.upsertOpen(
        email.from.email,
        email.category,
        openCount,
      );
    }

    return { ok: true as const, openCount };
  });

  register(IpcChannels.inboxRefreshReadState, async (req) => {
    const emailIds = req && 'emailIds' in req ? req.emailIds : undefined;
    const updated = await refreshStoredUnreadFlags(
      emailIds?.length ? { emailIds } : undefined,
    );
    return { updated };
  });

  register(IpcChannels.inboxTriageDismiss, async ({ emailIds }) => {
    const prefs = preferencesMemory.get();
    let gmailMarked = 0;
    if (prefs.triageGmailMarkReadEnabled && hasGmailModifyScope()) {
      try {
        gmailMarked = await markMessagesAsRead(emailIds);
        const dismissed = emailsRepo.markTriageReadLocally(emailIds);
        return { dismissed, gmailMarked };
      } catch (err) {
        console.warn('[triage] Gmail mark-read failed; falling back to local dismiss', err);
      }
    }
    const dismissed = emailsRepo.markTriageDismissed(emailIds);
    return { dismissed, gmailMarked: 0 };
  });

  register(IpcChannels.inboxSuggestionsList, () => {
    const rows = categorySuggestionsRepo.listOpen();
    const out: CategorySuggestion[] = rows.map((r) => {
      const contact = contactsRepo.get(r.sender_email);
      return {
        id: r.id,
        senderEmail: r.sender_email,
        senderName: contact?.displayName ?? null,
        category: r.category,
        openCount: r.open_count,
        createdAt: r.created_at,
      };
    });
    return out;
  });

  register(IpcChannels.inboxSuggestionsResolve, ({ id, resolution }) => {
    const rows = categorySuggestionsRepo.listOpen();
    const target = rows.find((r) => r.id === id);
    if (target && resolution === 'promoted_vip') {
      relationshipMemory.userEdit({
        email: target.sender_email,
        isVip: true,
      });
    }
    categorySuggestionsRepo.resolve(id, resolution);
    return { ok: true as const };
  });

  register(IpcChannels.vipSuggestionsList, () => {
    const rows = vipSuggestionsRepo.listOpen();
    const out: VipSuggestion[] = rows.map((r) => {
      const contact = contactsRepo.get(r.contact_email);
      return {
        id: r.id,
        contactEmail: r.contact_email,
        displayName: contact?.displayName ?? null,
        awaitedCount: r.awaited_count,
        createdAt: r.created_at,
      };
    });
    return out;
  });

  register(IpcChannels.vipSuggestionsResolve, ({ id, resolution }) => {
    const rows = vipSuggestionsRepo.listOpen();
    const target = rows.find((r) => r.id === id);
    if (target && resolution === 'promoted_vip') {
      relationshipMemory.userEdit({
        email: target.contact_email,
        isVip: true,
      });
    }
    vipSuggestionsRepo.resolve(id, resolution);
    return { ok: true as const };
  });

  register(IpcChannels.contactsList, () => contactsRepo.list());
  register(IpcChannels.contactUpsert, (req) => contactsRepo.upsert(req));

  register(IpcChannels.awaitedList, () => awaitedRepo.list());
  register(IpcChannels.awaitedMark, ({ threadId, expectedByMinutes }) => {
    assertCanAddAwaitedWaitingRow(threadId);
    // The user may "mark awaited" on an existing thread we already store.
    const recent = emailsRepo.recent(200);
    const email = recent.find((e) => e.threadId === threadId);
    const contact = email?.from.email ?? 'unknown';
    const subject = email?.subject ?? '(no subject)';
    const sentAt = email?.receivedAt ?? Date.now();
    return userMarkAwaited(threadId, contact, subject, sentAt, expectedByMinutes);
  });
  register(IpcChannels.awaitedResolve, ({ threadId }) => {
    awaitedRepo.setStatus(threadId, 'received');
  });

  register(IpcChannels.senderProfilesList, ({ kind, limit }) =>
    senderProfilesRepo.list({ kind, limit: limit ?? 100 }),
  );
  register(IpcChannels.senderProfilePin, ({ email, kind, affiliation }) =>
    senderProfilesRepo.userEdit(email, {
      kind,
      affiliation: affiliation ?? null,
      pinned: true,
    }),
  );

  register(IpcChannels.prefsGet, () => preferencesMemory.get());
  register(IpcChannels.prefsSet, (req) => preferencesMemory.patch(req));
  register(IpcChannels.monetizationGet, () => {
    const prefs = refreshBillingCache();
    return buildMonetizationSnapshot(prefs);
  });
  register(IpcChannels.premiumLearnMore, () => {
    const url =
      process.env.CALMMAIL_PREMIUM_INFO_URL?.trim() || 'https://calmmail.app/premium';
    void shell.openExternal(url);
    return { ok: true as const };
  });
  register(IpcChannels.billingGetStatus, () =>
    buildBillingStatus(refreshBillingCache()),
  );
  register(IpcChannels.billingRefresh, async () => refreshBillingFull());
  register(IpcChannels.billingPlansSetTier, ({ tier }) => {
    try {
      return applyPlansTier(tier);
    } catch (e) {
      throw billingIpcError(e);
    }
  });
  register(IpcChannels.billingStubApply, (req) => {
    try {
      return applyBillingStub(req);
    } catch (e) {
      throw billingIpcError(e);
    }
  });
  register(IpcChannels.billingOpenCheckout, async () => {
    try {
      const started = await startPremiumCheckout();
      void shell.openExternal(started.url);
      return { ok: true as const, url: started.url, source: started.source };
    } catch (e) {
      throw billingIpcError(e);
    }
  });
  register(IpcChannels.billingOpenPortal, async () => {
    try {
      const { url } = await startCustomerPortal();
      void shell.openExternal(url);
      return { ok: true as const, url };
    } catch (e) {
      throw billingIpcError(e);
    }
  });
  register(IpcChannels.billingCompleteCheckout, async ({ sessionId }) => {
    try {
      return await completeStripeCheckout(sessionId);
    } catch (e) {
      throw billingIpcError(e);
    }
  });

  register(IpcChannels.briefingEstimate, () => estimateBriefingNow());

  ipcMain.handle(
    IpcChannels.briefingGenerate,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const send = (p: BriefingProgress) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.evtBriefingProgress, p);
        }
      };
      return generateMorningBriefing(send);
    },
  );

  register(IpcChannels.briefingLatest, () => briefingsRepo.latest());

  register(IpcChannels.aiProvidersStatus, () =>
    listProviders().map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      isCloud: p.isCloud,
    })),
  );
  register(IpcChannels.aiCloudPing, async () => pingCloudConnectivity());
  register(IpcChannels.aiQuotaStatus, () => getQuotaStatus());
  register(IpcChannels.aiByokKeysStatus, () => {
    const status = byokKeysStatus();
    return {
      ...status,
      secureStoreAvailable: secureStore.isAvailable(),
    };
  });
  register(IpcChannels.aiByokKeySet, ({ provider, apiKey }) => {
    setByokApiKey(provider, apiKey);
    return { ok: true as const };
  });

  register(IpcChannels.hardwareGetCached, () => getCachedHardwareCapability());
  register(IpcChannels.hardwareAnalyze, () => analyzeHardware());

  register(IpcChannels.localAiOpenOllamaDownloadPage, () => {
    void shell.openExternal('https://ollama.com/download');
    return { ok: true as const };
  });
  register(IpcChannels.localAiRefreshOllama, async () => ({
    detected: await localAiManager.refresh(),
  }));

  register(IpcChannels.notificationsList, () =>
    notificationsRepo.listActive(100),
  );
  register(IpcChannels.notificationsDismiss, ({ id }) => {
    notificationsRepo.dismiss(id);
  });

  register(IpcChannels.inboxSyncStatus, () => getInboxSyncSnapshot());

  register(IpcChannels.monitorRunNow, async () => {
    const snap = await runInboxSyncForUi();
    void backfillRecentEmails().catch(() => {
      /* best-effort */
    });
    return snap;
  });

  ipcMain.handle(
    IpcChannels.localAiPrepareLlamacpp,
    async (event): Promise<LocalAiPrepareResult> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const send = (p: LocalAiSetupProgress) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.evtLocalAiSetupProgress, p);
        }
      };
      return prepareLlamacppRuntime(send);
    },
  );

  register(IpcChannels.localAiManagedListModels, (): LocalAiModelInfo[] =>
    LOCAL_AI_MODELS.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      shortDescription: m.shortDescription,
      license: m.license,
      minRamGb: m.minRamGb,
      approxBytes: m.approxBytes,
    })),
  );

  register(IpcChannels.localAiManagedStatus, (): LocalAiManagedStatus => {
    const prefs = preferencesMemory.get();
    const info = getServerInfo();
    return {
      binaryReady: isBinaryReady(),
      modelReady: isModelReady(prefs.localAiModelId),
      serverRunning: isServerRunning(),
      port: info?.port ?? null,
      loadedModelId: info?.modelId ?? null,
    };
  });

  ipcMain.handle(
    IpcChannels.localAiManagedSetup,
    async (event, req: { modelId: string }): Promise<LocalAiManagedSetupResult> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const send = (p: LocalAiSetupProgress) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.evtLocalAiSetupProgress, p);
        }
      };

      const prefs = preferencesMemory.get();
      if (!isLocalAiNoticeCurrent(prefs)) {
        return { ok: false, errorCode: 'notice_not_accepted' };
      }

      const model = getModelById(req.modelId as LocalAiModelInfo['id']);
      if (!model) {
        return { ok: false, errorCode: 'unknown_model', errorDetail: req.modelId };
      }

      send({ phase: 'init', percent: 2 });

      const bin = await ensureBinary(send);
      if (!bin.ok) {
        send({ phase: 'error', percent: 0 });
        return {
          ok: false,
          errorCode: bin.errorCode ?? 'binary_missing',
          errorDetail: bin.errorDetail,
        };
      }

      const mdl = await ensureModel(model.id, send);
      if (!mdl.ok) {
        send({ phase: 'error', percent: 0 });
        return {
          ok: false,
          errorCode: mdl.errorCode ?? 'model_missing',
          errorDetail: mdl.errorDetail,
        };
      }

      // Record the chosen model so the provider/manager pick it up.
      preferencesMemory.patch({
        localAiModelId: model.id,
        localAiPreferredRuntime: 'managed',
      });

      send({ phase: 'done', percent: 100 });
      return { ok: true };
    },
  );

  register(IpcChannels.localAiManagedStopServer, async () => {
    await stopServer();
    return { ok: true as const };
  });

  register(IpcChannels.localAiAcceptNotice, () =>
    preferencesMemory.patch({ localAiAcceptedNotices: buildLocalAiAcceptance() }),
  );

  register(IpcChannels.localAiReadNotices, () => {
    // Packaged: shipped via electron-builder extraResources at
    // <resources>/THIRD_PARTY_NOTICES.md. Dev: repo root.
    const candidates = [
      app.isPackaged ? path.join(process.resourcesPath, 'THIRD_PARTY_NOTICES.md') : null,
      path.join(app.getAppPath(), 'THIRD_PARTY_NOTICES.md'),
      path.join(app.getAppPath(), '..', 'THIRD_PARTY_NOTICES.md'),
    ].filter((p): p is string => p != null);
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          return { ok: true as const, content: fs.readFileSync(p, 'utf-8') };
        }
      } catch {
        /* try next candidate */
      }
    }
    return { ok: false as const, content: '' };
  });
}

function billingIpcError(e: unknown): Error {
  if (e instanceof BillingError) return new Error(e.code);
  throw e;
}

function buildAuthStatus(): AuthStatus {
  const tokens = getStoredTokens();
  const linked = !!tokens?.access_token || !!tokens?.refresh_token;
  const { sessionHealthy, reconnectNeeded } = getGmailSessionFlags();
  return {
    gmailConnected: linked,
    gmailEmail: tokens?.user_email ?? null,
    gmailSessionHealthy: linked && sessionHealthy && !reconnectNeeded,
    gmailReconnectNeeded: linked && reconnectNeeded,
    gmailModifyScopeGranted: hasGmailModifyScope(),
    cloudProviderConfigured: listProviders().some((p) => p.isCloud && p.isConfigured()),
    gmailOAuthConfigured: isGmailConfigured(),
  };
}


// silence "unused" on AwaitedReply because we re-export through inference
void (null as unknown as AwaitedReply);
