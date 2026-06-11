import type { AppLanguage, HardwareCapability } from '@shared/types';
import { formatRelativeTime } from '../lib/format';

export function HardwareVerdict({
  hw,
  analyzedAt,
  lang,
  t,
}: {
  hw: HardwareCapability;
  analyzedAt: number;
  lang: AppLanguage;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const cls =
    hw.verdict === 'comfortable' ? 'low' : hw.verdict === 'limited' ? 'medium' : 'high';

  return (
    <div className="stack tight">
      <span className={`badge ${cls}`} style={{ alignSelf: 'flex-start' }}>
        {t(`hardware.verdict.${hw.verdict}`)}
      </span>
      <span>{t(`hardware.detail.${hw.verdict}`)}</span>
      <span className="subtle">
        {t('capability.hwSpec', {
          brand: hw.cpuBrand,
          cores: hw.cpuCores,
          ram: hw.totalRamGb,
          gpu:
            hw.hasGpu && hw.gpuVramGb != null
              ? t('capability.gpuSuffix', { v: hw.gpuVramGb })
              : '',
        })}
      </span>
      <span className="subtle" style={{ fontSize: '0.9em' }}>
        {t('localAi.capability.lastChecked', {
          time: formatRelativeTime(analyzedAt, lang),
        })}
      </span>
    </div>
  );
}
