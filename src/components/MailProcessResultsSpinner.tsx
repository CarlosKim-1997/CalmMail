import { useI18n } from '../i18n/useI18n';

/** Circular loader shown in the mail-process results slot while regenerating. */
export function MailProcessResultsSpinner() {
  const { t } = useI18n();

  return (
    <div className="mail-process-slot__loader" role="status" aria-live="polite">
      <span className="mail-process-spinner" aria-hidden />
      <span className="sr-only">{t('briefing.generating')}</span>
    </div>
  );
}
