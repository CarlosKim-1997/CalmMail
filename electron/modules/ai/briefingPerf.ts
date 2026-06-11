/** Dev-facing phase timings for mail-process latency diagnosis (main process logs). */

let runStart = 0;

export function briefingPerfStart(): void {
  runStart = Date.now();
}

export function briefingPerfMark(phase: string, detail?: string): void {
  const ms = Date.now() - runStart;
  const extra = detail ? ` ${detail}` : '';
  console.info(`[briefing:perf] ${phase} @ ${ms}ms${extra}`);
}
