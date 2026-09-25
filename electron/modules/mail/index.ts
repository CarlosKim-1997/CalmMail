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
export { getActiveMailProvider, getMailProvider } from './registry';
