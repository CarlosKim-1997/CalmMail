import brandCamel from '../assets/brand-camel.png';
import { useI18n } from '../i18n/useI18n';

export function BrandHomeButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      className={`brand-home-btn${active ? ' active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={t('sidebar.homeTitle')}
    >
      <img src={brandCamel} alt="" width={36} height={36} className="brand-home-btn__mark" />
      <span className="brand-home-btn__text">
        <span className="brand-home-btn__name">{t('sidebar.brand')}</span>
        <span className="brand-home-btn__hint">{t('sidebar.homeHint')}</span>
      </span>
    </button>
  );
}
