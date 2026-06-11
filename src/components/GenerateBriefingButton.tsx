import { useI18n } from '../i18n/useI18n';

/**
 * Shared primary action for creating a morning briefing (dashboard + briefing tab).
 * Fixed min-width keeps the label from resizing when switching to "generating".
 */
export function GenerateBriefingButton({
  disabled,
  busy,
  onClick,
  title,
}: {
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  title?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="btn primary generate-briefing-btn"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-busy={busy}
    >
      {busy ? t('mailProcess.generating') : t('mailProcess.start')}
    </button>
  );
}
