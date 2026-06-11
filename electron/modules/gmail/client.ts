/**
 * Gmail API client wrapper.
 *
 * We intentionally expose only the slim surface the rest of the app actually
 * needs: list recent messages, fetch one, fetch a thread. No send, no modify.
 *
 * Returned values are *projections* (small, JSON-safe), not raw API responses.
 */

import { google, gmail_v1 } from 'googleapis';
import { getOAuthClient, getStoredTokens, hasGmailModifyScope } from './auth';
import type { EmailAddress, EmailSummary } from '@shared/types';
import { deriveCategory } from '@main/modules/rules/categorize';
import type { HeaderSignals } from '@main/modules/rules/senderClassifier';

/**
 * Subset of message headers we *additionally* request so the sender
 * classifier can detect bulk / marketing / automated messages. Kept tiny on
 * purpose — every extra header costs metadata bytes per message.
 */
const HEADER_NAMES_FULL = [
  'From',
  'To',
  'Subject',
  'Date',
  'List-Unsubscribe',
  'List-Unsubscribe-Post',
  'List-Id',
  'Precedence',
  'Auto-Submitted',
  'X-Campaign',
  'X-Campaign-Id',
  'X-Mailer',
  'Feedback-ID',
];

interface RawMessage {
  id: string;
  threadId: string;
  payload?: gmail_v1.Schema$MessagePart;
  labelIds?: string[];
  snippet?: string | null;
  internalDate?: string | null;
}

export class GmailNotConnectedError extends Error {
  constructor() {
    super('Gmail is not connected.');
    this.name = 'GmailNotConnectedError';
  }
}

export class GmailModifyScopeMissingError extends Error {
  constructor() {
    super('Gmail modify scope not granted.');
    this.name = 'GmailModifyScopeMissingError';
  }
}

/** Refresh token revoked or expired — user must reconnect Gmail. */
export class GmailAuthExpiredError extends Error {
  constructor(message = 'invalid_grant') {
    super(message);
    this.name = 'GmailAuthExpiredError';
  }
}

export function isGmailAuthExpiredError(err: unknown): boolean {
  if (err instanceof GmailAuthExpiredError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('invalid_grant');
}

function requireClient(): gmail_v1.Gmail {
  const auth = getOAuthClient();
  if (!auth) throw new GmailNotConnectedError();
  return google.gmail({ version: 'v1', auth });
}

export function getConnectedEmail(): string | null {
  return getStoredTokens()?.user_email ?? null;
}

/** Returns the IDs of recent inbox messages (no full fetch). */
export async function listRecentMessageIds(opts: {
  maxResults?: number;
  query?: string;
} = {}): Promise<Array<{ id: string; threadId: string }>> {
  return listMessageIdsByQuery({
    maxResults: opts.maxResults ?? 25,
    query: opts.query ?? 'in:inbox newer_than:7d',
  });
}

/** Recent sent-mail ids (metadata fetch only — no body storage). */
export async function listRecentSentMessageIds(opts: {
  maxResults?: number;
} = {}): Promise<Array<{ id: string; threadId: string }>> {
  return listMessageIdsByQuery({
    maxResults: opts.maxResults ?? 20,
    query: 'in:sent newer_than:14d',
  });
}

async function listMessageIdsByQuery(opts: {
  maxResults: number;
  query: string;
}): Promise<Array<{ id: string; threadId: string }>> {
  const gmail = requireClient();
  const resp = await gmail.users.messages.list({
    userId: 'me',
    maxResults: opts.maxResults,
    q: opts.query,
  });
  const items = resp.data.messages ?? [];
  return items
    .filter((m): m is gmail_v1.Schema$Message & { id: string; threadId: string } =>
      !!m.id && !!m.threadId,
    )
    .map((m) => ({ id: m.id, threadId: m.threadId }));
}

export interface FetchedMessage {
  summary: EmailSummary;
  headerSignals: HeaderSignals;
}

/** Fetch a single message in `metadata` form — no body bytes downloaded. */
export async function fetchMessageMetadata(id: string): Promise<FetchedMessage | null> {
  const gmail = requireClient();
  const resp = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'metadata',
    metadataHeaders: HEADER_NAMES_FULL,
  });
  if (!resp.data || !resp.data.id) return null;
  return rawToFetched(resp.data as RawMessage);
}

/**
 * Fetch a list of message ids in one batched call (still N requests, but
 * parallelized). Use sparingly.
 */
const METADATA_FETCH_BATCH = 8;

export async function fetchMessagesMetadata(ids: string[]): Promise<FetchedMessage[]> {
  const out: FetchedMessage[] = [];
  for (let i = 0; i < ids.length; i += METADATA_FETCH_BATCH) {
    const batch = ids.slice(i, i + METADATA_FETCH_BATCH);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const msg = await fetchMessageMetadata(id);
          if (msg) out.push(msg);
        } catch (err) {
          if (isGmailAuthExpiredError(err)) {
            throw new GmailAuthExpiredError((err as Error).message);
          }
          console.warn(`[gmail] metadata fetch failed for ${id}:`, (err as Error).message);
        }
      }),
    );
  }
  return out.sort((a, b) => b.summary.receivedAt - a.summary.receivedAt);
}

