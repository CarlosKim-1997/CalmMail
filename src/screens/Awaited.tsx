import { useAppStore } from '../state/appStore';
import { ipc } from '../lib/ipc';
import { formatRelativeTime } from '../lib/format';
import { useI18n } from '../i18n/useI18n';

export function AwaitedScreen() {
  const { t, lang } = useI18n();
  const awaited = useAppStore((s) => s.awaited);
  const monetization = useAppStore((s) => s.monetization);
  const refresh = useAppStore((s) => s.refreshMemory);

  const resolve = async (threadId: string) => {
    await ipc.invoke(ipc.channels.awaitedResolve, { threadId });
    await refresh();
  };

  const waiting = awaited.filter((a) => a.status === 'waiting');
  const past = awaited.filter((a) => a.status !== 'waiting').slice(0, 30);

  const maxAwait = monetization?.freeMaxAwaitedWaitingThreads ?? 5;
  const hasPaid = monetization?.hasPaidFeatures ?? false;

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <h1 className="h1">{t('awaited.title')}</h1>
      <p className="subtle" style={{ margin: 0 }}>
        {t('awaited.lede')}
      </p>
      {!hasPaid && (
        <p className="subtle" style={{ margin: 0 }}>
          {t('limits.awaitedHint', { max: maxAwait })}
        </p>
      )}

      <section className="card stack">
        <h2 className="h2">{t('awaited.waiting')}</h2>
        {waiting.length === 0 ? (
          <div className="empty">{t('awaited.emptyWaiting')}</div>
        ) : (
          <div className="stack tight">
            {waiting.map((a) => (
              <div key={a.threadId} className="email-row">
                <div className="top">
                  <span className="from">{a.contact}</span>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="meta">
                      {t('awaited.sent')} {formatRelativeTime(a.sentAt, lang)}
                    </span>
                    <button className="btn ghost" onClick={() => void resolve(a.threadId)}>
                      {t('awaited.resolve')}
                    </button>
                  </div>
                </div>
                <span className="subject">{a.subject}</span>
                <span className="meta">{labelReason(a.reason, t)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="card stack">
          <h2 className="h2">{t('awaited.closed')}</h2>
          <div className="stack tight">
            {past.map((a) => (
              <div key={a.threadId} className="email-row">
                <div className="top">
                  <span className="from">{a.contact}</span>
                  <span className={`badge ${a.status === 'received' ? 'low' : 'medium'}`}>
                    {t(`awaited.status.${a.status}`)}
                  </span>
                </div>
                <span className="subject">{a.subject}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function labelReason(
  r: 'user_marked' | 'ai_proposed' | 'auto_inferred',
  t: (k: string) => string,
): string {
  switch (r) {
    case 'user_marked':
      return t('awaited.reason.user');
    case 'ai_proposed':
      return t('awaited.reason.ai');
    case 'auto_inferred':
      return t('awaited.reason.auto');
  }
}
