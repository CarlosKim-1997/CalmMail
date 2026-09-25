/**
 * Which mail provider is currently active.
 *
 * Persisted in the `meta` table so it survives restarts. Gmail is the default.
 * When the user connects an IMAP account we flip this to `imap`; disconnecting
 * flips it back. {@link getActiveMailProvider} consults this.
 */

import { getDb } from '@main/modules/persistence/db';
import type { MailProviderId } from './types';

const META_KEY = 'mail.activeProvider';
const DEFAULT_PROVIDER: MailProviderId = 'gmail';

function isProviderId(v: string): v is MailProviderId {
  return v === 'gmail' || v === 'imap' || v === 'pop';
}

export function getActiveProviderId(): MailProviderId {
  try {
    const row = getDb()
      .prepare<[string], { value: string } | undefined>('SELECT value FROM meta WHERE key = ?')
      .get(META_KEY);
    if (row && isProviderId(row.value)) return row.value;
  } catch {
    /* meta unavailable — fall back to default */
  }
  return DEFAULT_PROVIDER;
}

export function setActiveProviderId(id: MailProviderId): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(META_KEY, id);
}
