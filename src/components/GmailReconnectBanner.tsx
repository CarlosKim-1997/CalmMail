import { useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';

/** Shown when stored Gmail tokens need a quick browser re-approval. */
export function GmailReconnectBanner() {
  const { t } = useI18n();
  const authStatus = useAppStore((s) => s.authStatus);
  const reconnectGmail = useAppStore((s) => s.reconnectGmail);
  const gmailReconnectError = useAppStore((s) => s.gmailReconnectError);
  const [busy, setBusy] = useState(false);

  if (!authStatus?.gmailReconnectNeeded) return null;

  const onReconnect = async () => {
    setBusy(true);
    try {
      await reconnectGmail();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gmail-reconnect-banner card stack" role="status" aria-live="polite">
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="stack tight" style={{ flex: 1, minWidth: 200 }}>
          <strong>{t('gmail.reconnectTitle')}</strong>
          <p className="subtle" style={{ margin: 0 }}>
            {t('gmail.reconnectBody', { email: authStatus.gmailEmail ?? '' })}
          </p>
          {gmailReconnectError && (
            <p style={{ margin: 0, color: 'var(--prio-high-ink)', fontSize: 13 }}>
              {gmailReconnectError}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void onReconnect()}
        >
          {busy ? t('gmail.reconnectBusy') : t('gmail.reconnectCta')}
        </button>
      </div>
    </div>
  );
}
