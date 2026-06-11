import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { formatRelativeTime, senderLabel } from '../lib/format';
import type {
  AppLanguage,
  CategorySuggestion,
  VipSuggestion,
  EmailCategory,
  EmailSummary,
  NotificationPriority,
} from '@shared/types';
import { MailProcessPreflight } from '../components/MailProcessPreflight';
import { QuietSponsorCard } from '../components/QuietSponsorCard';
import { useI18n } from '../i18n/useI18n';
import { getLocalBriefingBlock } from '../lib/localAiBriefingGate';
import { ipc } from '../lib/ipc';
import type { LocalAiManagedStatus } from '@shared/types';

export function HomeScreen() {
  const { t, lang } = useI18n();
  const important = useAppStore((s) => s.important);
  const nonImportant = useAppStore((s) => s.nonImportant);
  const awaited = useAppStore((s) => s.awaited);
  const notifications = useAppStore((s) => s.notifications);
  const briefing = useAppStore((s) => s.briefing);
  const prefs = useAppStore((s) => s.preferences);
  const authStatus = useAppStore((s) => s.authStatus);
  const recent = useAppStore((s) => s.recent);
  const busy = useAppStore((s) => s.busy);
  const inboxSync = useAppStore((s) => s.inboxSync);
  const runPoll = useAppStore((s) => s.runPollNow);
  const refreshInboxSync = useAppStore((s) => s.refreshInboxSync);
  const goto = useAppStore((s) => s.goto);
  const generateBriefing = useAppStore((s) => s.generateBriefing);
  const aiQuota = useAppStore((s) => s.aiQuota);
  const monetization = useAppStore((s) => s.monetization);
  const suggestions = useAppStore((s) => s.categorySuggestions);
  const vipSuggestions = useAppStore((s) => s.vipSuggestions);
  const openInGmail = useAppStore((s) => s.openEmailInGmail);
  const resolveSuggestion = useAppStore((s) => s.resolveCategorySuggestion);
  const resolveVipSuggestion = useAppStore((s) => s.resolveVipSuggestion);

  const [managedStatus, setManagedStatus] = useState<LocalAiManagedStatus | null>(null);

  useEffect(() => {
    if (prefs?.aiMode !== 'local' || prefs.localAiPreferredRuntime !== 'managed') {
      setManagedStatus(null);
      return;
    }
    void ipc.invoke(ipc.channels.localAiManagedStatus).then(setManagedStatus);
  }, [
    prefs?.aiMode,
    prefs?.localAiPreferredRuntime,
    prefs?.localAiModelId,
    prefs?.localAiAcceptedNotices,
  ]);

  const aiOff = prefs?.aiMode === 'off';
  const localBlock = getLocalBriefingBlock(prefs, managedStatus);
  const exhausted =
    aiQuota?.mode === 'cloud' &&
    aiQuota.limit !== null &&
    aiQuota.used >= aiQuota.limit;
  const canStartMailProcess =
    !briefing && !busy.briefing && !aiOff && !localBlock && !exhausted;

  const handleMailProcess = () => {
    goto('briefing');
    if (canStartMailProcess) {
      void generateBriefing();
    }
  };
  const awaitedWaiting = awaited.filter((a) => a.status === 'waiting');
  const importantByCategory = groupByCategory(important);
  const topImportant = important.slice(0, 5);
  const autoSyncOnce = useRef(false);

  const syncing =
    busy.poll || inboxSync?.phase === 'syncing';
  const cachedCount = inboxSync?.cachedMessageCount ?? recent.length;

  useEffect(() => {
    void refreshInboxSync();
  }, [refreshInboxSync]);

  useEffect(() => {
    if (!authStatus?.gmailConnected) return;
    if (autoSyncOnce.current) return;
    if (cachedCount > 0 || syncing) return;
    autoSyncOnce.current = true;
    void runPoll();
  }, [authStatus?.gmailConnected, cachedCount, syncing, runPoll]);

  const syncStatusLine = (() => {
    if (syncing) {
      return t('home.syncInProgress');
    }
    if (lastSyncAt(inboxSync)) {
      const time = formatRelativeTime(inboxSync!.lastSyncAt!, lang);
      if (inboxSync!.lastNewClassified > 0) {
        return t('home.syncLastWithNew', {
          time,
          n: inboxSync!.lastNewClassified,
        });
      }
      return t('home.syncLast', { time });
    }
    if (authStatus?.gmailConnected) {
      return t('home.syncNever');
    }
    return null;
  })();

  return (
    <div className="home-shell">
      <header className="home-hero card">
        <div className="home-hero__copy">
          <p className="home-hero__eyebrow">{t('home.eyebrow')}</p>
          <h1 className="h1" style={{ margin: 0 }}>
            {t('home.title')}
          </h1>
          <p className="subtle" style={{ margin: 0 }}>
            {briefing
              ? t('home.lastBriefing', {
                  time: formatRelativeTime(briefing.generatedAt, lang),
                })
              : t('home.noBriefingYet')}
          </p>
          {syncStatusLine && (
            <p className="subtle home-sync-line" style={{ margin: 0 }}>
              {syncing && <span className="home-sync-line__dot" aria-hidden />}
              {syncStatusLine}
            </p>
          )}
        </div>
        <div className="home-hero__actions">
          <button className="btn ghost" disabled={syncing} onClick={() => void runPoll()}>
            {syncing ? t('home.checking') : t('home.checkInbox')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={handleMailProcess}
            aria-busy={busy.briefing}
          >
            {busy.briefing
              ? t('mailProcess.generating')
              : briefing
                ? t('mailProcess.viewResults')
                : t('mailProcess.start')}
          </button>
        </div>
      </header>

      {authStatus?.gmailConnected && prefs && !aiOff && !busy.briefing && (
        <MailProcessPreflight prefs={prefs} t={t} compact />
      )}

      {authStatus?.gmailConnected && cachedCount === 0 && !syncing && (
        <div className="card home-sync-hint">
          <p className="subtle" style={{ margin: 0 }}>
            {t('home.syncEmptyHint')}
          </p>
        </div>
      )}

      {(monetization?.effectiveTier === 'free' && prefs?.aiMode === 'cloud') ||
      aiOff ||
      localBlock ? (
        <div className="home-nudge-row">
          {monetization?.effectiveTier === 'free' && prefs?.aiMode === 'cloud' && (
            <button type="button" className="home-nudge" onClick={() => goto('plans')}>
              <span>
                {t('home.planHintFree', {
                  n: monetization.freeMaxCloudBriefingsPerDay ?? 2,
                })}
              </span>
              <span className="home-nudge__cta">{t('settings.openPlans')}</span>
            </button>
          )}
          {aiOff && (
            <button type="button" className="home-nudge" onClick={() => goto('ai-mode')}>
              <span>{t('home.nudgeAiOff')}</span>
              <span className="home-nudge__cta">{t('home.chooseAiMode')}</span>
            </button>
          )}
          {localBlock && !aiOff && (
            <button type="button" className="home-nudge" onClick={() => goto('local-ai')}>
              <span>{t('home.nudgeLocalSetup')}</span>
              <span className="home-nudge__cta">{t('home.openLocalAi')}</span>
            </button>
          )}
        </div>
      ) : null}

      <div className="home-stats">
        <button type="button" className="home-stat" onClick={() => goto('briefing')}>
          <span className="home-stat__value">{important.length}</span>
          <span className="home-stat__label">{t('home.statImportant')}</span>
        </button>
        <button type="button" className="home-stat" onClick={() => goto('awaited')}>
          <span className="home-stat__value">{awaitedWaiting.length}</span>
          <span className="home-stat__label">{t('home.statAwaited')}</span>
        </button>
        <div className="home-stat home-stat--static">
          <span className="home-stat__value">{notifications.length}</span>
          <span className="home-stat__label">{t('home.statAlerts')}</span>
        </div>
      </div>

      <div className="home-grid">
        <section className="home-panel card">
          <div className="home-panel__head">
            <h2 className="h2" style={{ margin: 0 }}>
              {t('home.important')}
            </h2>
            <button type="button" className="btn ghost" onClick={() => goto('briefing')}>
              {t('home.seeBriefing')}
            </button>
          </div>
          {important.length === 0 ? (
            <div className="empty">{t('home.emptyImportant')}</div>
          ) : (
            <div className="home-panel__body">
              {topImportant.map((e) => (
                <EmailRow
                  key={e.id}
                  email={e}
                  lang={lang}
                  t={t}
                  onClick={() => void openInGmail(e)}
                />
              ))}
              {importantByCategory.length > 1 && (
                <div className="home-category-chips">
                  {importantByCategory.map(([cat, items]) => (
                    <span key={cat} className="badge low">
                      {t(`emailCategory.${cat}`)} · {items.length}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="home-panel card">
          <div className="home-panel__head">
            <h2 className="h2" style={{ margin: 0 }}>
              {t('home.awaited')}
            </h2>
            <button type="button" className="btn ghost" onClick={() => goto('awaited')}>
              {t('home.seeAll')}
            </button>
          </div>
          {awaitedWaiting.length === 0 ? (
            <div className="empty">{t('home.emptyAwaited')}</div>
          ) : (
            <div className="home-panel__body stack tight">
              {awaitedWaiting.slice(0, 4).map((a) => (
                <div key={a.threadId} className="email-row">
                  <div className="top">
                    <span className="from">{a.contact}</span>
                    <span className="meta">{formatRelativeTime(a.sentAt, lang)}</span>
                  </div>
                  <span className="subject">{a.subject}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="home-panel card">
          <div className="home-panel__head">
            <h2 className="h2" style={{ margin: 0 }}>
              {t('home.alerts')}
            </h2>
          </div>
          {notifications.length === 0 ? (
            <div className="empty">{t('home.emptyAlerts')}</div>
          ) : (
            <div className="home-panel__body stack tight">
              {notifications.slice(0, 4).map((n) => (
                <div key={n.id} className="email-row">
                  <div className="top">
                    <span className="from">{n.title}</span>
                    <span className={`badge ${priorityClass(n.priority)}`}>
                      {t(`priority.${n.priority}`)}
                    </span>
                  </div>
                  <span className="subject">{n.body}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="home-panel card home-panel--wide">
          {(vipSuggestions.length > 0 || suggestions.length > 0) && (
            <div className="home-suggestions">
              {vipSuggestions.length > 0 && (
                <div className="stack" style={{ gap: 'var(--s-3)' }}>
                  <h2 className="h2" style={{ margin: 0 }}>
                    {t('home.vipSuggestions.title')}
                  </h2>
                  {vipSuggestions.slice(0, 2).map((s) => (
                    <VipSuggestionRow
                      key={s.id}
                      s={s}
                      t={t}
                      onResolve={(r) => void resolveVipSuggestion(s.id, r)}
                    />
                  ))}
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="stack" style={{ gap: 'var(--s-3)' }}>
                  <h2 className="h2" style={{ margin: 0 }}>
                    {t('home.suggestions.title')}
                  </h2>
                  {suggestions.slice(0, 2).map((s) => (
                    <SuggestionRow
                      key={s.id}
                      s={s}
                      t={t}
                      onResolve={(r) => void resolveSuggestion(s.id, r)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="home-panel__head">
            <h2 className="h2" style={{ margin: 0 }}>
              {t('home.nonImportant')}
            </h2>
            <span className="subtle">{nonImportant.length}</span>
          </div>
          <p className="subtle" style={{ margin: 0 }}>
            {t('home.nonImportantHint')}
          </p>
          {nonImportant.length === 0 ? (
            <div className="empty">{t('home.emptyNonImportant')}</div>
          ) : (
            <div className="home-low-signal-list">
              {nonImportant.slice(0, 8).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="home-low-signal-item"
                  onClick={() => void openInGmail(e)}
                >
                  <span className="from">{senderLabel(e.from)}</span>
                  <span className="subject">{e.subject}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <QuietSponsorCard placement="dashboard" />
    </div>
  );
}

function groupByCategory(
  emails: EmailSummary[],
): Array<[EmailCategory, EmailSummary[]]> {
  const map = new Map<EmailCategory, EmailSummary[]>();
  for (const e of emails) {
    const key = e.category ?? 'personal';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  const order: EmailCategory[] = [
    'personal',
    'work',
    'transactional',
    'notification',
    'social',
    'newsletter',
    'promotion',
    'other',
  ];
  return order
    .filter((c) => map.has(c))
    .map((c) => [c, map.get(c)!] as [EmailCategory, EmailSummary[]]);
}

function VipSuggestionRow({
  s,
  t,
  onResolve,
}: {
  s: VipSuggestion;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onResolve: (r: 'promoted_vip' | 'kept' | 'dismissed') => void;
}) {
  const label = s.displayName ? `${s.displayName} <${s.contactEmail}>` : s.contactEmail;
  return (
    <div className="suggestion-row">
      <div className="stack tight" style={{ flex: 1 }}>
        <strong>{label}</strong>
        <span className="subtle">
          {t('home.vipSuggestions.body', { n: s.awaitedCount })}
        </span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button type="button" className="btn primary" onClick={() => onResolve('promoted_vip')}>
          {t('home.vipSuggestions.promote')}
        </button>
        <button type="button" className="btn" onClick={() => onResolve('kept')}>
          {t('home.vipSuggestions.keep')}
        </button>
        <button type="button" className="btn ghost" onClick={() => onResolve('dismissed')}>
          {t('home.suggestions.dismiss')}
        </button>
      </div>
    </div>
  );
}

function SuggestionRow({
  s,
  t,
  onResolve,
}: {
  s: CategorySuggestion;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onResolve: (r: 'promoted_vip' | 'kept' | 'dismissed') => void;
}) {
  const senderLabelText = s.senderName ? `${s.senderName} <${s.senderEmail}>` : s.senderEmail;
  return (
    <div className="suggestion-row">
      <div className="stack tight" style={{ flex: 1 }}>
        <strong>{senderLabelText}</strong>
        <span className="subtle">
          {t('home.suggestions.body', {
            n: s.openCount,
            category: t(`emailCategory.${s.category}`),
          })}
        </span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button type="button" className="btn primary" onClick={() => onResolve('promoted_vip')}>
          {t('home.suggestions.promote')}
        </button>
        <button type="button" className="btn" onClick={() => onResolve('kept')}>
          {t('home.suggestions.keep')}
        </button>
        <button type="button" className="btn ghost" onClick={() => onResolve('dismissed')}>
          {t('home.suggestions.dismiss')}
        </button>
      </div>
    </div>
  );
}

function EmailRow({
  email,
  lang,
  t,
  onClick,
}: {
  email: EmailSummary;
  lang: AppLanguage;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      className={`email-row${clickable ? ' clickable' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="top">
        <span className="from">{senderLabel(email.from)}</span>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${priorityClass(email.priority)}`}>
            {t(`priority.${email.priority}`)}
          </span>
          <span className="meta">{formatRelativeTime(email.receivedAt, lang)}</span>
        </div>
      </div>
      <span className="subject">{email.subject}</span>
      {email.snippet && <span className="snippet">{email.snippet}</span>}
    </div>
  );
}

function priorityClass(p: NotificationPriority): string {
  return p === 'HIGH' ? 'high' : p === 'MEDIUM' ? 'medium' : 'low';
}

function lastSyncAt(sync: { lastSyncAt: number | null } | null): boolean {
  return sync?.lastSyncAt != null && sync.lastSyncAt > 0;
}
