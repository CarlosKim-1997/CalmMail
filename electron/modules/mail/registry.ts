/**
 * Mail provider registry.
 *
 * Resolves the mail provider the rest of the app should read through. Today
 * CalmMail links a single Gmail account, so {@link getActiveMailProvider}
 * always returns the Gmail provider. When multi-account / IMAP lands, this is
 * where the user's currently-selected account is resolved.
 */

import { gmailProvider } from './gmailProvider';
import { imapProvider } from './imapProvider';
import type { MailProvider, MailProviderId } from './types';

const PROVIDERS: Partial<Record<MailProviderId, MailProvider>> = {
  gmail: gmailProvider,
  imap: imapProvider,
};

/** The mail provider all read paths should currently go through. */
export function getActiveMailProvider(): MailProvider {
  return gmailProvider;
}

/** Look up a specific provider implementation, if one exists. */
export function getMailProvider(id: MailProviderId): MailProvider | null {
  return PROVIDERS[id] ?? null;
}
