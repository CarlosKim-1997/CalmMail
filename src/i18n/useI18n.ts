import { useCallback } from 'react';
import type { AppLanguage } from '@shared/types';
import { useAppStore } from '../state/appStore';
import { DICT } from './dictionaries';

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] != null ? String(vars[k]) : `{${k}}`,
  );
}

export function useI18n() {
  const lang = (useAppStore((s) => s.preferences?.language) ?? 'ko') as AppLanguage;
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const raw = DICT[lang][key] ?? DICT.en[key] ?? DICT.ko[key] ?? key;
      return interpolate(raw, vars);
    },
    [lang],
  );
  return { t, lang };
}
