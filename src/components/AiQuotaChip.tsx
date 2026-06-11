import type { AiQuotaStatus, AppLanguage, SubscriptionTier } from '@shared/types';

type Variant = 'inline' | 'toolbar';

/**
 * Cloud briefing quota hint. `toolbar` = compact badge aligned with briefing action buttons.
 */
export function AiQuotaChip({
  quota,
  tier = 'free',
  lang,
  t,
  variant = 'inline',
  onClick,
}: {
  quota: AiQuotaStatus | null;
  tier?: SubscriptionTier;
  lang: AppLanguage;
  t: (k: string, vars?: Record<string, string | number>) => string;
  variant?: Variant;
  onClick?: () => void;
}) {
  if (!quota || quota.mode === 'off') return null;

  const resetTime = new Date(quota.resetAt).toLocaleTimeString(
    lang === 'ko' ? 'ko-KR' : 'en-US',
    { hour: '2-digit', minute: '2-digit' },
  );

  let label: string;
  let title: string;
  let exhausted = false;

  if (quota.mode === 'local') {
    label = t('briefing.quotaBadgeLocal');
    title = t('briefing.quotaLocal');
  } else if (quota.limit !== null) {
    label = `${quota.used}/${quota.limit}`;
    exhausted = quota.used >= quota.limit;
    title = t('briefing.quotaCompactTitle', {
      used: quota.used,
      limit: quota.limit,
      time: resetTime,
    });
  } else if (tier === 'byok') {
    label = t('briefing.quotaBadgeUnlimited');
    title = t('briefing.quotaUsageByok', { used: quota.used });
  } else {
    label = t('briefing.quotaBadgeUnlimited');
    title = t('briefing.quotaUsageHostedUnlimited', { used: quota.used });
  }

  const className =
    variant === 'toolbar' ? 'ai-quota-chip ai-quota-chip--toolbar btn ghost' : 'ai-quota-chip';

  const inner = (
    <>
      <span className="ai-quota-chip__main">{label}</span>
      {variant === 'inline' && quota.mode === 'cloud' && quota.limit !== null && (
        <span className="ai-quota-chip__sub">{t('briefing.quotaResetAt', { time: resetTime })}</span>
      )}
      {variant === 'inline' && quota.mode === 'local' && (
        <span className="ai-quota-chip__sub">{t('briefing.quotaLocal')}</span>
      )}
      {variant === 'inline' && quota.mode === 'cloud' && quota.limit === null && tier === 'byok' && (
        <span className="ai-quota-chip__sub">{t('briefing.quotaByokSub')}</span>
      )}
    </>
  );

  if (variant === 'toolbar' && onClick) {
    return (
      <button
        type="button"
        className={className}
        data-exhausted={exhausted ? 'true' : undefined}
        title={title}
        onClick={onClick}
        aria-label={title}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={className} data-exhausted={exhausted ? 'true' : undefined} title={title}>
      {inner}
    </div>
  );
}
