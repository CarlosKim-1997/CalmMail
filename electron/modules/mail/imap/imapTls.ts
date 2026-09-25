/**
 * TLS options for IMAP (Proton Bridge and other local proxies).
 *
 * Proton Mail Bridge serves IMAP on 127.0.0.1 with a self-signed certificate.
 * Public IMAP hosts should keep default certificate verification.
 */

import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) return h.slice(1, -1);
  return h;
}

export function isLoopbackImapHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHost(host));
}

/**
 * Optional CA bundle from env (`CALMMAIL_IMAP_TLS_CA_FILE`), e.g. Bridge-exported
 * `cert.pem`. When unset and the host is loopback, allow the self-signed cert
 * (Bridge-only; traffic never leaves the machine).
 */
export function resolveImapTlsOptions(host: string): ConnectionOptions | undefined {
  const caPath = process.env.CALMMAIL_IMAP_TLS_CA_FILE?.trim();
  if (caPath) {
    try {
      const ca = readFileSync(caPath);
      return { ca: [ca], minVersion: 'TLSv1.2' };
    } catch (err) {
      console.warn(
        `[imap] CALMMAIL_IMAP_TLS_CA_FILE unreadable (${caPath}):`,
        (err as Error).message,
      );
    }
  }

  if (isLoopbackImapHost(host)) {
    return { rejectUnauthorized: false, minVersion: 'TLSv1.2' };
  }

  return undefined;
}
