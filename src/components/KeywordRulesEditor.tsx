import { useMemo, useState } from 'react';
import type { PriorityKeywordRule } from '@shared/types';

/**
 * Simple keyword list editor.
 *
 * Product choice: users should only manage "which words matter".
 * We keep matching options internal defaults.
 */
export function KeywordRulesEditor({
  rules,
  onChange,
  t,
}: {
  rules: PriorityKeywordRule[];
  onChange: (next: PriorityKeywordRule[]) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const [draftPattern, setDraftPattern] = useState('');
  const now = Date.now();
  const recentWindowMs = 24 * 60 * 60 * 1000;

  const normalizedSet = useMemo(
    () => new Set(rules.map((r) => normalizeKeyword(r.pattern))),
    [rules],
  );

  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));

  const add = () => {
    const pattern = draftPattern.trim();
    if (!pattern) return;
    const normalized = normalizeKeyword(pattern);
    if (!normalized || normalizedSet.has(normalized)) {
      setDraftPattern('');
      return;
    }

    const looksEnglish = /[A-Za-z]/.test(pattern) && !/[\u3131-\uD79D]/.test(pattern);
    onChange([
      ...rules,
      {
        id: 'kw_' + Math.random().toString(36).slice(2, 10),
        createdAt: Date.now(),
        pattern,
        matchType: 'contains', // hidden advanced default
        language: looksEnglish ? 'en' : 'any',
        caseSensitive: false,
        weight: 'medium', // hidden advanced default
        enabled: true,
      },
    ]);
    setDraftPattern('');
  };

  const sortedRules = useMemo(() => {
    const collator = new Intl.Collator(undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    return [...rules].sort((a, b) => collator.compare(a.pattern, b.pattern));
  }, [rules]);

  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }}>
      <p className="subtle" style={{ margin: 0 }}>
        {t('settings.kw.intro')}
      </p>

      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 220px', margin: 0 }}>
          <input
            value={draftPattern}
            placeholder={t('settings.kw.placeholder')}
            onChange={(e) => setDraftPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <button type="button" className="btn primary" onClick={add} disabled={!draftPattern.trim()}>
          {t('settings.kw.add')}
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="empty">{t('settings.kw.empty')}</div>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {sortedRules.map((r) => (
            <KeywordChip
              key={r.id}
              rule={r}
              isRecent={r.createdAt > 0 && now - r.createdAt <= recentWindowMs}
              onDelete={remove}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KeywordChip({
  rule,
  isRecent,
  onDelete,
  t,
}: {
  rule: PriorityKeywordRule;
  isRecent: boolean;
  onDelete: (id: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="kw-rule" data-recent={isRecent ? 'true' : undefined}>
      <span style={{ fontWeight: 600 }}>{rule.pattern}</span>
      {isRecent && (
        <span className="badge medium" style={{ fontSize: 11 }}>
          {t('settings.kw.recent')}
        </span>
      )}
      <button
        type="button"
        className="btn ghost"
        onClick={() => onDelete(rule.id)}
        title={t('settings.kw.delete')}
      >
        {t('settings.kw.delete')}
      </button>
    </div>
  );
}

function normalizeKeyword(s: string): string {
  return s.trim().toLowerCase();
}
