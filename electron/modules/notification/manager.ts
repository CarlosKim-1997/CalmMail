/**
 * Notification manager.
 *
 * Sits between the rule engine output and the OS / renderer. Performs the
 * policy check, stores the notification record, and emits it.
 *
 * Emission targets:
 *   - OS notification via Electron Notification API
 *   - Renderer event ('evt:newNotification') so the UI can update its
 *     in-app bell.
 */

import { Notification, type BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc';
import { notificationsRepo } from '@main/modules/persistence/repositories/notificationsRepo';
import { sessionMemory } from '@main/modules/memory/session';
import type { AppNotification, EmailSummary, UserPreferences } from '@shared/types';
import {
  buildNotificationPayload,
  decideNotification,
} from './policy';

const THIRTY_MIN = 30 * 60 * 1000;

type WindowProvider = () => BrowserWindow | null;
let getWindow: WindowProvider = () => null;

export const notificationManager = {
  bindWindowProvider(provider: WindowProvider): void {
    getWindow = provider;
  },

  /** Called by the poller after a batch is classified. */
  async handleNewlyClassified(
    batch: EmailSummary[],
    prefs: UserPreferences,
  ): Promise<void> {
    const now = Date.now();
    const recentlyNotified = notificationsRepo.recentEmailIds(now - THIRTY_MIN);
    const recentlyNotifiedThreads = new Set(
      batch
        .filter((e) => recentlyNotified.has(e.id))
        .map((e) => e.threadId),
    );

    let decidedThisBatch = 0;
    for (const email of batch) {
      const decision = decideNotification({
        email,
        preferences: prefs,
        nowMs: now,
        recentlyNotifiedThreadIds: recentlyNotifiedThreads,
        alreadyDecidedThisBatch: decidedThisBatch,
      });

      if (!decision.shouldNotify) {
        if (email.priority !== 'LOW') {
          // Store a quiet, non-OS notification so the in-app bell can show it.
          const quiet = buildNotificationPayload(email, now);
          quiet.priority = email.priority;
          quiet.delivered = false;
          notificationsRepo.insert(quiet);
        }
        continue;
      }

      const payload = buildNotificationPayload(email, now);
      notificationsRepo.insert(payload);
      decidedThisBatch += 1;
      this.deliver(payload);
      sessionMemory.recordAlert(payload.id);
      recentlyNotifiedThreads.add(email.threadId);
    }
  },

  /** Send a notification to the OS + the renderer (if a window exists). */
  deliver(n: AppNotification): void {
    try {
      const native = new Notification({
        title: n.title,
        body: n.body,
        silent: false,
      });
      native.show();
    } catch {
      // Some OSes restrict notifications until first install registration.
    }
    notificationsRepo.markDelivered(n.id);

    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send(IpcChannels.evtNewNotification, { ...n, delivered: true });
    }
  },
};
