/**
 * Gmail session health — keeps the "always logged in" feel by detecting expired
 * tokens early and surfacing a one-tap reconnect instead of silent failure.
 */

import { google } from 'googleapis';
import { getOAuthClient, getStoredTokens } from './auth';
import { GmailAuthExpiredError, isGmailAuthExpiredError } from './client';
import { notifyAuthChanged } from './authNotify';

let sessionHealthy = true;
let reconnectNeeded = false;
let verifyInflight: Promise<boolean> | null = null;

export function getGmailSessionFlags(): {
  sessionHealthy: boolean;
  reconnectNeeded: boolean;
} {
  return { sessionHealthy, reconnectNeeded };
}

export function resetGmailSessionState(): void {
  sessionHealthy = true;
  reconnectNeeded = false;
  verifyInflight = null;
}

export function markGmailSessionHealthy(): void {
  sessionHealthy = true;
  reconnectNeeded = false;
  notifyAuthChanged();
}

export function markGmailSessionExpired(): void {
  if (!getStoredTokens()) {
    sessionHealthy = false;
    reconnectNeeded = false;
    notifyAuthChanged();
    return;
  }
  sessionHealthy = false;
  reconnectNeeded = true;
  notifyAuthChanged();
}

/** True when the error was an auth expiry and session state was updated. */
export function onGmailApiAuthFailure(err: unknown): boolean {
  if (!isGmailAuthExpiredError(err)) return false;
  markGmailSessionExpired();
  return true;
}

/**
 * Lightweight Gmail API ping. Refreshes access tokens when possible.
 * Transient network errors do not flip reconnectNeeded.
 */
export async function verifyGmailSession(): Promise<boolean> {
  if (!getStoredTokens()) {
    sessionHealthy = false;
    reconnectNeeded = false;
    return false;
  }

  if (verifyInflight) return verifyInflight;

  verifyInflight = (async () => {
    const auth = getOAuthClient();
    if (!auth) {
      sessionHealthy = false;
      reconnectNeeded = false;
      return false;
    }

    try {
      const gmail = google.gmail({ version: 'v1', auth });
      await gmail.users.getProfile({ userId: 'me' });
      markGmailSessionHealthy();
      return true;
    } catch (err) {
      if (err instanceof GmailAuthExpiredError || isGmailAuthExpiredError(err)) {
        markGmailSessionExpired();
        return false;
      }
      console.warn('[gmail] session verify failed (non-auth)', (err as Error).message);
      return sessionHealthy;
    } finally {
      verifyInflight = null;
    }
  })();

  return verifyInflight;
}
