import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';

type ByokStatus = {
  openai: boolean;
  anthropic: boolean;
  secureStoreAvailable: boolean;
};

export function MyApiKeysSection() {
  const { t } = useI18n();
  const monetization = useAppStore((s) => s.monetization);
  const goto = useAppStore((s) => s.goto);

  const tier = monetization?.effectiveTier ?? 'free';
  const onMyApiPlan = tier === 'byok';

  const [byokStatus, setByokStatus] = useState<ByokStatus | null>(null);
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshByok = useCallback(async () => {
    const s = await ipc.invoke(ipc.channels.aiByokKeysStatus);
    setByokStatus(s);
  }, []);

  useEffect(() => {
    void refreshByok();
  }, [refreshByok, tier]);

  const saveKeys = async () => {
    if (!byokStatus?.secureStoreAvailable) return;
    setBusy(true);
    setMsg(null);
    try {
      if (openaiKey.trim()) {
        await ipc.invoke(ipc.channels.aiByokKeySet, {
          provider: 'openai',
          apiKey: openaiKey.trim(),
        });
      }
      if (anthropicKey.trim()) {
        await ipc.invoke(ipc.channels.aiByokKeySet, {
          provider: 'anthropic',
          apiKey: anthropicKey.trim(),
        });
      }
      setOpenaiKey('');
      setAnthropicKey('');
      await refreshByok();
      setMsg(t('aiSettings.myApi.keysSaved'));
    } finally {
      setBusy(false);
    }
  };

  const hasAnyKey = Boolean(byokStatus?.openai || byokStatus?.anthropic);

  return (
    <section className="card stack">
      <div className="stack tight">
        <h2 className="h2" style={{ margin: 0 }}>
          {t('aiSettings.myApi.title')}
        </h2>
        <p className="subtle" style={{ margin: 0 }}>
          {t('aiSettings.myApi.lede')}
        </p>
      </div>

      {!onMyApiPlan ? (
        <div className="stack tight">
          <p className="subtle" style={{ margin: 0 }}>
            {t('aiSettings.myApi.notOnPlan')}
          </p>
          <button type="button" className="btn ghost" onClick={() => goto('plans')}>
            {t('settings.openPlans')}
          </button>
        </div>
      ) : (
        <>
          {!hasAnyKey && (
            <p className="subtle" style={{ margin: 0, color: 'var(--prio-high-ink)' }}>
              {t('aiSettings.myApi.needsKey')}
            </p>
          )}
          {!byokStatus?.secureStoreAvailable && (
            <p className="subtle" style={{ margin: 0, color: 'var(--prio-high-ink)' }}>
              {t('aiSettings.myApi.secureUnavailable')}
            </p>
          )}
          <div className="my-api-trust stack tight">
            <span>{t('aiSettings.myApi.trust1')}</span>
            <span>{t('aiSettings.myApi.trust2')}</span>
            <span>{t('aiSettings.myApi.trust3')}</span>
          </div>
          <div className="field">
            <label>{t('aiSettings.myApi.openai')}</label>
            <input
              type="password"
              autoComplete="off"
              placeholder={
                byokStatus?.openai ? t('aiSettings.myApi.keyConfigured') : t('aiSettings.myApi.keyPlaceholder')
              }
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              disabled={!byokStatus?.secureStoreAvailable}
            />
          </div>
          <div className="field">
            <label>{t('aiSettings.myApi.anthropic')}</label>
            <input
              type="password"
              autoComplete="off"
              placeholder={
                byokStatus?.anthropic
                  ? t('aiSettings.myApi.keyConfigured')
                  : t('aiSettings.myApi.keyPlaceholder')
              }
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              disabled={!byokStatus?.secureStoreAvailable}
            />
          </div>
          <p className="subtle" style={{ margin: 0 }}>
            {t('aiSettings.myApi.keyHint')}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !byokStatus?.secureStoreAvailable}
              onClick={() => void saveKeys()}
            >
              {t('aiSettings.myApi.saveKeys')}
            </button>
          </div>
          {msg && (
            <p className="subtle" style={{ margin: 0, color: 'var(--accent-ink)' }}>
              {msg}
            </p>
          )}
        </>
      )}
    </section>
  );
}
