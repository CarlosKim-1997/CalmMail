/**
 * IMAP implementation of {@link MailProvider}.
 *
 * Thin adapter: loads the stored IMAP account and delegates the actual IMAP
 * work to the pure {@link imapClient} engine. Follows the same shape as
 * {@link gmailProvider} so the rest of the app stays provider-agnostic.
 *
 * MVP limitations (tracked for later steps):
 *  - INBOX + Sent (SPECIAL-USE / common path fallbacks) only.
 *  - No web deep link (`canOpenInWeb` is false).
 */

import { MAIL_CAPABILITIES } from './capabilities';
import type { MailListOptions, MailProvider, MailThreadUrlOptions } from './types';
import { imapAccountStore } from './imap/imapAccountStore';
import {
  fetchMessagesByUid,
  listInboxUids,
  listSentUids,
  markMessagesSeen,
  peekImapOutgoingMessage,
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

  async listSentMessageRefs(opts: { maxResults?: number } = {}) {
    const account = imapAccountStore.get();
    if (!account) return [];
    return listSentUids(account, { maxMessages: opts.maxResults, sinceDays: 14 });
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

  async peekOutgoingMessage(id: string, userEmail: string | null) {
    const account = imapAccountStore.get();
    if (!account) return null;
    return peekImapOutgoingMessage(account, id, userEmail);
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
