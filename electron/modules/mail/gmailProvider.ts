/**
 * Gmail implementation of {@link MailProvider}.
 *
 * This is a *thin* adapter: it delegates to the existing `gmail/*` modules
 * without changing their behavior, so wrapping Gmail in the provider
 * abstraction is behavior-preserving. All Gmail-specific logic (OAuth, search
 * syntax, label handling) still lives in `gmail/*`.
 */

import { getStoredTokens } from '@main/modules/gmail/auth';
import {
  fetchMessageMetadata,
  fetchMessagesMetadata,
  getConnectedEmail,
  listRecentMessageIds,
  listRecentSentMessageIds,
  markMessagesAsRead,
  peekOutgoingMessage,
} from '@main/modules/gmail/client';
import { buildGmailThreadUrl } from '@main/modules/gmail/links';
import { MAIL_CAPABILITIES } from './capabilities';
import type {
  MailListOptions,
  MailMessageRef,
  MailProvider,
  MailThreadUrlOptions,
} from './types';

export const gmailProvider: MailProvider = {
  id: 'gmail',
  capabilities: MAIL_CAPABILITIES.gmail,

  isConnected(): boolean {
    return getStoredTokens() != null;
  },

  getConnectedEmail(): string | null {
    return getConnectedEmail();
  },

  listInboxMessageRefs(opts: MailListOptions = {}): Promise<MailMessageRef[]> {
    return listRecentMessageIds({ maxResults: opts.maxResults, query: opts.query });
  },

  listSentMessageRefs(opts: { maxResults?: number } = {}): Promise<MailMessageRef[]> {
    return listRecentSentMessageIds({ maxResults: opts.maxResults });
  },

  fetchMessagesMetadata(ids: string[]) {
    return fetchMessagesMetadata(ids);
  },

  fetchMessageMetadata(id: string) {
    return fetchMessageMetadata(id);
  },

  peekOutgoingMessage(id: string, userEmail: string | null) {
    return peekOutgoingMessage(id, userEmail);
  },

  markMessagesAsRead(ids: string[]): Promise<number> {
    return markMessagesAsRead(ids);
  },

  buildThreadUrl(opts: MailThreadUrlOptions): string {
    return buildGmailThreadUrl(opts);
  },
};
