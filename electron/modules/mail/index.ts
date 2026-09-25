/**
 * Provider-agnostic mail layer.
 *
 * Import mail reads and capabilities from here rather than from `gmail/*`
 * directly, so downstream code stays decoupled from any single backend.
 */

export * from './types';
export { MAIL_CAPABILITIES, getMailCapabilities } from './capabilities';
export {
  type MailIdentity,
  type MailIdentityInput,
  buildMailIdentity,
  deriveCanonicalMessageId,
  deriveThreadKey,
  normalizeMessageId,
  parseReferenceIds,
  fallbackMessageHash,
} from './identity';
export { gmailProvider } from './gmailProvider';
export { imapProvider } from './imapProvider';
export {
  type ImapServerConfig,
  resolveImapServer,
  hasKnownImapServer,
  emailDomain,
} from './imap/autoconfig';
export {
  type ImapAccount,
  type ImapListOptions,
  type ImapWatchHandle,
  type ImapWatchOptions,
  listInboxUids,
  fetchMessagesByUid,
  markMessagesSeen,
  watchInbox,
} from './imap/imapClient';
export { imapAccountStore } from './imap/imapAccountStore';
export { getActiveProviderId, setActiveProviderId } from './activeAccount';
export { getActiveMailProvider, getMailProvider } from './registry';
