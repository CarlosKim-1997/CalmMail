/**
 * IMAP real-time inbox watcher.
 *
 * When the active provider is IMAP, keeps a persistent IDLE connection open and
 * ingests new mail the moment it arrives (with a periodic safety re-sync inside
 * the watcher). New messages flow through the same {@link ingestFetchedMessages}
 * pipeline as the poller, and a poll-report is emitted so the renderer refreshes
 * exactly as it does after a background poll.
 */

import type { PollReport } from './poller';
import { ingestFetchedMessages } from './ingest';
import {
  getActiveMailProvider,
  getActiveProviderId,
  imapAccountStore,
  watchInbox,
  type FetchedMessage,
  type ImapWatchHandle,
} from '@main/modules/mail';

type TickHandler = (report: PollReport) => void;

let handle: ImapWatchHandle | null = null;
let starting = false;
let tickHandler: TickHandler | null = null;

async function onNewMessages(messages: FetchedMessage[]): Promise<void> {
  const provider = getActiveMailProvider();
  if (provider.id !== 'imap' || messages.length === 0) return;
  try {
    const res = await ingestFetchedMessages(messages, provider);
    tickHandler?.({
      ran: true,
      fetched: res.classified.length,
      classified: res.classified.length,
      newHighPriority: res.newHighPriority,
      newMediumPriority: res.newMediumPriority,
    });
  } catch (err) {
    console.warn('[imap-idle] ingest failed', err);
  }
}

export const imapRealtime = {
  /** Register a listener that receives a poll-report on each real-time batch. */
  onTick(handler: TickHandler): void {
    tickHandler = handler;
  },

  /** Start watching if an IMAP account is the active provider. Idempotent. */
  async start(): Promise<void> {
    if (handle || starting) return;
    if (getActiveProviderId() !== 'imap') return;
    const account = imapAccountStore.get();
    if (!account) return;
    starting = true;
    try {
      handle = await watchInbox(account, (msgs) => void onNewMessages(msgs), {
        resyncMs: 60_000,
        onError: (e) => console.warn('[imap-idle]', e.message),
      });
      console.log('[imap-idle] watching INBOX for', account.user);
    } catch (err) {
      console.warn('[imap-idle] failed to start watcher', err);
      handle = null;
    } finally {
      starting = false;
    }
  },

  async stop(): Promise<void> {
    const h = handle;
    handle = null;
    if (h) {
      try {
        await h.close();
      } catch {
        /* ignore */
      }
    }
  },

  /** Restart to reflect a provider/account change (connect/disconnect). */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  },

  isRunning(): boolean {
    return handle != null;
  },
};
