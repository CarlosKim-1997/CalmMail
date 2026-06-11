import { useEffect, useState } from 'react';
import type { BriefingDurationEstimate, UserPreferences } from '@shared/types';
import { LOCAL_TRIAGE_USER_MAX } from '@shared/triage';
import { ipc } from '../lib/ipc';

export function MailProcessPreflight({
  prefs,
  t,
  compact = false,
}: {
  prefs: UserPreferences;
  t: (k: string, vars?: Record<string, string | number>) => string;
  /** Smaller layout for home hero area. */
  compact?: boolean;
}) {
  const [estimate, setEstimate] = useState<BriefingDurationEstimate | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void ipc.invoke(ipc.channels.briefingEstimate).then((est) => {
        if (!cancelled) setEstimate(est);
      });
    };
    load();
    const id = window.setInterval(load, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [prefs.aiMode, prefs.triageWindowDays, prefs.localAiPreferredRuntime]);

  if (!estimate || prefs.aiMode === 'off') return null;

  const isLocal = estimate.aiMode === 'local' && !estimate.isCloud;
  const windowDays = isLocal ? 7 : prefs.triageWindowDays;
  const cap = isLocal ? LOCAL_TRIAGE_USER_MAX : 80;
  const overflow = estimate.unreadInScope > cap;
  const triageLine = estimate.triageByRules
    ? t('mailProcess.preflight.ruleTriage', {
        n: estimate.aiTriageCount,
        cap,
      })
    : t('mailProcess.preflight.cloudHybrid', {
        rule: estimate.aiTriageCount,
        ai: estimate.ambiguousTriageCount,
        cap,
      });

  return (
    <section
      className={`card stack mail-process-preflight${compact ? ' mail-process-preflight--compact' : ''}`}
    >
      <div className="stack tight">
        <h2 className="h2" style={{ margin: 0, fontSize: compact ? 15 : undefined }}>
          {t('mailProcess.preflight.title')}
        </h2>
        <p className="subtle" style={{ margin: 0, fontSize: 13 }}>
          {t('mailProcess.preflight.lede', { cached: estimate.totalScanned })}
        </p>
      </div>

      <div className="mail-process-preflight__stats">
        <div className="mail-process-preflight__stat mail-process-preflight__stat--primary">
          <span className="mail-process-preflight__value">{estimate.unreadInScope}</span>
          <span className="mail-process-preflight__label">
            {t('mailProcess.preflight.statUnread', { days: windowDays })}
          </span>
        </div>
        <div className="mail-process-preflight__stat">
          <span className="mail-process-preflight__value">
            {estimate.estimatedMinSec}~{estimate.estimatedMaxSec}
          </span>
          <span className="mail-process-preflight__label">
            {t('mailProcess.preflight.statEta')}
          </span>
        </div>
        <div className="mail-process-preflight__stat">
          <span className="mail-process-preflight__value">{estimate.aiTriageCount}</span>
          <span className="mail-process-preflight__label">
            {t('mailProcess.preflight.statTriage')}
          </span>
        </div>
      </div>

      <p className="subtle mail-process-preflight__detail" style={{ margin: 0 }}>
        {triageLine}
        {overflow &&
          (isLocal
            ? ` · ${t('mailProcess.preflight.overflowLocal')}`
            : ` · ${t('mailProcess.preflight.overflowCloud')}`)}
      </p>
      {isLocal && (
        <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
          {t('mailProcess.preflight.localBriefingOnly', { n: LOCAL_TRIAGE_USER_MAX })}
        </p>
      )}
    </section>
  );
}
