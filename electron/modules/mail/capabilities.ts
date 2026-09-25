/**
 * Mail platform capability matrix.
 *
 * Single source of truth for "what does each mail platform support", per the
 * IMAP-first roadmap. Rows for providers that are not implemented yet document
 * the intended support level and let the UI show "supported / coming soon"
 * without special-casing provider ids in view code.
 */

import type { MailCapabilities, MailProviderId } from './types';

export const MAIL_CAPABILITIES: Record<MailProviderId, MailCapabilities> = {
  gmail: {
    nativeThreads: true,
    serverSnippet: true,
    serverCategories: true,
    delivery: 'poll',
    // Read-state changes require the opt-in `gmail.modify` scope; the provider
    // still exposes the capability and throws if the scope is missing.
    canMarkRead: true,
    canOpenInWeb: true,
    auth: ['oauth2'],
    implemented: true,
  },
  imap: {
    // No native conversation ids — threading is derived from message headers.
    nativeThreads: false,
    // No server snippet — must be synthesized from a transiently fetched body.
    serverSnippet: false,
    // No server categories — headers + local classifier only.
    serverCategories: false,
    delivery: 'idle',
    canMarkRead: true,
    canOpenInWeb: false,
    auth: ['oauth2', 'app_password', 'password'],
    implemented: false,
  },
  pop: {
    nativeThreads: false,
    serverSnippet: false,
    serverCategories: false,
    delivery: 'poll',
    canMarkRead: false,
    canOpenInWeb: false,
    auth: ['password', 'app_password'],
    implemented: false,
  },
};

export function getMailCapabilities(id: MailProviderId): MailCapabilities {
  return MAIL_CAPABILITIES[id];
}
