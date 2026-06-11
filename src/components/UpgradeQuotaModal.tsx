import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';
import { ipc } from '../lib/ipc';

type Props = {
  open: boolean;
  resetAt?: number;
  limit?: number;
  onClose: () => void;
};

/**
 * Shown when the free-tier daily cloud briefing cap is hit.
 * CTA order: Premium → BYOK → Local AI (product spec).
 */
export function UpgradeQuotaModal({ open, resetAt, limit, onClose }: Props) {
  const { t, lang } = useI18n();
  const goto = useAppStore((s) => s.goto);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const resetTime =
    resetAt != null
      ? new Date(resetAt).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  const goPlans = () => {
    onClose();
    goto('plans');
  };

  const goPremium = () => {
    onClose();
    void ipc.invoke(ipc.channels.premiumLearnMore);
  };

  const goLocal = async () => {
    onClose();
    await setPrefs({
      aiMode: 'local',
      localAiPreferredRuntime: 'managed',
    });
    goto('local-ai');
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-quota-title"
        className="modal card stack"
        style={{ maxWidth: 440 }}
      >
        <h2 id="upgrade-quota-title" className="h2" style={{ margin: 0 }}>
          {t('upgrade.title')}
        </h2>
        <p className="subtle" style={{ margin: 0 }}>
          {t('upgrade.lede', { limit: limit ?? 2 })}
        </p>
        {resetTime && (
          <p className="subtle" style={{ margin: 0 }}>
            {t('upgrade.resetAt', { time: resetTime })}
          </p>
        )}

        <div className="stack tight">
          <button type="button" className="btn primary" onClick={goPremium}>
            {t('upgrade.ctaPremium')}
          </button>
          <p className="subtle" style={{ margin: 0 }}>{t('upgrade.hintPremium')}</p>
        </div>

        <div className="stack tight">
          <button type="button" className="btn" onClick={goPlans}>
            {t('upgrade.ctaByok')}
          </button>
          <p className="subtle" style={{ margin: 0 }}>{t('upgrade.hintByok')}</p>
        </div>

        <div className="stack tight">
          <button type="button" className="btn" onClick={() => void goLocal()}>
            {t('upgrade.ctaLocal')}
          </button>
          <p className="subtle" style={{ margin: 0 }}>{t('upgrade.hintLocal')}</p>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('upgrade.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
