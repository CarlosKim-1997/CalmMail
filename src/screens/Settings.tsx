import { useState } from 'react';
import { useAppStore } from '../state/appStore';
import { settingsPlanActiveKey } from '../lib/planTier';
import type {
  NotificationSensitivity,
  PriorityKeywordRule,
  UserPreferences,
} from '@shared/types';
import type { TriageWindowDays } from '@shared/triage';
import { useI18n } from '../i18n/useI18n';
import { QuietSponsorCard } from '../components/QuietSponsorCard';
import { KeywordRulesEditor } from '../components/KeywordRulesEditor';
import { ipc } from '../lib/ipc';

export function SettingsScreen() {
  const { t } = useI18n();
  const prefs = useAppStore((s) => s.preferences);
  const monetization = useAppStore((s) => s.monetization);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const auth = useAppStore((s) => s.authStatus);
  const disconnect = useAppStore((s) => s.disconnectGmail);
  const requestModifyScope = useAppStore((s) => s.requestGmailModifyScope);
  const goto = useAppStore((s) => s.goto);
  const [modifyBusy, setModifyBusy] = useState(false);
  const [modifyError, setModifyError] = useState<string | null>(null);

  if (!prefs) return <div className="empty">{t('common.loading')}</div>;

  const isLocalAi = prefs.aiMode === 'local';
  const triageDaysOptions: TriageWindowDays[] = isLocalAi ? [7] : [7, 14];
  const gmailMarkReadReady =
    (auth?.gmailModifyScopeGranted ?? false) && prefs.triageGmailMarkReadEnabled;

  const hasPaid = monetization?.hasPaidFeatures ?? false;
  const tier = monetization?.effectiveTier ?? 'free';
  const pollMin = hasPaid ? 1 : (monetization?.freeMinMonitoringIntervalMinutes ?? 10);

  const update = (patch: Partial<UserPreferences>) => void setPrefs(patch);

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <h1 className="h1">{t('settings.title')}</h1>

      <section className="card stack">
        <h2 className="h2">{t('settings.language')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className={`btn ${prefs.language === 'ko' ? 'primary' : ''}`}
            onClick={() => update({ language: 'ko' })}
          >
            {t('settings.languageKo')}
          </button>
          <button
            type="button"
            className={`btn ${prefs.language === 'en' ? 'primary' : ''}`}
            onClick={() => update({ language: 'en' })}
          >
            {t('settings.languageEn')}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">{t('settings.quietHours')}</h2>
        <p className="subtle">{t('settings.quietHoursHint')}</p>
        <div className="row" style={{ gap: 12 }}>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={prefs.quietHours.enabled}
              onChange={(e) =>
                update({ quietHours: { ...prefs.quietHours, enabled: e.target.checked } })
              }
            />
            <span>{t('settings.enable')}</span>
          </label>
          <div className="field" style={{ width: 110 }}>
            <label>{t('settings.from')}</label>
            <input
              type="number" min={0} max={23}
              value={prefs.quietHours.startHour}
              onChange={(e) =>
                update({
                  quietHours: { ...prefs.quietHours, startHour: parseInt(e.target.value || '0', 10) },
                })
              }
            />
          </div>
          <div className="field" style={{ width: 110 }}>
            <label>{t('settings.to')}</label>
            <input
              type="number" min={0} max={23}
              value={prefs.quietHours.endHour}
              onChange={(e) =>
                update({
                  quietHours: { ...prefs.quietHours, endHour: parseInt(e.target.value || '0', 10) },
                })
              }
            />
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">{t('settings.notifSens')}</h2>
        <div className="row" style={{ gap: 8 }}>
          {(['minimal', 'balanced', 'strict'] as NotificationSensitivity[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn ${prefs.notificationSensitivity === s ? 'primary' : ''}`}
              onClick={() => update({ notificationSensitivity: s })}
            >
              {t(`settings.sens.${s}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">{t('settings.kw.title')}</h2>
        <KeywordRulesEditor
          rules={prefs.priorityKeywordRules}
          onChange={(next: PriorityKeywordRule[]) =>
            update({ priorityKeywordRules: next })
          }
          t={t}
        />
      </section>

      <section className="card stack">
        <h2 className="h2">{t('settings.triage.title')}</h2>
        <p className="subtle" style={{ margin: 0 }}>
          {t('settings.triage.lede')}
        </p>
        {isLocalAi && (
          <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
            {t('settings.triage.localMaxHint')}
          </p>
        )}
        <div className="stack tight">
          <span className="subtle" style={{ fontWeight: 600 }}>
            {t('settings.triage.windowDays')}
          </span>
          <div className="row" style={{ gap: 8 }}>
            {triageDaysOptions.map((days) => (
              <button
                key={days}
                type="button"
                className={`btn ${prefs.triageWindowDays === days ? 'primary' : ''}`}
                onClick={() => update({ triageWindowDays: days })}
              >
                {t('settings.triage.windowDaysOption', { days })}
              </button>
            ))}
          </div>
          <span className="subtle" style={{ fontSize: 12 }}>
            {isLocalAi
              ? t('settings.triage.windowDaysLocalOnly')
              : t('settings.triage.windowDaysHint')}
          </span>
        </div>
        <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={prefs.triageCollapseLater}
            onChange={(e) => update({ triageCollapseLater: e.target.checked })}
          />
          <span className="stack tight">
            <span>{t('settings.triage.collapseLater')}</span>
            <span className="subtle" style={{ fontSize: 12 }}>
              {t('settings.triage.collapseLaterHint')}
            </span>
          </span>
        </label>
        <div className="stack tight">
          <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={prefs.triageGmailMarkReadEnabled}
              disabled={!auth?.gmailConnected}
              onChange={(e) => update({ triageGmailMarkReadEnabled: e.target.checked })}
            />
            <span className="stack tight">
              <span>{t('settings.triage.gmailMarkRead')}</span>
              <span className="subtle" style={{ fontSize: 12 }}>
                {t('settings.triage.gmailMarkReadHint')}
              </span>
            </span>
          </label>
          {prefs.triageGmailMarkReadEnabled && auth?.gmailConnected && (
            <div className="stack tight">
              {gmailMarkReadReady ? (
                <span className="subtle" style={{ fontSize: 12, color: 'var(--accent-ink)' }}>
                  {t('settings.triage.gmailMarkReadGranted')}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={modifyBusy}
                    onClick={() => {
                      setModifyError(null);
                      setModifyBusy(true);
                      void requestModifyScope()
                        .catch((err: unknown) => {
                          setModifyError(
                            err instanceof Error ? err.message : String(err),
                          );
                        })
                        .finally(() => setModifyBusy(false));
                    }}
                  >
                    {modifyBusy
                      ? t('settings.triage.gmailMarkReadGranting')
                      : t('settings.triage.gmailMarkReadGrant')}
                  </button>
                  {modifyError && (
                    <span className="subtle" style={{ fontSize: 12, color: 'var(--prio-high-ink)' }}>
                      {modifyError}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">{t('settings.monitoring')}</h2>
        {!hasPaid && (
          <p className="subtle" style={{ margin: 0 }}>
            {t('settings.monitoringFreeNote', {
              min: monetization?.freeMinMonitoringIntervalMinutes ?? 10,
            })}
          </p>
        )}
        <div className="row" style={{ gap: 16 }}>
          <div className="field" style={{ width: 220 }}>
            <label>{t('settings.everyMinutes')}</label>
            <input
              type="number"
              min={pollMin}
              max={120}
              value={prefs.monitoringIntervalMinutes}
              onChange={(e) =>
                update({ monitoringIntervalMinutes: parseInt(e.target.value || String(pollMin), 10) })
              }
            />
          </div>
          <div className="field" style={{ width: 220 }}>
            <label>{t('settings.retainDays')}</label>
            <input
              type="number" min={1} max={90}
              value={prefs.retainEmailMetadataDays}
              onChange={(e) =>
                update({ retainEmailMetadataDays: parseInt(e.target.value || '14', 10) })
              }
            />
          </div>
        </div>
        <span className="subtle">{t('settings.retainHint')}</span>
      </section>

      <section className="card stack">
        <h2 className="h2">{t('settings.plans')}</h2>
        <p className="subtle" style={{ margin: 0 }}>
          {hasPaid
            ? t(settingsPlanActiveKey(tier))
            : t('settings.premiumInactive', {
                cloud: monetization?.freeMaxCloudBriefingsPerDay ?? 2,
                poll: monetization?.freeMinMonitoringIntervalMinutes ?? 10,
                awaited: monetization?.freeMaxAwaitedWaitingThreads ?? 5,
                briefFree: monetization?.freeBriefingImportantCap ?? 10,
                briefPremium: monetization?.premiumBriefingImportantCap ?? 22,
              })}
        </p>
        {monetization?.devPremiumBypass && (
          <p className="subtle" style={{ margin: 0, color: 'var(--ink-tertiary)' }}>
            {t('settings.premiumDevNote')}
          </p>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={() => goto('plans')}>
            {t('settings.openPlans')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void ipc.invoke(ipc.channels.premiumLearnMore)}
          >
            {t('settings.premiumLearnMore')}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">{t('settings.account')}</h2>
        {auth?.gmailConnected ? (
          <div className="stack" style={{ gap: 'var(--s-4)' }}>
            <div className="row between">
              <div className="stack tight">
                <strong>
                  {auth.gmailReconnectNeeded
                    ? t('settings.gmailReconnectNeeded')
                    : t('settings.gmailConnected')}
                </strong>
                <span className="subtle">{auth.gmailEmail}</span>
              </div>
              <button type="button" className="btn" onClick={() => void disconnect()}>
                {t('settings.disconnect')}
              </button>
            </div>
            {auth.gmailReconnectNeeded && (
              <p className="subtle" style={{ margin: 0 }}>
                {t('settings.gmailReconnectHint')}
              </p>
            )}
          </div>
        ) : (
          <span className="subtle">{t('settings.notConnected')}</span>
        )}
      </section>

      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="subtle" style={{ fontSize: 12 }}>
          {t('settings.sponsorFooter')}
        </span>
        <QuietSponsorCard placement="settings" />
      </div>
    </div>
  );
}
