import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { ipc } from '../lib/ipc';
import { useI18n } from '../i18n/useI18n';
import type { ContactMemory } from '@shared/types';

function sortByDisplayLabel(a: ContactMemory, b: ContactMemory): number {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const la = (a.displayName?.trim() || a.email).toLowerCase();
  const lb = (b.displayName?.trim() || b.email).toLowerCase();
  return collator.compare(la, lb);
}

export function VipsScreen() {
  const { t } = useI18n();
  const contacts = useAppStore((s) => s.contacts);
  const refresh = useAppStore((s) => s.refreshMemory);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addVip = async () => {
    setError(null);
    if (!email.trim()) return;
    try {
      await ipc.invoke(ipc.channels.contactUpsert, {
        email: email.trim().toLowerCase(),
        displayName: name.trim() || null,
        isVip: true,
      });
      setEmail('');
      setName('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleVip = async (e: string, currentIsVip: boolean) => {
    setError(null);
    try {
      await ipc.invoke(ipc.channels.contactUpsert, { email: e, isVip: !currentIsVip });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveDisplayName = async (contact: ContactMemory, nextName: string) => {
    const trimmed = nextName.trim();
    const current = (contact.displayName ?? '').trim();
    if (trimmed === current) return;
    setError(null);
    try {
      await ipc.invoke(ipc.channels.contactUpsert, {
        email: contact.email,
        displayName: trimmed || null,
        isVip: true,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const vips = useMemo(
    () => contacts.filter((c) => c.isVip).sort(sortByDisplayLabel),
    [contacts],
  );
  const others = contacts.filter((c) => !c.isVip).slice(0, 30);

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <h1 className="h1">{t('vips.title')}</h1>
      <p className="subtle" style={{ margin: 0 }}>
        {t('vips.lede')}
      </p>
      <p className="subtle" style={{ margin: 0 }}>
        {t('vips.unlimitedNote')}
      </p>
      {error && (
        <p className="subtle" style={{ margin: 0, color: 'var(--prio-high-ink)' }}>
          {error}
        </p>
      )}

      <section className="card stack">
        <h2 className="h2">{t('vips.addSection')}</h2>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>{t('vips.email')}</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>{t('vips.displayName')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Prof. A" />
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <button type="button" className="btn primary" onClick={() => void addVip()}>
              {t('vips.addButton')}
            </button>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">{t('vips.current')}</h2>
        {vips.length === 0 ? (
          <div className="empty">{t('vips.empty')}</div>
        ) : (
          <div className="stack tight">
            {vips.map((c) => (
              <VipRow
                key={c.email}
                contact={c}
                onRemove={() => void toggleVip(c.email, true)}
                onSaveName={(next) => void saveDisplayName(c, next)}
                t={t}
              />
            ))}
          </div>
        )}
      </section>

      {others.length > 0 && (
        <section className="card stack">
          <h2 className="h2">{t('vips.frequent')}</h2>
          <div className="stack tight">
            {others.map((c) => (
              <div key={c.email} className="email-row">
                <div className="top">
                  <span className="from">{c.displayName ?? c.email}</span>
                  <button type="button" className="btn ghost" onClick={() => void toggleVip(c.email, false)}>
                    {t('vips.mark')}
                  </button>
                </div>
                <span className="subtle">
                  {c.email} • {t('vips.importance')} {c.importance}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function VipRow({
  contact,
  onRemove,
  onSaveName,
  t,
}: {
  contact: ContactMemory;
  onRemove: () => void;
  onSaveName: (name: string) => void;
  t: (k: string) => string;
}) {
  const [draftName, setDraftName] = useState(contact.displayName ?? '');

  useEffect(() => {
    setDraftName(contact.displayName ?? '');
  }, [contact.displayName, contact.email]);

  const commitName = () => {
    onSaveName(draftName);
  };

  return (
    <div className="email-row">
      <div className="top" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="field" style={{ flex: 1, minWidth: 160, margin: 0 }}>
          <label>{t('vips.displayName')}</label>
          <input
            value={draftName}
            placeholder={contact.email}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => commitName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
        <button type="button" className="btn ghost" onClick={onRemove} style={{ marginTop: 22 }}>
          {t('vips.remove')}
        </button>
      </div>
      <span className="subtle">{contact.email}</span>
    </div>
  );
}
