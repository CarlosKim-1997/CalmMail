import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { ipc } from '../lib/ipc';
import type { HardwareCapability, LocalAiModelInfo } from '@shared/types';
import { recommendLocalAiModels } from '@shared/localAiRecommend';
import { useI18n } from '../i18n/useI18n';
import { HardwareVerdict } from '../components/HardwareVerdict';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function CapabilityScreen() {
  const { t, lang } = useI18n();
  const goto = useAppStore((s) => s.goto);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const prefs = useAppStore((s) => s.preferences);

  const [hw, setHw] = useState<HardwareCapability | null>(null);
  const [hwCheckedAt, setHwCheckedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepLabel, setStepLabel] = useState('');
  const [models, setModels] = useState<LocalAiModelInfo[]>([]);

  const loadCached = useCallback(async () => {
    const cached = await ipc.invoke(ipc.channels.hardwareGetCached);
    if (cached) {
      setHw(cached.capability);
      setHwCheckedAt(cached.analyzedAt);
    }
  }, []);

  useEffect(() => {
    void loadCached();
    void (async () => {
      const m = await ipc.invoke(ipc.channels.localAiManagedListModels);
      setModels(m);
    })();
  }, [loadCached]);

  const recommendedModelName = useMemo(() => {
    if (!hw || models.length === 0) return null;
    const rec = recommendLocalAiModels(models, hw);
    const model = models.find((m) => m.id === rec.primaryModelId);
    return model?.displayName ?? null;
  }, [hw, models]);

  const finishToDashboard = async (dismissed: boolean) => {
    await setPrefs({
      onboardingCompleted: true,
      ...(dismissed ? { hardwareCheckDismissed: true } : {}),
    });
    goto('home');
  };

  const afterCheck = async () => {
    await setPrefs({ hardwareCheckDismissed: true });
  };

  const runCheck = async () => {
    setBusy(true);
    setError(null);
    setStepLabel(t('capability.step.collecting'));
    try {
      await sleep(350);
      setStepLabel(t('capability.step.analyzing'));
      const result = await ipc.invoke(ipc.channels.hardwareAnalyze);
      setHw(result);
      setHwCheckedAt(Date.now());
      setStepLabel('');
      await afterCheck();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showLocalHint = prefs?.aiMode === 'local';

  return (
    <div className="onboard">
      <h1 className="h1">{t('capability.title')}</h1>
      <p className="lede">
        {showLocalHint ? t('capability.ledeLocal') : t('capability.lede')}
      </p>

      <div className="card stack">
        {busy && (
          <div className="stack tight">
            <span className="subtle">{stepLabel || t('capability.analyzing')}</span>
            <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
              {t('capability.estimate', { min: 15, max: 45 })}
            </p>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: 'var(--border-soft)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: '55%',
                  background: 'var(--accent-ink)',
                  animation: 'none',
                }}
              />
            </div>
          </div>
        )}

        {!busy && error && (
          <span style={{ color: 'var(--prio-high-ink)' }}>{error}</span>
        )}

        {!busy && hw && hwCheckedAt != null && (
          <HardwareVerdict hw={hw} analyzedAt={hwCheckedAt} lang={lang} t={t} />
        )}

        {!busy && hw && showLocalHint && recommendedModelName && (
          <span className="subtle" style={{ margin: 0 }}>
            {t('capability.recommendedModel', { name: recommendedModelName })}
          </span>
        )}

        {!busy && !hw && !error && (
          <p className="subtle" style={{ margin: 0 }}>
            {t('capability.optionalEmpty')}
          </p>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn ghost" onClick={() => goto('ai-mode')}>
          {t('common.back')}
        </button>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void finishToDashboard(true)}
          >
            {t('capability.skip')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void runCheck()}
          >
            {busy ? t('capability.analyzing') : hw ? t('capability.recheck') : t('capability.runCheck')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void finishToDashboard(false)}
          >
            {t('capability.openHome')}
          </button>
        </div>
      </div>
    </div>
  );
}
