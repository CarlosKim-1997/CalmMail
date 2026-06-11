import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';

export function OnboardingScreen() {
  const { t } = useI18n();
  const goto = useAppStore((s) => s.goto);
  const gmailConnectError = useAppStore((s) => s.gmailConnectError);
  const clearGmailConnectError = useAppStore((s) => s.clearGmailConnectError);

  return (
    <div className="onboard">
      <h1 className="h1">{t('onboarding.title')}</h1>
      <p className="lede">{t('onboarding.lede')}</p>

      {gmailConnectError && (
        <div
          className="card stack"
          style={{
            borderColor: 'var(--prio-high-ink)',
            background: 'var(--prio-high-bg)',
          }}
        >
          <strong style={{ color: 'var(--prio-high-ink)' }}>{t('gmail.failTitle')}</strong>
          <p className="subtle" style={{ margin: 0, color: 'var(--ink-primary)' }}>
            {gmailConnectError}
          </p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => clearGmailConnectError()}>
              {t('gmail.failDismiss')}
            </button>
            <button type="button" className="btn primary" onClick={() => goto('gmail-login')}>
              {t('gmail.failRetry')}
            </button>
          </div>
        </div>
      )}

      <div className="card stack">
        <div className="row" style={{ gap: 16 }}>
          <Pill label={t('onboarding.pill1')} />
          <Pill label={t('onboarding.pill2')} />
          <Pill label={t('onboarding.pill3')} />
        </div>
        <p className="subtle" style={{ margin: 0 }}>{t('onboarding.cardLine')}</p>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn primary" onClick={() => goto('gmail-login')}>
          {t('onboarding.cta')}
        </button>
      </div>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: 'var(--accent-bg)',
        color: 'var(--accent-ink)',
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
}
