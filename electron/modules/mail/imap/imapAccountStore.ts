/**
 * Encrypted storage for the IMAP account (config + credentials).
 *
 * Reuses {@link secureStore}, which encrypts via the OS keychain and refuses to
 * persist secrets when OS-level encryption is unavailable (trust-first). MVP
 * stores a single IMAP account; multi-account support layers on later.
 */

import { SecureKeys, secureStore } from '@main/modules/persistence/secureStore';
import type { ImapAccount } from './imapClient';

export const imapAccountStore = {
  get(): ImapAccount | null {
    try {
      const raw = secureStore.get(SecureKeys.imapAccount);
      return raw ? (JSON.parse(raw) as ImapAccount) : null;
    } catch {
      return null;
    }
  },

  set(account: ImapAccount): void {
    secureStore.set(SecureKeys.imapAccount, JSON.stringify(account));
  },

  clear(): void {
    secureStore.delete(SecureKeys.imapAccount);
  },

  has(): boolean {
    return secureStore.has(SecureKeys.imapAccount);
  },
};
