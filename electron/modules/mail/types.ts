/**
 * Provider-agnostic mail types.
 *
 * The monitoring / rule / briefing layers must not know whether mail comes
 * from Gmail's REST API, an IMAP server, or anything else. They consume the
 * normalized {@link FetchedMessage} shape and branch on {@link MailCapabilities}
 * — never on a hard-coded provider id.
 *
 * This is the first seam of the IMAP-first roadmap: adding a backend means
 * implementing {@link MailProvider}, not touching the pipeline downstream.
 */

import type { FetchedMessage, OutgoingMessagePeek } from '@main/modules/gmail/client';

// Re-export the normalized transport shapes so downstream code can depend on
// the provider module rather than the Gmail module directly.
export type { FetchedMessage, OutgoingMessagePeek };

export type MailProviderId = 'gmail' | 'imap' | 'pop';

export type MailAuthMethod = 'oauth2' | 'password' | 'app_password';

/** How a provider learns about newly arrived mail. */
export type MailDeliveryModel = 'poll' | 'idle';

/** A minimal, provider-resolvable reference to a message. */
export interface MailMessageRef {
  /** Provider-native message id (Gmail id; IMAP `UID` as string; ...). */
  id: string;
  /**
   * Provider-native thread/conversation id. Providers without native threads
   * (IMAP) repeat the message id here until header-based threading lands.
   */
  threadId: string;
}

export interface MailListOptions {
  maxResults?: number;
  /**
   * Provider-native filter. For Gmail this is Gmail search syntax
   * (e.g. `in:inbox newer_than:7d`). Non-Gmail providers replace this with a
   * structured filter; treat the string as opaque and provider-specific.
   */
  query?: string;
}

export interface MailThreadUrlOptions {
  threadId: string;
  authUserEmail?: string | null;
}

/**
 * Declares what a mail platform can and cannot do. This is the single source
 * of truth behind the per-provider "supported / degraded / unsupported" UX,
 * and lets shared code branch on capabilities instead of provider identity.
 */
export interface MailCapabilities {
  /**
   * Provider returns native conversation/thread ids (Gmail). When false,
   * threading must be derived from `References` / `In-Reply-To` headers.
   */
  nativeThreads: boolean;
  /**
   * Provider supplies a ready-to-use preview snippet (Gmail). When false, the
   * snippet must be synthesized from a transiently fetched body part.
   */
  serverSnippet: boolean;
  /**
   * Provider exposes server-side category labels (Gmail `CATEGORY_*`). When
   * false, categories come from headers + the local classifier only.
   */
  serverCategories: boolean;
  /** How the provider learns about new mail. */
  delivery: MailDeliveryModel;
  /** Provider can change server-side read state (may require extra consent). */
  canMarkRead: boolean;
  /** Provider can open a message/thread in a web UI. */
  canOpenInWeb: boolean;
  /** Authentication methods this provider supports. */
  auth: readonly MailAuthMethod[];
  /** Whether a working implementation ships today. */
  implemented: boolean;
}

/**
 * Provider-agnostic mail *data plane*. Everything the monitoring, rule, and
 * briefing layers need in order to read mail flows through this interface.
 *
 * Account lifecycle (interactive OAuth / login) is intentionally out of scope
 * here; it is generalized separately when multi-account auth lands. This
 * interface is deliberately limited to reads + read-state + linking status.
 */
export interface MailProvider {
  readonly id: MailProviderId;
  readonly capabilities: MailCapabilities;

  /** True when an account is linked and usable for reads right now. */
  isConnected(): boolean;
  /** Primary address of the linked account, if known. */
  getConnectedEmail(): string | null;

  /** Recent inbox message references (ids only; no bodies fetched). */
  listInboxMessageRefs(opts?: MailListOptions): Promise<MailMessageRef[]>;
  /** Recent sent message references, for awaited-reply inference. */
  listSentMessageRefs(opts?: { maxResults?: number }): Promise<MailMessageRef[]>;

  /**
   * Fetch normalized metadata (+ header signals) for the given ids without
   * persisting body bytes. The returned {@link FetchedMessage} is what the
   * rule engine consumes.
   */
  fetchMessagesMetadata(ids: string[]): Promise<FetchedMessage[]>;
  fetchMessageMetadata(id: string): Promise<FetchedMessage | null>;

  /** Transient peek at an outgoing message for awaited-reply heuristics. */
  peekOutgoingMessage(
    id: string,
    userEmail: string | null,
  ): Promise<OutgoingMessagePeek | null>;

  /**
   * Mark messages read server-side. Providers where `capabilities.canMarkRead`
   * is false — or that require extra consent — may throw.
   */
  markMessagesAsRead(ids: string[]): Promise<number>;

  /** Build a web deep link to a thread. Only meaningful when `canOpenInWeb`. */
  buildThreadUrl(opts: MailThreadUrlOptions): string;
}
