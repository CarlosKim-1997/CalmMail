/**
 * Lightweight interval scheduler for the background monitor.
 *
 * Why not node-cron? We don't need cron expressions — just one repeating job
 * whose interval can change at runtime when the user updates preferences.
 *
 * Design rules:
 *   - The poll is *coalesced*: if a poll is in flight, another tick is a no-op.
 *   - We back off on consecutive failures (1m -> 2m -> 5m -> 15m).
 *   - When the OS is on battery or paused, we still tick lightly. (Battery
 *     awareness can be added later via powerMonitor.)
 */

import { runPoll, type PollReport } from './poller';
import { preferencesMemory } from '@main/modules/memory/preferences';
import { effectiveMonitoringIntervalMinutes } from '@main/modules/monetization/snapshot';
import { runMemoryDecay } from '@main/modules/memory/decay';
import { emailsRepo } from '@main/modules/persistence/repositories/emailsRepo';

const ONE_MINUTE = 60_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

interface State {
  timer: NodeJS.Timeout | null;
  failureCount: number;
  lastDecayAt: number;
  onTickListeners: Array<(r: PollReport) => void>;
}

const state: State = {
  timer: null,
  failureCount: 0,
  lastDecayAt: 0,
  onTickListeners: [],
};

function nextDelayMs(): number {
  const prefs = preferencesMemory.get();
  const minutes = effectiveMonitoringIntervalMinutes(prefs);
  const base = Math.max(1, minutes) * ONE_MINUTE;
  if (state.failureCount === 0) return base;
  const backoffs = [base, base * 2, base * 5, base * 15];
  return backoffs[Math.min(state.failureCount, backoffs.length - 1)];
}

async function tick(): Promise<void> {
  try {
    const report = await runPoll();
    if (!report.ran && report.reason && !report.reason.startsWith('gmail_not_connected')) {
      state.failureCount = Math.min(state.failureCount + 1, 5);
    } else {
      state.failureCount = 0;
    }
    state.onTickListeners.forEach((l) => {
      try { l(report); } catch { /* ignore */ }
    });
  } catch {
    state.failureCount = Math.min(state.failureCount + 1, 5);
  }

  // Daily maintenance: decay + email metadata pruning.
  const now = Date.now();
  if (now - state.lastDecayAt > ONE_DAY) {
    state.lastDecayAt = now;
    try {
      runMemoryDecay(now);
      const retainDays = preferencesMemory.get().retainEmailMetadataDays;
      emailsRepo.prune(retainDays * ONE_DAY);
    } catch {
      // best-effort; never crash the scheduler
    }
  }

  schedule();
}

function schedule(): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => { void tick(); }, nextDelayMs());
  state.timer.unref?.();
}

export const monitorScheduler = {
  start(): void {
    if (state.timer) return;
    state.timer = setTimeout(() => { void tick(); }, 5_000); // first tick after 5s
    state.timer.unref?.();
  },

  stop(): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  },

  /** Force an out-of-band poll, used by the IPC "Run Now" handler. */
  async runNow(): Promise<PollReport> {
    return runPoll();
  },

  onTick(listener: (r: PollReport) => void): () => void {
    state.onTickListeners.push(listener);
    return () => {
      state.onTickListeners = state.onTickListeners.filter((l) => l !== listener);
    };
  },
};
