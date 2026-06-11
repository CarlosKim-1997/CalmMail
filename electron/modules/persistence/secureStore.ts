/**
 * Encrypted local storage for secrets (OAuth tokens, AI API keys).
 *
 * Trust contract:
 *   - Secrets are encrypted with the OS keychain via Electron `safeStorage`.
 *   - On platforms where safeStorage is unavailable, we *refuse* to store the
 *     secret rather than silently falling back to plaintext. This is a
 *     trust-first decision.
 *   - Secrets are never sent over IPC unless the renderer explicitly requests
 *     a one-shot "needs key" handler — the renderer normally only sees
 *     "configured: true/false" flags.
 */

import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FILE_NAME = 'secure.json';

interface Envelope {
  version: 1;
  entries: Record<string, string>; // key -> base64 encrypted blob
}

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function load(): Envelope {
  try {
    const buf = fs.readFileSync(filePath(), 'utf-8');
    const parsed = JSON.parse(buf) as Envelope;
    if (parsed.version !== 1 || typeof parsed.entries !== 'object') {
      return { version: 1, entries: {} };
    }
    return parsed;
  } catch {
    return { version: 1, entries: {} };
  }
}

function save(env: Envelope): void {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(env), { mode: 0o600 });
}

export class SecureStoreUnavailableError extends Error {
  constructor() {
    super('OS-level encryption (safeStorage) is unavailable on this system.');
    this.name = 'SecureStoreUnavailableError';
  }
}

function assertAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecureStoreUnavailableError();
  }
}

export const secureStore = {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  },

  set(key: string, plaintext: string): void {
    assertAvailable();
    const env = load();
    const enc = safeStorage.encryptString(plaintext);
    env.entries[key] = enc.toString('base64');
    save(env);
  },

  get(key: string): string | null {
    assertAvailable();
    const env = load();
    const raw = env.entries[key];
    if (!raw) return null;
    try {
      return safeStorage.decryptString(Buffer.from(raw, 'base64'));
    } catch {
      return null;
    }
  },

  has(key: string): boolean {
    const env = load();
    return Object.prototype.hasOwnProperty.call(env.entries, key);
  },

  delete(key: string): void {
    const env = load();
    if (key in env.entries) {
      delete env.entries[key];
      save(env);
    }
  },

  listKeys(): string[] {
    return Object.keys(load().entries);
  },
};

export const SecureKeys = {
  gmailTokens: 'gmail.oauth.tokens',
  /** Legacy only: older builds could store cloud keys here; prefer OPENAI_* / ANTHROPIC_* in .env */
  openaiKey: 'ai.openai.apiKey',
  anthropicKey: 'ai.anthropic.apiKey',
  /** BYOK plan: end-user keys (never used for Free/Premium hosted runs). */
  userOpenaiKey: 'ai.user.openai.apiKey',
  userAnthropicKey: 'ai.user.anthropic.apiKey',
  /** Stripe Customer id after Checkout (Premium billing). */
  stripeCustomerId: 'billing.stripe.customerId',
  openrouterKey: 'ai.openrouter.apiKey',
  geminiKey: 'ai.gemini.apiKey',
} as const;
