import { useEffect, useRef, useState } from 'react';
import type { BriefingProgress, BriefingProgressPhase } from '@shared/types';
import { useI18n } from '../i18n/useI18n';

const PROGRESS_STEPS: BriefingProgressPhase[] = [
  'prepare',
  'gather',
  'inspect',
  'ai',
  'triage',
  'finalize',
];

const TICK_MS = 400;
const MAX_SOFT_EXTENSIONS = 4;
/** Each extension adds this fraction of the current deadline window. */
const EXTEND_RATIO = 0.22;

/**
 * Calm progress UI for briefing generation. Blends authoritative milestones
 * from the main process with a slow clock so the bar keeps moving. If the
 * estimate is exceeded, the deadline stretches in small steps (trust-preserving).
 */
export function BriefingProgressPanel({
  active,
  progress,
}: {
  active: boolean;
  progress: BriefingProgress | null;
}) {
  const { t } = useI18n();
  const [displayPct, setDisplayPct] = useState(0);
  const [extended, setExtended] = useState(false);
  const startRef = useRef(0);
  const deadlineRef = useRef(0);
  const baseEstimateRef = useRef(0);
  const extensionsRef = useRef(0);
  const milestoneRef = useRef(0);

  /** When the panel remounts (e.g. user switches tabs), keep the bar in sync with store progress. */
  const syncFromProgress = (p: BriefingProgress) => {
    milestoneRef.current = Math.max(milestoneRef.current, p.percent);
    setDisplayPct((prev) => Math.max(prev, p.percent));
    const base = p.estimatedTotalMs > 0 ? p.estimatedTotalMs : 30_000;
    if (baseEstimateRef.current === 0) baseEstimateRef.current = base;
    if (startRef.current === 0) {
      const elapsed = (p.percent / 100) * base;
      startRef.current = Date.now() - elapsed;
      deadlineRef.current = startRef.current + base;
    } else if (deadlineRef.current === 0) {
      deadlineRef.current = startRef.current + base;
    }
  };

  useEffect(() => {
    if (!active) {
      setDisplayPct(0);
      setExtended(false);
      startRef.current = 0;
      deadlineRef.current = 0;
      baseEstimateRef.current = 0;
      extensionsRef.current = 0;
      milestoneRef.current = 0;
      return;
    }
    if (progress) {
      syncFromProgress(progress);
    } else if (startRef.current === 0) {
      startRef.current = Date.now();
    }
  }, [active, progress]);

  useEffect(() => {
    if (!active) return;

    const id = window.setInterval(() => {
      const now = Date.now();
      if (startRef.current === 0) startRef.current = now;

      let deadline = deadlineRef.current;
      const base = baseEstimateRef.current || progress?.estimatedTotalMs || 30_000;
      if (deadline === 0) {
        deadline = startRef.current + base;
        deadlineRef.current = deadline;
      }

      const elapsed = now - startRef.current;
      const span = Math.max(deadline - startRef.current, 1);

      if (
        now >= deadline &&
        (progress?.phase ?? '') !== 'done' &&
        extensionsRef.current < MAX_SOFT_EXTENSIONS
      ) {
        const bump = Math.round(base * EXTEND_RATIO);
        deadlineRef.current = deadline + bump;
        extensionsRef.current += 1;
        setExtended(true);
      }

      const clockPct = Math.min(94, (elapsed / span) * 100);
      const merged = Math.max(milestoneRef.current, clockPct);
      setDisplayPct((prev) => Math.max(prev, merged));
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [active, progress?.phase, progress?.estimatedTotalMs]);

  useEffect(() => {
    if (progress?.phase === 'done') {
      setDisplayPct(100);
    }
  }, [progress?.phase]);

  if (!active) return null;

  const phase = progress?.phase ?? 'prepare';
  const phaseLabel = t(`briefing.progress.phase.${phase}`);
  const activeStepIndex =
    phase === 'done'
      ? PROGRESS_STEPS.length
      : Math.max(0, PROGRESS_STEPS.indexOf(phase));
  const minSec = progress?.estimatedMinSec ?? 0;
  const maxSec = progress?.estimatedMaxSec ?? 0;
  const scanned = progress?.totalScanned ?? 0;
  const isCloud = progress?.isCloud ?? false;

  const etaLine =
    minSec > 0 && maxSec > 0
      ? t('briefing.progress.etaRange', { min: minSec, max: maxSec })
      : t('briefing.progress.etaUnknown');

  const workloadLine = t('briefing.progress.workload', {
    n: scanned,
    where: isCloud ? t('briefing.progress.whereCloud') : t('briefing.progress.whereLocal'),
  });

  return (
    <div className="card stack briefing-progress" role="status" aria-live="polite">
      <div className="row between" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <strong>{phaseLabel}</strong>
        <span className="subtle" style={{ fontSize: 12 }}>
          {Math.round(displayPct)}%
        </span>
      </div>
      <p className="subtle" style={{ margin: 0, fontSize: 13 }}>
        {workloadLine}
      </p>
      <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
        {etaLine}
        {extended ? ` · ${t('briefing.progress.stillWorking')}` : ''}
      </p>
      <div className="briefing-progress__steps" aria-hidden>
        {PROGRESS_STEPS.map((step, index) => {
          const state =
            index < activeStepIndex ? 'done' : index === activeStepIndex ? 'active' : 'pending';
          return (
            <span key={step} className={`briefing-progress__step briefing-progress__step--${state}`}>
              {t(`briefing.progress.phase.${step}`)}
            </span>
          );
        })}
      </div>
      <div
        className="briefing-progress__track"
        aria-hidden
      >
        <div
          className="briefing-progress__fill"
          style={{ width: `${Math.max(4, displayPct)}%` }}
        />
      </div>
    </div>
  );
}
