/**
 * Gmail OAuth (Desktop app loopback flow).
 *
 * We use the "Installed application / Loopback IP address" pattern. The user
 * is sent to Google's consent page via the system browser (BrowserWindow can
 * also work but the system browser is cleaner). Tokens are then stored
 * encrypted via secureStore.
 *
 * Scopes:
 *   - gmail.readonly      (read inbox/threads) — default connect
 *   - userinfo.email      (know who they are)
 *   - gmail.modify        (opt-in: mark Later group read only; no send)
 */

import { google, Auth } from 'googleapis';
import { BrowserWindow, shell } from 'electron';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import { SecureKeys, secureStore } from '../persistence/secureStore';

export const GMAIL_READONLY_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

/** @deprecated Use GMAIL_READONLY_SCOPES */
export const GMAIL_SCOPES = [...GMAIL_READONLY_SCOPES];

export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

export function hasGmailModifyScope(): boolean {
  const scope = getStoredTokens()?.scope ?? '';
  return scope.includes('gmail.modify');
}

interface StoredTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
  user_email?: string | null;
}

function readClientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isGmailConfigured(): boolean {
  return readClientCreds() != null;
}

export function getStoredTokens(): StoredTokens | null {
  try {
    const raw = secureStore.get(SecureKeys.gmailTokens);
    if (!raw) return null;
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function storeTokens(t: StoredTokens): void {
  secureStore.set(SecureKeys.gmailTokens, JSON.stringify(t));
}

export function clearStoredTokens(): void {
  secureStore.delete(SecureKeys.gmailTokens);
}

/** Get an authenticated OAuth2Client, refreshing if needed. */
export function getOAuthClient(): Auth.OAuth2Client | null {
  const creds = readClientCreds();
  if (!creds) return null;
  const tokens = getStoredTokens();
  if (!tokens) return null;

  const client = new google.auth.OAuth2({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  client.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    id_token: tokens.id_token ?? undefined,
  });
  client.on('tokens', (newTokens) => {
    const current = getStoredTokens() ?? {};
    storeTokens({ ...current, ...newTokens });
  });
  return client;
}

/**
 * Run an interactive OAuth flow.
 *
 * Strategy:
 *   1. Spin up a tiny loopback HTTP server on a free port.
 *   2. Build an auth URL with redirect_uri = http://127.0.0.1:<port>.
 *   3. Open the URL in the system browser.
 *   4. Receive the auth code, exchange it for tokens, store encrypted.
 */
export type GmailOAuthMode = 'initial' | 'reconnect';

export async function runGmailOAuthFlow(opts?: {
  scopes?: readonly string[];
  mode?: GmailOAuthMode;
}): Promise<{
  ok: true;
  email: string;
} | { ok: false; reason: string }> {
  const creds = readClientCreds();
  if (!creds) {
    return { ok: false, reason: 'OAuth client credentials are not configured.' };
  }

  const mode = opts?.mode ?? 'initial';
  const scopes = opts?.scopes ?? GMAIL_READONLY_SCOPES;
  const prior = getStoredTokens();
  const port = await pickFreePort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const state = crypto.randomBytes(16).toString('hex');

  const client = new google.auth.OAuth2({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri,
  });

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: mode === 'initial' ? 'consent' : 'select_account',
    scope: [...scopes],
    state,
    include_granted_scopes: true,
  });

  const codePromise = listenForCallback(port, state);
  await shell.openExternal(authUrl);

  let code: string;
  try {
    code = await codePromise;
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  const tokenResp = await client.getToken(code);
  const tokens = tokenResp.tokens;

  let email: string | null = null;
  try {
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    email = me.data.email ?? null;
  } catch {
    email = null;
  }

  const resolvedEmail = email ?? prior?.user_email ?? null;
  storeTokens({ ...tokens, user_email: resolvedEmail });
  if (!resolvedEmail) {
    return { ok: false, reason: 'Could not determine user email.' };
  }
  return { ok: true, email: resolvedEmail };
}

/** Re-authorize after refresh token expiry — lighter Google prompt. */
export async function runGmailReconnectFlow(): Promise<
  { ok: true; email: string } | { ok: false; reason: string }
> {
  const prior = getStoredTokens();
  if (!prior?.access_token && !prior?.refresh_token) {
    return runGmailOAuthFlow({ mode: 'initial' });
  }
  const scopes = prior.scope?.includes('gmail.modify')
    ? ([...GMAIL_READONLY_SCOPES, GMAIL_MODIFY_SCOPE] as const)
    : GMAIL_READONLY_SCOPES;
  return runGmailOAuthFlow({ scopes, mode: 'reconnect' });
}

/** Incremental consent for bulk mark-as-read (Later triage). Requires existing Gmail link. */
export async function runGmailModifyConsentFlow(): Promise<
  { ok: true; email: string } | { ok: false; reason: string }
> {
  const tokens = getStoredTokens();
  if (!tokens?.access_token && !tokens?.refresh_token) {
    return { ok: false, reason: 'Gmail is not connected.' };
  }
  if (hasGmailModifyScope()) {
    return { ok: true, email: tokens.user_email ?? '' };
  }
  return runGmailOAuthFlow({
    scopes: [...GMAIL_READONLY_SCOPES, GMAIL_MODIFY_SCOPE],
    mode: 'reconnect',
  });
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('Could not allocate a free port.'));
      }
    });
  });
}

function listenForCallback(port: number, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlPage('Authorization failed', error));
          server.close();
          reject(new Error(error));
          return;
        }
        if (!state || state !== expectedState || !code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlPage('Authorization failed', 'Invalid state or code.'));
          server.close();
          reject(new Error('Invalid state or code.'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('You are connected.', 'You can close this tab and return to CalmMail.'));
        server.close();
        resolve(code);
      } catch (err) {
        res.writeHead(500);
        res.end();
        server.close();
        reject(err as Error);
      }
    });
    server.listen(port, '127.0.0.1');
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out.'));
    }, 5 * 60 * 1000);
  });
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>
    body { font-family: -apple-system, Segoe UI, sans-serif; background:#fafaf7;
           color:#1f2421; margin:0; display:flex; align-items:center;
           justify-content:center; height:100vh; }
    .card { padding: 28px 32px; background:#fff; border-radius:14px;
            box-shadow: 0 1px 0 rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.05);
            text-align:center; max-width: 380px; }
    h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
    p { margin: 0; color:#5b6360; }
  </style></head>
  <body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

// `BrowserWindow` is imported to keep the module compatible with future
// in-app browser fallback; it is intentionally unused at the moment.
void BrowserWindow;
