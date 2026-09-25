/**
 * Minimal IMAP server autoconfiguration.
 *
 * Users rarely know their IMAP host/port. This maps well-known provider domains
 * to their IMAP endpoints and falls back to the conventional `imap.<domain>`
 * on the implicit-TLS port. It is intentionally a small, offline table (no
 * network probing) — a richer Thunderbird-ISPDB-style lookup can layer on later.
 */

export interface ImapServerConfig {
  host: string;
  port: number;
  /** Implicit TLS (port 993). When false, callers should use STARTTLS on 143. */
  secure: boolean;
}

const IMAPS = (host: string): ImapServerConfig => ({ host, port: 993, secure: true });

const TABLE: Record<string, ImapServerConfig> = {
  'gmail.com': IMAPS('imap.gmail.com'),
  'googlemail.com': IMAPS('imap.gmail.com'),
  'outlook.com': IMAPS('outlook.office365.com'),
  'hotmail.com': IMAPS('outlook.office365.com'),
  'live.com': IMAPS('outlook.office365.com'),
  'office365.com': IMAPS('outlook.office365.com'),
  'yahoo.com': IMAPS('imap.mail.yahoo.com'),
  'icloud.com': IMAPS('imap.mail.me.com'),
  'me.com': IMAPS('imap.mail.me.com'),
  'fastmail.com': IMAPS('imap.fastmail.com'),
  'naver.com': IMAPS('imap.naver.com'),
  'daum.net': IMAPS('imap.daum.net'),
  'hanmail.net': IMAPS('imap.daum.net'),
  'kakao.com': IMAPS('imap.kakao.com'),
  'nate.com': IMAPS('imap.mail.nate.com'),
};

/** Extract the lowercased domain from an email address. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}

/**
 * Resolve IMAP server settings for an email address. Returns a known-provider
 * entry when available, otherwise a conventional `imap.<domain>:993` guess.
 * Returns null only when the address has no parseable domain.
 */
export function resolveImapServer(email: string): ImapServerConfig | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  return TABLE[domain] ?? { host: `imap.${domain}`, port: 993, secure: true };
}

/** True when the domain has an explicit (non-guessed) entry in the table. */
export function hasKnownImapServer(email: string): boolean {
  const domain = emailDomain(email);
  return domain != null && domain in TABLE;
}
