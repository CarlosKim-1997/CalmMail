/**
 * IMAP implementation of {@link MailProvider}.
 *
 * Thin adapter: loads the stored IMAP account and delegates the actual IMAP
 * work to the pure {@link imapClient} engine. Follows the same shape as
 * {@link gmailProvider} so the rest of the app stays provider-agnostic.
 *
 * MVP limitations (tracked for later steps):
 *  - INBOX only; `listSentMessageRefs` / `peekOutgoingMessage` are no-ops, so
 *    awaited-reply inference is not yet available for IMAP accounts.
 *  - Polling only (no IDLE yet).
 *  - No web deep link (`canOpenInWeb` is false).
 */

import { MAIL_CAPABILITIES } from './capabilities';
import type { MailListOptions, MailProvider, MailThreadUrlOptions } from './types';
import { imapAccountStore } from './imap/imapAccountStore';
import {
  fetchMessagesByUid,
  listInboxUids,
  markMessagesSeen,
} from './imap/imapClient';

export const imapProvider: MailProvider = {
  id: 'imap',
  capabilities: MAIL_CAPABILITIES.imap,

  isConnected(): boolean {
    return imapAccountStore.has();
  },

  getConnectedEmail(): string | null {
    return imapAccountStore.get()?.user ?? null;
  },

  accountKey(): string {
    return imapAccountStore.get()?.accountId ?? 'imap';
  },

  async listInboxMessageRefs(opts: MailListOptions = {}) {
    const account = imapAccountStore.get();
    if (!account) return [];
    return listInboxUids(account, { maxMessages: opts.maxResults });
  },

  async listSentMessageRefs() {
    // MVP: sent-folder scanning not implemented yet.
    return [];
  },

  async fetchMessagesMetadata(ids: string[]) {
    const account = imapAccountStore.get();
    if (!account) return [];
    return fetchMessagesByUid(account, ids);
  },

  async fetchMessageMetadata(id: string) {
    const account = imapAccountStore.get();
    if (!account) return null;
    const [msg] = await fetchMessagesByUid(account, [id]);
    return msg ?? null;
  },

  async peekOutgoingMessage() {
    // MVP: awaited-reply inference from Sent is not implemented for IMAP yet.
    return null;
  },

  async markMessagesAsRead(ids: string[]) {
    const account = imapAccountStore.get();
    if (!account) return 0;
    return markMessagesSeen(account, ids);
  },

  buildThreadUrl(_opts: MailThreadUrlOptions): string {
    // capabilities.canOpenInWeb === false — no generic IMAP web UI.
    return '';
  },
};