/**
 * Convert a raw Gmail message metadata payload into our slim EmailSummary
 * plus the header signals the sender classifier needs.
 *
 * Importance scoring is done elsewhere (rule engine); we ship a
 * placeholder category here and let the engine refine it once it can pair
 * the message with a stored sender profile.
 */
function rawToFetched(raw: RawMessage): FetchedMessage {
  const headers = raw.payload?.headers ?? [];
  const headerMap = new Map<string, string>(
    headers
      .filter((h): h is gmail_v1.Schema$MessagePartHeader & { name: string; value: string } =>
        !!h.name && !!h.value,
      )
      .map((h) => [h.name.toLowerCase(), h.value]),
  );

  const fromHeader = headerMap.get('from') ?? '';
  const toHeader = headerMap.get('to') ?? '';
  const subject = headerMap.get('subject') ?? '(no subject)';

  const receivedAt = raw.internalDate
    ? parseInt(raw.internalDate, 10)
    : Date.now();

  const base = {
    id: raw.id,
    threadId: raw.threadId,
    from: parseAddress(fromHeader),
    to: parseAddressList(toHeader),
    subject: clamp(subject, 240),
    snippet: clamp((raw.snippet ?? '').trim(), 280),
    receivedAt,
    isUnread: (raw.labelIds ?? []).includes('UNREAD'),
    labels: raw.labelIds ?? [],
  };

  const headerSignals: HeaderSignals = {
    hasListUnsubscribe:
      headerMap.has('list-unsubscribe') ||
      headerMap.has('list-unsubscribe-post') ||
      headerMap.has('list-id'),
    precedenceBulk: /\b(bulk|list|junk)\b/i.test(headerMap.get('precedence') ?? ''),
    autoSubmitted: (() => {
      const v = headerMap.get('auto-submitted')?.toLowerCase();
      return !!v && v !== 'no';
    })(),
    hasCampaignId:
      headerMap.has('x-campaign') ||
      headerMap.has('x-campaign-id') ||
      headerMap.has('feedback-id'),
  };

  const summary: EmailSummary = {
    ...base,
    importanceScore: 0,
    priority: 'LOW' as const,
    reasons: [],
    category: deriveCategory(base),
    openCount: 0,
    triageDismissed: false,
  };

  return { summary, headerSignals };
}

function parseAddress(raw: string): EmailAddress {
  const m = raw.match(/^\s*(?:"?([^"]*)"?\s)?<([^>]+)>\s*$/);
  if (m) return { name: m[1]?.trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: raw.trim().toLowerCase() };
}

function parseAddressList(raw: string): EmailAddress[] {
  if (!raw) return [];
  return raw
    .split(/,(?![^<]*>)/)
    .map((part) => parseAddress(part))
    .filter((a) => a.email.length > 0);
}

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export interface OutgoingMessagePeek {
  id: string;
  threadId: string;
  toEmail: string;
  subject: string;
  sentAt: number;
  snippet: string;
  isSentByUser: boolean;
}

/**
 * Read headers + snippet for a message the user may have sent. Used only
 * in-memory for awaited-reply heuristics — never persisted as body text.
 */
export async function peekOutgoingMessage(
  id: string,
  userEmail: string | null,
): Promise<OutgoingMessagePeek | null> {
  const gmail = requireClient();
  const resp = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'metadata',
    metadataHeaders: ['From', 'To', 'Subject', 'Date'],
  });
  if (!resp.data?.id || !resp.data.threadId) return null;

  const raw = resp.data as RawMessage;
  const labels = raw.labelIds ?? [];
  if (!labels.includes('SENT')) return null;

  const headers = raw.payload?.headers ?? [];
  const headerMap = new Map<string, string>(
    headers
      .filter((h): h is gmail_v1.Schema$MessagePartHeader & { name: string; value: string } =>
        !!h.name && !!h.value,
      )
      .map((h) => [h.name.toLowerCase(), h.value]),
  );

  const from = parseAddress(headerMap.get('from') ?? '');
  const userNorm = userEmail?.toLowerCase() ?? null;
  const isSentByUser = userNorm ? from.email === userNorm : labels.includes('SENT');

  const toList = parseAddressList(headerMap.get('to') ?? '');
  const toEmail =
    toList.find((a) => a.email !== userNorm)?.email ?? toList[0]?.email ?? '';
  if (!toEmail) return null;

  const sentAt = raw.internalDate ? parseInt(raw.internalDate, 10) : Date.now();

  return {
    id: raw.id,
    threadId: raw.threadId,
    toEmail,
    subject: clamp(headerMap.get('subject') ?? '(no subject)', 240),
    sentAt,
    snippet: clamp((raw.snippet ?? '').trim(), 280),
    isSentByUser,
  };
}

const GMAIL_BATCH_MODIFY_CAP = 500;

/** Remove UNREAD in Gmail. Requires opt-in `gmail.modify` scope. */
export async function markMessagesAsRead(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  if (!hasGmailModifyScope()) throw new GmailModifyScopeMissingError();

  const gmail = requireClient();
  let marked = 0;
  for (let i = 0; i < ids.length; i += GMAIL_BATCH_MODIFY_CAP) {
    const chunk = ids.slice(i, i + GMAIL_BATCH_MODIFY_CAP);
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: chunk,
        removeLabelIds: ['UNREAD'],
      },
    });
    marked += chunk.length;
  }
  return marked;
}
