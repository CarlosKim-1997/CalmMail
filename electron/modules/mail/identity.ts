/**
 * Provider-agnostic message identity & threading.
 *
 * Different backends identify messages differently:
 *  - Gmail message ids are globally unique and stable.
 *  - IMAP `UID`s are folder-scoped and only valid for a given `UIDVALIDITY`,
 *    so the same message gets different UIDs across folders / re-syncs.
 *
 * To key mail consistently across providers, CalmMail computes:
 *  - a **canonical id**: a globally-stable message key used as the app's
 *    primary key. For providers with globally-unique ids (Gmail) this *is* the
 *    provider id, so existing rows never need rewriting. Otherwise it is
 *    derived from the RFC 5322 `Message-ID` header, falling back to a
 *    deterministic hash when the header is absent.
 *  - a **thread key**: a stable conversation key. For providers with native
 *    threads (Gmail) this is the provider thread id. Otherwise it is derived
 *    from `References` / `In-Reply-To` (JWZ-style root), falling back to the
 *    message's own id.
 *
 * These functions are pure and side-effect free so they can back any provider
 * and be reasoned about in isolation.
 */

import { createHash } from 'node:crypto';
import type { MailCapabilities, MailProviderId } from './types';

export interface MailIdentityInput {
  provider: MailProviderId;
  /** Stable per-account key (e.g. `gmail`, or `imap:user@host`). */
  accountId: string;
  capabilities: MailCapabilities;
  /** Provider-native message id (Gmail id, IMAP `UID` as string, ...). */
  providerMessageId: string;
  /** Provider-native thread/conversation id, when the provider has one. */
  providerThreadId?: string | null;
  /** Raw RFC 5322 `Message-ID` header value, if known (e.g. `<abc@host>`). */
  rfcMessageId?: string | null;
  /** Raw `References` header value (space/newline separated), if known. */
  references?: string | null;
  /** Raw `In-Reply-To` header value, if known. */
  inReplyTo?: string | null;
  /** Stable fallback material used only when no `Message-ID` is available. */
  fallback?: {
    from?: string | null;
    subject?: string | null;
    receivedAt?: number | null;
  };
}

export interface MailIdentity {
  provider: MailProviderId;
  accountId: string;
  /** Globally-stable key used as the app's canonical message id. */
  canonicalId: string;
  /** Provider-native id, retained for provider operations (fetch, flag, ...). */
  providerMessageId: string;
  /** Normalized RFC `Message-ID` (angle brackets stripped) or null. */
  rfcMessageId: string | null;
  /** Stable conversation key for grouping messages into threads. */
  threadKey: string;
}

/**
 * Normalize a single `Message-ID` token: strip surrounding angle brackets and
 * whitespace. Message-ID comparison is case-sensitive per RFC 5322, so casing
 * is preserved. Returns null when nothing usable remains.
 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse a `References` / `In-Reply-To` header into an ordered list of
 * normalized message ids. `References` is oldest-first, so index 0 is the
 * closest thing to a thread root.
 */
export function parseReferenceIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const matches = raw.match(/<[^>]+>/g);
  const tokens = matches ?? raw.split(/\s+/);
  const out: string[] = [];
  for (const token of tokens) {
    const norm = normalizeMessageId(token);
    if (norm) out.push(norm);
  }
  return out;
}

/** Deterministic fallback id when a message has no usable `Message-ID`. */
export function fallbackMessageHash(parts: Array<string | number | null | undefined>): string {
  const material = parts.map((p) => (p == null ? '' : String(p))).join('\u0000');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/**
 * Derive the canonical (globally-stable) message id.
 *
 * - Providers with globally-unique ids (Gmail): the provider id verbatim, so
 *   the value is unprefixed and existing primary keys are preserved.
 * - Otherwise: `Message-ID`-based, account-scoped to avoid cross-account
 *   collisions; hash fallback when no `Message-ID` exists.
 */
export function deriveCanonicalMessageId(input: MailIdentityInput): string {
  if (input.capabilities.globalMessageIds) {
    return input.providerMessageId;
  }
  const mid = normalizeMessageId(input.rfcMessageId);
  if (mid) return `${input.accountId}:mid:${mid}`;
  const hash = fallbackMessageHash([
    input.fallback?.from,
    input.fallback?.subject,
    input.fallback?.receivedAt,
    input.providerMessageId,
  ]);
  return `${input.accountId}:h:${hash}`;
}

/**
 * Derive a stable conversation key.
 *
 * - Providers with native threads (Gmail): the provider thread id verbatim, so
 *   it matches existing `thread_id` values.
 * - Otherwise: the JWZ-style root taken from `References` (oldest) →
 *   `In-Reply-To` → own `Message-ID`, account-scoped; falls back to the
 *   canonical id so a message always has a thread.
 */
export function deriveThreadKey(input: MailIdentityInput, canonicalId: string): string {
  if (input.capabilities.nativeThreads && input.providerThreadId) {
    return input.providerThreadId;
  }
  const refs = parseReferenceIds(input.references);
  const root =
    refs[0] ??
    normalizeMessageId(input.inReplyTo) ??
    normalizeMessageId(input.rfcMessageId);
  if (root) return `${input.accountId}:t:${root}`;
  return canonicalId;
}

/** Compute the full {@link MailIdentity} for a message. */
export function buildMailIdentity(input: MailIdentityInput): MailIdentity {
  const canonicalId = deriveCanonicalMessageId(input);
  return {
    provider: input.provider,
    accountId: input.accountId,
    canonicalId,
    providerMessageId: input.providerMessageId,
    rfcMessageId: normalizeMessageId(input.rfcMessageId),
    threadKey: deriveThreadKey(input, canonicalId),
  };
}
