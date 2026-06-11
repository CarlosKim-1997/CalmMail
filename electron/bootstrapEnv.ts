/**
 * Load `.env` into `process.env` before any other main-process code reads it.
 *
 * Vite injects env for the renderer; the Electron **main** bundle does not
 * receive `GOOGLE_OAUTH_*` from `.env` unless we load it explicitly. Without
 * this, "Connect Gmail" appears to do nothing because OAuth client creds are
 * missing at runtime.
 */

import path from 'node:path';
import dotenv from 'dotenv';
import { app } from 'electron';

const roots: string[] = [];
roots.push(process.cwd());
try {
  roots.push(app.getAppPath());
} catch {
  // ignore
}

const seen = new Set<string>();
for (const root of roots) {
  if (!root || seen.has(root)) continue;
  seen.add(root);
  dotenv.config({ path: path.join(root, '.env') });
  dotenv.config({ path: path.join(root, '.env.local'), override: true });
}

// Dev builds: catalog SHA placeholders are null until release pinning.
// Allow verified-host downloads without a pinned hash so local AI setup works.
try {
  if (!app.isPackaged && process.env.CALMMAIL_ALLOW_UNPINNED !== '1') {
    process.env.CALMMAIL_ALLOW_UNPINNED = '1';
  }
} catch {
  /* app not ready yet — .env may still set CALMMAIL_ALLOW_UNPINNED manually */
}
