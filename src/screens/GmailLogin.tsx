import { useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';

export function GmailLoginScreen() {
  const { t } = useI18n();
  const auth = useAppStore((s) => s.authStatus);
  const prefs = useAppStore((s) => s.preferences);
  const connect = useAppStore((s) => s.connectGmail);
  const goto = useAppStore((s) => s.goto);
  const clearGmailConnectError = useAppStore((s) => s.clearGmailConnectError);
  const [busy, setBusy] = useState(false);

  const onConnect = async () => {
    setBusy(true);
    try {
      await connect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <h1 className="h1">{t('gmail.title')}</h1>
      <p className="lede">{t('gmail.lede')}</p>

      <div className="card stack">
        {auth?.gmailConnected ? (
          <>
            <div className="row between">
              <div className="stack tight">
                <strong>{t('gmail.connected')}</strong>
                <span className="subtle">{auth.gmailEmail}</span>
              </div>
              <span className="badge low">{t('gmail.readonly')}</span>
            </div>
            <div className="divider" />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => goto(prefs?.onboardingCompleted ? 'home' : 'ai-mode')}
              >
                {prefs?.onboardingCompleted ? t('gmail.openHome') : t('gmail.continue')}
              </button>
            </div>
          </>
        ) : (
          <>
            {!auth?.gmailOAuthConfigured && (
              <p style={{ color: 'var(--prio-high-ink)', margin: 0 }}>{t('gmail.oauthMissing')}</p>
            )}
            <p className="subtle" style={{ margin: 0 }}>{t('gmail.browserHint')}</p>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  clearGmailConnectError();
                  goto('onboarding');
                }}
              >
                {t('gmail.back')}
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void onConnect()}>
                {busy ? t('gmail.waiting') : t('gmail.connect')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
