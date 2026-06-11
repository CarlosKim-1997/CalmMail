/**
 * Known bulk/marketing sender domains. Used when headers are missing (backfill)
 * or on first observation before recurrence builds a profile.
 */

import type { SenderKind } from '@shared/types';

/** Exact domain or registrable suffix → default kind. */
const DOMAIN_SEEDS: ReadonlyArray<{ pattern: string; kind: SenderKind }> = [
  { pattern: 'jobkorea.co.kr', kind: 'company' },
  { pattern: 'wanted.co.kr', kind: 'company' },
  { pattern: 'saramin.co.kr', kind: 'company' },
  { pattern: 'incruit.com', kind: 'company' },
  { pattern: 'coupang.com', kind: 'company' },
  { pattern: '11st.co.kr', kind: 'company' },
  { pattern: 'gmarket.co.kr', kind: 'company' },
  { pattern: 'musinsa.com', kind: 'company' },
  { pattern: 'cursor.com', kind: 'company' },
  { pattern: 'cursor.sh', kind: 'company' },
  { pattern: 'ollama.com', kind: 'notification' },
  { pattern: 'atlassian.com', kind: 'notification' },
  { pattern: 'github.com', kind: 'notification' },
  { pattern: 'linkedin.com', kind: 'notification' },
  { pattern: 'mailchimp.com', kind: 'company' },
  { pattern: 'sendgrid.net', kind: 'company' },
  { pattern: 'amazonses.com', kind: 'company' },
];

export function seedKindForDomain(domain: string): SenderKind | null {
  const d = domain.toLowerCase().trim();
  if (!d) return null;
  for (const { pattern, kind } of DOMAIN_SEEDS) {
    if (d === pattern || d.endsWith(`.${pattern}`)) return kind;
  }
  return null;
}
