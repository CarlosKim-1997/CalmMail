/** Dev/QA only: synthetic inbox + briefing for UI capture (no real mail API). */
export function isDemoUiEnabled(): boolean {
  const v = process.env.CALMMAIL_DEMO_UI?.trim();
  return v === '1' || v?.toLowerCase() === 'true';
}

export const DEMO_GMAIL_EMAIL = 'demo@calmmail.dev';
