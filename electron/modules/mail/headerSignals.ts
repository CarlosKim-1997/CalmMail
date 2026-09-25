/**
 * Provider-agnostic derivation of {@link HeaderSignals} from a header map.
 *
 * The sender classifier / rule engine uses these bulk/marketing/automation
 * signals regardless of backend. Gmail derives them from the metadata headers
 * it requests; IMAP derives them from `FETCH ... BODY.PEEK[HEADER.FIELDS (...)]`.
 * Centralizing the mapping keeps both providers consistent.
 */

import type { HeaderSignals } from '@main/modules/rules/senderClassifier';

/** Header names required to compute {@link HeaderSignals}. */
export const HEADER_SIGNAL_FIELDS = [
  'list-unsubscribe',
  'list-unsubscribe-post',
  'list-id',
  'precedence',
  'auto-submitted',
  'x-campaign',
  'x-campaign-id',
  'x-mailer',
  'feedback-id',
] as const;

/** Compute header signals from a lowercased-key header map. */
export function deriveHeaderSignals(headers: Map<string, string>): HeaderSignals {
  return {
    hasListUnsubscribe:
      headers.has('list-unsubscribe') ||
      headers.has('list-unsubscribe-post') ||
      headers.has('list-id'),
    precedenceBulk: /\b(bulk|list|junk)\b/i.test(headers.get('precedence') ?? ''),
    autoSubmitted: (() => {
      const v = headers.get('auto-submitted')?.toLowerCase();
      return !!v && v !== 'no';
    })(),
    hasCampaignId:
      headers.has('x-campaign') ||
      headers.has('x-campaign-id') ||
      headers.has('feedback-id'),
  };
}

/**
 * Parse a raw RFC 822 header block (as returned by IMAP `FETCH ... HEADER`)
 * into a Map keyed by lowercased header name. Folded (continuation) lines are
 * joined. When a header repeats, values are joined with a comma (sufficient for
 * the presence/pattern checks used here).
 */
export function parseHeaderBlock(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    const existing = map.get(key);
    map.set(key, existing ? `${existing}, ${value}` : value);
  }
  return map;
}
