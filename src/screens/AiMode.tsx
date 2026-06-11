import { useEffect, useMemo, useState, useRef } from 'react';
import { useAppStore } from '../state/appStore';
import { ipc } from '../lib/ipc';
import type { AiMode, AiProviderId } from '@shared/types';
import { isLocalAiUnlocked } from '@shared/monetization';
import { useI18n } from '../i18n/useI18n';

export function AiModeScreen() {
  const { t } = useI18n();
  const prefs = useAppStore((s) => s.preferences);
  const monetization = useAppStore((s) => s.monetization);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const goto = useAppStore((s) => s.goto);

  const openPlans = () => goto('plans');

  const [mode, setMode] = useState<AiMode>('cloud');
  const [provider, setProvider] = useState<AiProviderId>('openai');
  const [providers, setProviders] = useState<
    Array<{ id: string; label: string; configured: boolean; isCloud: boolean }>
  >([]);
  const [busy, setBusy] = useState(false);
  const userPickedMode = useRef(false);

  useEffect(() => {
    void ipc.invoke(ipc.channels.aiProvidersStatus).then(setProviders);
  }, []);

  useEffect(() => {
    if (!prefs || userPickedMode.current) return;
    const initialMode =
      prefs.aiMode === 'off' && !prefs.onboardingCompleted ? 'cloud' : prefs.aiMode;
    if (initialMode === 'local' || initialMode === 'cloud') {
      setMode(initialMode);
    }
    setProvider(prefs.aiProvider);
  }, [prefs?.aiMode, prefs?.aiProvider, prefs?.onboardingCompleted]);

  const selectedCloudConfigured = useMemo(() => {
    const p = providers.find((x) => x.id === provider);
    return p?.configured ?? false;
  }, [providers, provider]);

  const localBlocked = useMemo(() => {
    if (!prefs || !monetization) return false;
    return !isLocalAiUnlocked(prefs, monetization.hasPaidFeatures);
  }, [prefs, monetization]);

  const onSave = async () => {
    if (mode === 'cloud' && !selectedCloudConfigured) return;
    if (mode === 'local' && localBlocked) return;
    setBusy(true);
    try {
      const patch: Parameters<typeof setPrefs>[0] = { aiMode: mode, aiProvider: provider };
      if (mode === 'local' && prefs?.localAiPreferredRuntime === 'none') {
        patch.localAiPreferredRuntime = 'managed';
      }
      await setPrefs(patch);
      userPickedMode.current = false;

      // Re-login: skip wizard; PC check only on first local-AI setup.
      if (prefs?.onboardingCompleted) {
        goto('home');
        return;
      }

      if (mode !== 'local') {
        await setPrefs({ onboardingCompleted: true });
        goto('home');
        return;
      }
      const cached = await ipc.invoke(ipc.channels.hardwareGetCached);
      if (cached || prefs?.hardwareCheckDismissed) {
        await setPrefs({ onboardingCompleted: true });
        goto('home');
        return;
      }
      goto('capability');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <h1 className="h1">{t('aiMode.title')}</h1>
      <p className="lede">{t('aiMode.lede')}</p>

      <div className="stack">
        <ModeCard
          checked={mode === 'cloud'}
          onSelect={() => {
            userPickedMode.current = true;
            setMode('cloud');
          }}
          title={t('aiMode.cloud')}
          subtitle={t('aiMode.cloudSub')}
          selectedLabel={t('aiMode.selected')}
        />
        <ModeCard
          checked={mode === 'local'}
          onSelect={() => {
            if (!localBlocked) {
              userPickedMode.current = true;
              setMode('local');
            }
          }}
          title={t('aiMode.local')}
          subtitle={t('aiMode.localSub')}
          disabled={localBlocked}
          selectedLabel={t('aiMode.selected')}
        />
      </div>

      {localBlocked && (
        <p className="subtle" style={{ margin: 0 }}>
          {t('aiMode.localPremiumLocked')}
        </p>
      )}

      {mode === 'cloud' && (
        <div className="card stack">
          <div className="field">
            <label>{t('aiMode.provider')}</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AiProviderId)}
            >
              {providers
                .filter((p) => p.isCloud)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.configured ? t('aiMode.providerAvailable') : t('aiMode.providerMissing')}
                  </option>
                ))}
            </select>
          </div>
          {!selectedCloudConfigured && (
            <div className="stack tight">
              <p className="subtle" style={{ margin: 0, color: 'var(--prio-high-ink)' }}>
                {t('aiMode.cloudUnavailable')}
              </p>
              <button type="button" className="btn ghost" onClick={openPlans}>
                {t('settings.openPlans')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost" onClick={() => goto('gmail-login')}>
          {t('aiMode.back')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || (mode === 'cloud' && !selectedCloudConfigured) || (mode === 'local' && localBlocked)}
          onClick={() => void onSave()}
        >
          {t('aiMode.continue')}
        </button>
      </div>
    </div>
  );
}

function ModeCard({
  checked,
  onSelect,
  title,
  subtitle,
  disabled,
  selectedLabel,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
  selectedLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="card"
      aria-pressed={checked}
      style={{
        textAlign: 'left',
        borderColor: checked ? 'var(--accent-ink)' : 'var(--border-soft)',
        boxShadow: checked ? '0 0 0 1px var(--accent-ink)' : undefined,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div className="stack tight">
          <strong>{title}</strong>
          <span className="subtle">{subtitle}</span>
        </div>
        {checked && (
          <span className="badge low" style={{ flexShrink: 0 }}>
            {selectedLabel}
          </span>
        )}
      </div>
    </button>
  );
}
