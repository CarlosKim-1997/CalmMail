/**
 * IMAP fetch engine (imapflow).
 *
 * Pure Node — no Electron or persistence imports — so it can back the
 * {@link ImapProvider} and be exercised directly against a real IMAP server.
 *
 * Trust-boundary notes:
 *  - Reads use imapflow's default `BODY.PEEK`, so scanning never sets `\Seen`.
 *  - Bodies are never stored: only a short snippet is synthesized from the
 *    first few KB of the text part and then discarded.
 *  - Identity is normalized via {@link buildMailIdentity}: the canonical id is
 *    derived from the RFC `Message-ID` (never the folder-scoped UID) and the
 *    thread key from `References` / `In-Reply-To`.
 */

import type { Readable } from 'node:stream';
import {
  ImapFlow,
  type FetchMessageObject,
  type MessageAddressObject,
  type MessageStructureObject,
} from 'imapflow';
import type { EmailAddress, EmailSummary } from '@shared/types';
import type { FetchedMessage, MailMessageRef } from '../types';
import { MAIL_CAPABILITIES } from '../capabilities';
import { buildMailIdentity } from '../identity';
import {
  HEADER_SIGNAL_FIELDS,
  deriveHeaderSignals,
  parseHeaderBlock,
} from '../headerSignals';

export interface ImapAccount {
  /** Stable account key, e.g. `imap:user@host`. */
  accountId: string;
  host: string;
  port: number;
  /** Implicit TLS (993). imapflow uses STARTTLS when false and available. */
  secure: boolean;
  user: string;
  pass: string;
}

export interface ImapListOptions {
  sinceDays?: number;
  maxMessages?: number;
}

const SNIPPET_MAX = 280;
const SUBJECT_MAX = 240;
const SNIPPET_FETCH_BYTES = 4096;
const HEADER_FETCH_FIELDS = ['references', ...HEADER_SIGNAL_FIELDS];

function makeClient(account: ImapAccount): ImapFlow {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  });
}

function toAddress(a: MessageAddressObject | undefined): EmailAddress {
  return {
    name: a?.name?.trim() || null,
    email: (a?.address ?? '').trim().toLowerCase(),
  };
}

function toAddressList(list: MessageAddressObject[] | undefined): EmailAddress[] {
  return (list ?? [])
    .map(toAddress)
    .filter((a) => a.email.length > 0);
}

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

/** Walk the body structure and pick a text part, preferring text/plain. */
function pickTextPart(
  node: MessageStructureObject | undefined,
): { part: string; html: boolean } | null {
  if (!node) return null;
  if (node.childNodes && node.childNodes.length > 0) {
    let htmlFallback: { part: string; html: boolean } | null = null;
    for (const child of node.childNodes) {
      const found = pickTextPart(child);
      if (found && !found.html) return found;
      if (found && found.html && !htmlFallback) htmlFallback = found;
    }
    return htmlFallback;
  }
  const type = (node.type ?? '').toLowerCase();
  const part = node.part ?? '1';
  if (type === 'text/plain') return { part, html: false };
  if (type === 'text/html') return { part, html: true };
  return null;
}

async function readStream(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    chunks.push(buf);
    total += buf.length;
    if (total >= maxBytes) break;
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

/**
 * Synthesize a short preview from the message's text part. Best-effort UTF-8
 * decoding; legacy charsets (e.g. EUC-KR) are a known follow-up.
 */
async function readSnippet(
  client: ImapFlow,
  uid: number,
  structure: MessageStructureObject | undefined,
): Promise<string> {
  const pick = pickTextPart(structure);
  if (!pick) return '';
  try {
    const { meta, content } = await client.download(String(uid), pick.part, {
      uid: true,
      maxBytes: SNIPPET_FETCH_BYTES,
    });
    const raw = (await readStream(content, SNIPPET_FETCH_BYTES)).toString('utf8');
    const text = pick.html || (meta.contentType ?? '').includes('html') ? stripHtml(raw) : raw;
    return clamp(collapseWhitespace(text), SNIPPET_MAX);
  } catch {
    return '';
  }
}

function toFetchedMessage(
  account: ImapAccount,
  msg: FetchMessageObject,
  snippet: string,
): FetchedMessage {
  const env = msg.envelope ?? {};
  const headerMap = msg.headers
    ? parseHeaderBlock(msg.headers.toString('utf8'))
    : new Map<string, string>();
  const from = toAddress(env.from?.[0]);
  const to = toAddressList(env.to);
  const subject = clamp(env.subject ?? '(no subject)', SUBJECT_MAX);
  const receivedAt = env.date
    ? env.date.getTime()
    : msg.internalDate
      ? new Date(msg.internalDate).getTime()
      : Date.now();

  const identity = buildMailIdentity({
    provider: 'imap',
    accountId: account.accountId,
    capabilities: MAIL_CAPABILITIES.imap,
    providerMessageId: String(msg.uid),
    rfcMessageId: env.messageId ?? null,
    references: headerMap.get('references') ?? null,
    inReplyTo: env.inReplyTo ?? null,
    fallback: { from: from.email, subject, receivedAt },
  });

  const summary: EmailSummary = {
    id: identity.canonicalId,
    threadId: identity.threadKey,
    from,
    to,
    subject,
    snippet,
    receivedAt,
    // BODY.PEEK is used for reads, so scanning does not mark the message read.
    isUnread: !(msg.flags?.has('\\Seen') ?? false),
    labels: [],
    importanceScore: 0,
    priority: 'LOW',
    reasons: [],
    // Placeholder; the rule engine re-derives category at ingest.
    category: 'personal',
    openCount: 0,
    triageDismissed: false,
  };

  return { summary, headerSignals: deriveHeaderSignals(headerMap) };
}

/** List recent INBOX message references (UIDs), newest last. */
export async function listInboxUids(
  account: ImapAccount,
  opts: ImapListOptions = {},
): Promise<MailMessageRef[]> {
  const client = makeClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const sinceDays = opts.sinceDays ?? 30;
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const found = await client.search({ since }, { uid: true });
      const uids = found || [];
      const limited =
        opts.maxMessages && uids.length > opts.maxMessages
          ? uids.slice(-opts.maxMessages)
          : uids;
      return limited.map((uid) => ({ id: String(uid), threadId: String(uid) }));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/** Fetch normalized metadata (+ header signals + snippet) for the given UIDs. */
export async function fetchMessagesByUid(
  account: ImapAccount,
  uids: string[],
): Promise<FetchedMessage[]> {
  if (uids.length === 0) return [];
  const client = makeClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const msgs = await client.fetchAll(
        uids.join(','),
        {
          uid: true,
          flags: true,
          envelope: true,
          bodyStructure: true,
          headers: HEADER_FETCH_FIELDS,
        },
        { uid: true },
      );
      const out: FetchedMessage[] = [];
      for (const msg of msgs) {
        const snippet = await readSnippet(client, msg.uid, msg.bodyStructure);
        out.push(toFetchedMessage(account, msg, snippet));
      }
      return out.sort((a, b) => b.summary.receivedAt - a.summary.receivedAt);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/** Mark messages read server-side (STORE +FLAGS \Seen). */
export async function markMessagesSeen(
  account: ImapAccount,
  uids: string[],
): Promise<number> {
  if (uids.length === 0) return 0;
  const client = makeClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const ok = await client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true });
      return ok ? uids.length : 0;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
