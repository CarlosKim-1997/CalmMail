import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';

type Placement = 'dashboard' | 'settings';

/**
 * Calm, non-blocking “utility app” style sponsor slot — never fullscreen,
 * never injected into mail or notifications.
 */
export function QuietSponsorCard({ placement }: { placement: Placement }) {
  const { t } = useI18n();
  const show = useAppStore((s) => s.monetization?.showSponsorSlots);

  if (!show) return null;

  return (
    <aside className="sponsor-quiet" aria-label={t('sponsor.aria')}>
      <div className="sponsor-quiet-head">
        <span className="sponsor-quiet-label">{t('sponsor.label')}</span>
      </div>
      <p className="subtle" style={{ margin: 0 }}>
        {t(`sponsor.hint.${placement}`)}
      </p>
    </aside>
  );
}
