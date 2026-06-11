import { getDb } from '../db';
import type { SessionState } from '@shared/types';

const KEY = 'session.v1';
const DEFAULT_STATE: SessionState = {
  todayPriorityThreads: [],
  recentAlertIds: [],
  lastBriefingAt: null,
};

export const sessionRepo = {
  get(): SessionState {
    const row = getDb()
      .prepare<[string], { value: string } | undefined>(
        'SELECT value FROM session_state WHERE key = ?',
      )
      .get(KEY);
    if (!row) return { ...DEFAULT_STATE };
    try {
      return { ...DEFAULT_STATE, ...(JSON.parse(row.value) as Partial<SessionState>) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  },

  patch(patch: Partial<SessionState>): SessionState {
    const next = { ...this.get(), ...patch };
    getDb()
      .prepare(
        `INSERT INTO session_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(KEY, JSON.stringify(next));
    return next;
  },
};
