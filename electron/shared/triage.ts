/** Default unread window for mail triage (days). */
export const TRIAGE_WINDOW_DAYS = 7;

export type TriageWindowDays = 7 | 14;

export const TRIAGE_WINDOW_OPTIONS: readonly TriageWindowDays[] = [7, 14];

/** Max unread rows included in the AI prompt (token guard). */
export const TRIAGE_UNREAD_AI_CAP = 80;

/** User-facing + internal cap for local AI triage per pass. */
export const LOCAL_TRIAGE_USER_MAX = 40;

/** Tighter cap for local llama-server (8192 ctx incl. output). */
export const LOCAL_TRIAGE_UNREAD_AI_CAP = LOCAL_TRIAGE_USER_MAX;

export const TRIAGE_GROUP_IDS = ['now', 'today', 'later'] as const;

export function resolveTriageWindowDays(raw: unknown): TriageWindowDays {
  return raw === 14 ? 14 : 7;
}
