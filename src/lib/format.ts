import type { AppLanguage } from '@shared/types';
import { DICT } from '../i18n/dictionaries';

function pick(lang: AppLanguage, key: string): string {
  return DICT[lang][key] ?? DICT.en[key] ?? DICT.ko[key] ?? key;
}

function interpolate(template: string, n: number): string {
  return template.replace(/\{n\}/g, String(n));
}

export function formatRelativeTime(ms: number, lang: AppLanguage, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return pick(lang, 'time.justNow');
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return interpolate(pick(lang, 'time.minAgo'), minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return interpolate(pick(lang, 'time.hrAgo'), hours);
  const days = Math.floor(hours / 24);
  if (days < 7) return interpolate(pick(lang, 'time.dayAgo'), days);
  const date = new Date(ms);
  return date.toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US');
}

export function senderLabel(opts: { name: string | null; email: string }): string {
  if (opts.name && opts.name.trim().length > 0) return opts.name.trim();
  return opts.email;
}
