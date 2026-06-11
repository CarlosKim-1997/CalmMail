/**
 * Main process entry.
 *
 * Responsibilities:
 *   1. Configure single-instance lock so the tray app stays singular.
 *   2. Create the (hideable) main window.
 *   3. Register IPC handlers.
 *   4. Start the monitor scheduler + local AI manager.
 *   5. Wire up the tray.
 */

/** Must run before other local imports that read `process.env` (Gmail OAuth). */
import './bootstrapEnv';

import { BrowserWindow, app, nativeImage } from 'electron';
import * as path from 'node:path';
import { registerIpcHandlers } from './ipc/registerHandlers';
import { bindAuthWindowProvider } from './modules/gmail/authNotify';
import { verifyGmailSession } from './modules/gmail/session';
import { monitorScheduler } from './modules/monitor/scheduler';
import { localAiManager } from './modules/localAi/manager';
import { notificationManager } from './modules/notification/manager';
import { closeDb, getDb } from './modules/persistence/db';
import { createTray, destroyTray } from './tray';
import { IpcChannels } from '@shared/ipc';
import { bootstrapInboxFromGmail } from './modules/gmail/inboxBootstrap';
import { recordPollResult, toMonitorPollReport } from './modules/monitor/inboxSync';
import { backfillRecentEmails } from './modules/rules/backfill';
import { getStoredTokens } from './modules/gmail/auth';
import { BILLING_PROTOCOL } from './modules/monetization/billingEnv';
import { handleBillingDeepLink } from './modules/monetization/billingDeepLink';
import { bindBillingWindowProvider, notifyBillingChanged } from './modules/monetization/billingNotify';
import { maybeStartStripeWebhookDevServer } from './modules/monetization/stripeWebhookDev';

let mainWindow: BrowserWindow | null = null;
let quitting = false;

function getWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'CalmMail',
    backgroundColor: '#fafaf7',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(
      path.join(app.getAppPath(), 'resources/icons/app.png'),
    ),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // electron-vite injects ELECTRON_RENDERER_URL in dev.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function extractBillingArgv(argv: string[]): string | null {
  return argv.find((a) => a.startsWith(`${BILLING_PROTOCOL}://`)) ?? null;
}

async function onBillingDeepLink(raw: string): Promise<void> {
  try {
    const result = await handleBillingDeepLink(raw);
    if (result) {
      notifyBillingChanged(result);
      showWindow();
    }
  } catch (err) {
    console.warn('[billing] deep link failed', err);
  }
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(BILLING_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(BILLING_PROTOCOL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = extractBillingArgv(argv);
    if (link) void onBillingDeepLink(link);
    showWindow();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    void onBillingDeepLink(url);
  });

  app.whenReady().then(async () => {
    // Touch the DB once to run migrations early.
    getDb();

    registerIpcHandlers();
    bindBillingWindowProvider(getWindow);
    bindAuthWindowProvider(getWindow);
    maybeStartStripeWebhookDevServer();

    const launchLink = extractBillingArgv(process.argv);
    if (launchLink) void onBillingDeepLink(launchLink);

    notificationManager.bindWindowProvider(getWindow);
    await localAiManager.init();

    createWindow();
    createTray({ getWindow, showWindow });

    monitorScheduler.start();
    monitorScheduler.onTick((report) => {
      recordPollResult(report);
      const w = getWindow();
      if (w) w.webContents.send(IpcChannels.evtMonitorTick, toMonitorPollReport(report));
    });

    if (getStoredTokens()) {
      void verifyGmailSession().then((ok) => {
        if (!ok) return;
        void bootstrapInboxFromGmail()
          .then(() => backfillRecentEmails())
          .catch((err) => {
            console.warn('[inbox] startup bootstrap failed', err);
          });
      });
    }
  });

  app.on('window-all-closed', () => {
    // Stay alive — the app is background-first. Quit only via tray.
  });

  app.on('before-quit', (event) => {
    // We need an async chance to kill any spawned `llama-server` cleanly
    // before the DB closes / the process exits. Use the once-only guard
    // to avoid re-entering this handler after `app.quit()`.
    if (!quitting) {
      quitting = true;
      event.preventDefault();
      void (async () => {
        try {
          await localAiManager.shutdown();
        } catch (e) {
          console.warn('[local-ai] shutdown failed', e);
        } finally {
          monitorScheduler.stop();
          destroyTray();
          closeDb();
          app.exit(0);
        }
      })();
    }
  });
}
