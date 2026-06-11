import { useEffect, useMemo, useState } from 'react';
import {
  buildInspectionClusterHint,
  buildTriageScopeReasoning,
} from '@shared/briefingReasoning';
import { useAppStore } from '../state/appStore';
import { formatRelativeTime } from '../lib/format';
import { useI18n } from '../i18n/useI18n';
import { briefingErrorMessageKey } from '../lib/briefingErrors';
import { getLocalBriefingBlock } from '../lib/localAiBriefingGate';
import { ipc } from '../lib/ipc';
import type { LocalAiManagedStatus } from '@shared/types';
import { AiQuotaChip } from '../components/AiQuotaChip';
import { BriefingProgressPanel } from '../components/BriefingProgressPanel';
import { GenerateBriefingButton } from '../components/GenerateBriefingButton';
import { MailProcessPreflight } from '../components/MailProcessPreflight';
import { MailProcessResults } from '../components/MailProcessResults';
import { MailProcessResultsSpinner } from '../components/MailProcessResultsSpinner';
import { UpgradeQuotaModal } from '../components/UpgradeQuotaModal';
import {
  TriageGroupsPanel,
  buildEmailById,
  triageItemToEmailSummary,
} from '../components/TriageGroupsPanel';

export function BriefingScreen() {
  const { t, lang } = useI18n();
  const briefing = useAppStore((s) => s.briefing);
  const prefs = useAppStore((s) => s.preferences);
  const busy = useAppStore((s) => s.busy);
  const briefingError = useAppStore((s) => s.briefingError);
  const briefingProgress = useAppStore((s) => s.briefingProgress);
  const aiQuota = useAppStore((s) => s.aiQuota);
  const generate = useAppStore((s) => s.generateBriefing);
  const clearBriefingError = useAppStore((s) => s.clearBriefingError);
  const refreshAiQuota = useAppStore((s) => s.refreshAiQuota);
  const goto = useAppStore((s) => s.goto);
  const monetization = useAppStore((s) => s.monetization);
  const important = useAppStore((s) => s.important);
  const recent = useAppStore((s) => s.recent);
  const nonImportant = useAppStore((s) => s.nonImportant);
  const openInGmail = useAppStore((s) => s.openEmailInGmail);
  const refreshTriageState = useAppStore((s) => s.refreshTriageState);
  const dismissTriageEmails = useAppStore((s) => s.dismissTriageEmails);
  const refreshInbox = useAppStore((s) => s.refreshInbox);
  const authStatus = useAppStore((s) => s.authStatus);

  useEffect(() => {
    void refreshAiQuota();
  }, [refreshAiQuota]);

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

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const limitFromError = useMemo(() => {
    if (!briefingError?.startsWith('CALMMAIL_CLOUD_BRIEFING_LIMIT:')) return null;
    const [, resetAtRaw, limitRaw] = briefingError.split(':');
    const resetAt = Number(resetAtRaw);
    const limit = Number(limitRaw);
    return {
      resetAt: Number.isFinite(resetAt) ? resetAt : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    };
  }, [briefingError]);

  useEffect(() => {
    if (limitFromError) setUpgradeOpen(true);
  }, [limitFromError]);

  const emailById = useMemo(
    () => buildEmailById([...important, ...recent, ...nonImportant]),
    [important, recent, nonImportant],
  );

  const triageEmailIds = useMemo(() => {
    if (!briefing?.triage) return [] as string[];
    const ids = new Set<string>();
    for (const g of ['now', 'today', 'later'] as const) {
      for (const item of briefing.triage[g] ?? []) {
        ids.add(item.emailId);
      }
    }
    return [...ids];
  }, [briefing?.triage]);

  useEffect(() => {
    if (!briefing?.triage) return;
    void refreshInbox().then(() =>
      refreshTriageState(triageEmailIds.length > 0 ? triageEmailIds : undefined),
    );
  }, [briefing?.generatedAt, briefing?.triage, refreshInbox, refreshTriageState, triageEmailIds]);

  const [dismissBusy, setDismissBusy] = useState(false);

  const displayReasoning = useMemo(() => {
    if (!briefing) return '';
    if (briefing.triage) {
      const clusterSnippet = buildInspectionClusterHint(briefing.inspected?.clusters, lang);
      return buildTriageScopeReasoning({
        lang,
        scope: briefing.triage.scope,
        highlightCount: briefing.highlights.length,
        awaitedTracked: briefing.inspected?.awaitedTracked ?? 0,
        clusterSnippet,
      });
    }
    return briefing.reasoning;
  }, [briefing, lang]);

  const errorDisplay = (() => {
    if (!briefingError) return null;
    const mapped = briefingErrorMessageKey(briefingError);
    if (mapped) return t(mapped.key, mapped.vars);
    return briefingError;
  })();

  return (
    <div className="briefing-page stack" style={{ gap: 'var(--s-6)' }}>
      <header className="briefing-top stack tight">
        <div className="briefing-top__toolbar">
          <AiQuotaChip
            quota={aiQuota}
            tier={monetization?.effectiveTier}
            lang={lang}
            t={t}
            variant="toolbar"
            onClick={exhausted ? () => setUpgradeOpen(true) : undefined}
          />
        </div>
        <div className="briefing-header">
          <div className="briefing-header__copy stack tight">
            <h1 className="h1">{t('briefing.title')}</h1>
            <span className="subtle">
              {briefing
                ? t('briefing.subtitleWithProvider', {
                    time: formatRelativeTime(briefing.generatedAt, lang),
                    provider: briefing.generatedBy,
                  })
                : t('briefing.subtitleIdle')}
            </span>
            <p className="subtle briefing-role-hint" style={{ margin: 0 }}>
              {t('briefing.roleHint')}
            </p>
          </div>
          <div className="briefing-header__actions row">
            {aiOff && (
              <button type="button" className="btn ghost" onClick={() => goto('ai-mode')}>
                {t('dashboard.chooseAiMode')}
              </button>
            )}
            <GenerateBriefingButton
              disabled={aiOff || busy.briefing || localBlock != null}
              busy={busy.briefing}
              onClick={() => {
                if (exhausted) {
                  setUpgradeOpen(true);
                  return;
                }
                void generate();
              }}
              title={
                aiOff
                  ? t('dashboard.briefingNeedAi')
                  : exhausted
                    ? t('briefing.quotaExhausted')
                    : undefined
              }
            />
          </div>
        </div>
      </header>

      {prefs && !aiOff && !busy.briefing && (
        <MailProcessPreflight prefs={prefs} t={t} />
      )}

      {localBlock && !aiOff && (
        <div className="card stack" style={{ gap: 'var(--s-3)' }}>
          <p className="subtle" style={{ margin: 0 }}>
            {t('dashboard.briefingNeedLocalSetup')}
          </p>
          <button type="button" className="btn primary" onClick={() => goto('local-ai')}>
            {t('dashboard.openLocalAi')}
          </button>
        </div>
      )}

      {busy.briefing && (
        <BriefingProgressPanel active={busy.briefing} progress={briefingProgress} />
      )}

      {briefingError && (
        <div
          className="card stack"
          style={{
            borderColor: 'var(--prio-high-ink)',
            background: 'var(--prio-high-bg)',
          }}
        >
          <p className="subtle" style={{ margin: 0, color: 'var(--ink-primary)' }}>
            {errorDisplay}
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => clearBriefingError()}>
              {t('dashboard.dismissError')}
            </button>
          </div>
        </div>
      )}

      {!briefing && !busy.briefing ? (
        <div className="card empty">{t('briefing.emptyCta')}</div>
      ) : briefing ? (
        <div className="mail-process-slot">
          {busy.briefing && <MailProcessResultsSpinner />}
          <MailProcessResults collapsed={busy.briefing} contentKey={briefing.generatedAt}>
          {briefing.inspected?.totalScanned === 0 && (
            <section className="card mail-process-results__section">
              <p className="subtle" style={{ margin: 0 }}>
                {t('briefing.noMailInWindow')}
              </p>
            </section>
          )}

          {displayReasoning && (
            <section className="card stack mail-process-results__section">
              <h2 className="h2">{t('briefing.reasoning')}</h2>
              <p style={{ margin: 0 }}>{displayReasoning}</p>
            </section>
          )}

          {briefing.triage && (
            <div className="mail-process-results__section">
              <TriageGroupsPanel
                triage={briefing.triage}
                emailById={emailById}
                t={t}
                dismissBusy={dismissBusy}
                gmailMarkReadActive={
                  (prefs?.triageGmailMarkReadEnabled ?? false) &&
                  (authStatus?.gmailModifyScopeGranted ?? false)
                }
                onOpen={(item) => void openInGmail(triageItemToEmailSummary(item))}
                onDismissLater={async (ids) => {
                  setDismissBusy(true);
                  try {
                    await dismissTriageEmails(ids);
                  } finally {
                    setDismissBusy(false);
                  }
                }}
              />
            </div>
          )}

          <section className="card stack mail-process-results__section">
            <h2 className="h2">{t('briefing.highlights')}</h2>
            {briefing.highlights.length === 0 ? (
              <div className="empty">{t('briefing.emptyHighlights')}</div>
            ) : (
              <div className="stack tight">
                {briefing.highlights.map((h) => (
                  <div key={h.emailId} className="email-row">
                    <div className="top">
                      <span className="from">{h.from}</span>
                      <span className="meta">{t('briefing.signals', { n: h.whyItMatters.length })}</span>
                    </div>
                    <span className="subject">{h.subject}</span>
                    <span className="snippet">{h.oneLineSummary}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {briefing.attentionAreas.length > 0 && (
            <section className="card stack mail-process-results__section">
              <h2 className="h2">{t('briefing.attention')}</h2>
              <ul className="stack tight" style={{ paddingLeft: 18, margin: 0 }}>
                {briefing.attentionAreas.map((line, i) => (
                  <li key={i} className="subtle">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card mail-process-results__section">
            <span className="subtle">{briefing.toneNote}</span>
          </section>
          </MailProcessResults>
        </div>
      ) : null}

      <UpgradeQuotaModal
        open={upgradeOpen}
        resetAt={limitFromError?.resetAt ?? aiQuota?.resetAt}
        limit={limitFromError?.limit ?? aiQuota?.limit ?? undefined}
        onClose={() => setUpgradeOpen(false)}
      />
    </div>
  );
}
