import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipc } from '../lib/ipc';
import { useAppStore } from '../state/appStore';
import type {
  AiMode,
  HardwareCapability,
  LocalAiManagedSetupResult,
  LocalAiManagedStatus,
  LocalAiModelFit,
  LocalAiModelId,
  LocalAiModelInfo,
  LocalAiRecommendation,
  LocalAiSetupProgress,
} from '@shared/types';
import { isLocalAiUnlocked } from '@shared/monetization';
import { LOCAL_AI_POLICY_VERSION } from '@shared/localAiPolicy';
import { recommendLocalAiModels } from '@shared/localAiRecommend';
import { useI18n } from '../i18n/useI18n';
import { HardwareVerdict } from '../components/HardwareVerdict';
import { MyApiKeysSection } from '../components/MyApiKeysSection';

type SetupFlow = 'idle' | 'running' | 'done';

export function LocalAiScreen() {
  const { t, lang } = useI18n();
  const prefs = useAppStore((s) => s.preferences);
  const monetization = useAppStore((s) => s.monetization);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const goto = useAppStore((s) => s.goto);

  const [hw, setHw] = useState<HardwareCapability | null>(null);
  const [hwCheckedAt, setHwCheckedAt] = useState<number | null>(null);
  const [hwBusy, setHwBusy] = useState(false);
  const [hwError, setHwError] = useState<string | null>(null);

  const [models, setModels] = useState<LocalAiModelInfo[]>([]);
  const [managedStatus, setManagedStatus] = useState<LocalAiManagedStatus | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<LocalAiModelId | null>(null);

  const [setupFlow, setSetupFlow] = useState<SetupFlow>('idle');
  const [setupResult, setSetupResult] = useState<LocalAiManagedSetupResult | null>(null);
  const [setupProgress, setSetupProgress] = useState<LocalAiSetupProgress | null>(null);

  const [showNotice, setShowNotice] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const [noticesText, setNoticesText] = useState<string | null>(null);
  const [showOllamaWarning, setShowOllamaWarning] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ollamaDetected, setOllamaDetected] = useState(false);

  const [modeBusy, setModeBusy] = useState(false);
  const [showModeSaved, setShowModeSaved] = useState(false);

  // ───────── initial load ─────────

  const refreshManagedStatus = useCallback(async () => {
    const s = await ipc.invoke(ipc.channels.localAiManagedStatus);
    setManagedStatus(s);
  }, []);

  useEffect(() => {
    void (async () => {
      const [m, status, cached] = await Promise.all([
        ipc.invoke(ipc.channels.localAiManagedListModels),
        ipc.invoke(ipc.channels.localAiManagedStatus),
        ipc.invoke(ipc.channels.hardwareGetCached),
      ]);
      setModels(m);
      setManagedStatus(status);
      if (cached) {
        setHw(cached.capability);
        setHwCheckedAt(cached.analyzedAt);
      }
      const r = await ipc.invoke(ipc.channels.localAiRefreshOllama);
      setOllamaDetected(r.detected);
    })();
  }, []);

  // Subscribe at mount: setup IPCs may emit progress events before our
  // post-invoke state flip lands, so we keep the listener live for the
  // whole screen lifetime and ignore stray events when nothing is running.
  useEffect(() => {
    return ipc.on(ipc.channels.evtLocalAiSetupProgress, (p: LocalAiSetupProgress) => {
      setSetupProgress(p);
    });
  }, []);

  // ───────── derived ─────────

  const noticeAccepted =
    !!prefs?.localAiAcceptedNotices &&
    prefs.localAiAcceptedNotices.policyVersion === LOCAL_AI_POLICY_VERSION;

  const isOllamaActive = prefs?.localAiPreferredRuntime === 'ollama_advanced';

  /** Authoritative ranking shared with the main process (RAM + CPU + GPU). */
  const recommendation = useMemo<LocalAiRecommendation>(
    () => recommendLocalAiModels(models, hw),
    [models, hw],
  );

  /** Quick lookup of a model's fit verdict. */
  const fitOf = useMemo(() => {
    const m = new Map<LocalAiModelId, LocalAiModelFit>();
    for (const r of recommendation.models) m.set(r.modelId, r.fit);
    return m;
  }, [recommendation]);

  // Default selection: explicit user pick → previously saved → recommended.
  const effectiveSelectedModelId =
    selectedModelId ?? prefs?.localAiModelId ?? recommendation.primaryModelId;

  const selectedModel = useMemo(
    () => models.find((m) => m.id === effectiveSelectedModelId) ?? null,
    [models, effectiveSelectedModelId],
  );

  const selectedFit = selectedModel ? fitOf.get(selectedModel.id) ?? null : null;

  // ───────── actions ─────────

  const refreshHw = async () => {
    setHwBusy(true);
    setHwError(null);
    try {
      const capability = await ipc.invoke(ipc.channels.hardwareAnalyze);
      setHw(capability);
      setHwCheckedAt(Date.now());
    } catch (e) {
      setHwError((e as Error).message);
    } finally {
      setHwBusy(false);
    }
  };

  const acceptNotice = async () => {
    const next = await ipc.invoke(ipc.channels.localAiAcceptNotice);
    // The store is the source of truth; replace prefs in-flight.
    useAppStore.setState({ preferences: next });
    setShowNotice(false);
  };

  const runManagedSetup = async (modelId: LocalAiModelId) => {
    setSetupFlow('running');
    setSetupResult(null);
    setSetupProgress({ phase: 'init', percent: 2 });
    const res = await ipc.invoke(ipc.channels.localAiManagedSetup, { modelId });
    setSetupResult(res);
    setSetupFlow('done');
    await refreshManagedStatus();
  };

  const stopManagedServer = async () => {
    await ipc.invoke(ipc.channels.localAiManagedStopServer);
    await refreshManagedStatus();
  };

  const openNotices = async () => {
    setShowNotices(true);
    if (noticesText == null) {
      const r = await ipc.invoke(ipc.channels.localAiReadNotices);
      setNoticesText(r.ok ? r.content : '');
    }
  };

  const openOllamaPage = async () => {
    await ipc.invoke(ipc.channels.localAiOpenOllamaDownloadPage);
  };
  const recheckOllama = async () => {
    const r = await ipc.invoke(ipc.channels.localAiRefreshOllama);
    setOllamaDetected(r.detected);
  };
  const acceptOllamaWarning = () => {
    setShowOllamaWarning(false);
    setAdvancedOpen(true);
  };
  const finishOllama = async () => {
    await setPrefs({ localAiPreferredRuntime: 'ollama_advanced', aiMode: 'local' });
  };
  const migrateToManaged = async () => {
    // Don't stomp the user's chosen model if any.
    await setPrefs({ localAiPreferredRuntime: 'managed' });
  };

  const switchAiMode = async (next: AiMode) => {
    if (!prefs || prefs.aiMode === next) return;
    setModeBusy(true);
    setShowModeSaved(false);
    try {
      const patch: Parameters<typeof setPrefs>[0] = { aiMode: next };
      if (next === 'local' && prefs.localAiPreferredRuntime === 'none') {
        patch.localAiPreferredRuntime = 'managed';
      }
      await setPrefs(patch);
      setShowModeSaved(true);
      window.setTimeout(() => setShowModeSaved(false), 2600);
    } finally {
      setModeBusy(false);
    }
  };

  if (!prefs) return <div className="empty">{t('common.loading')}</div>;

  const localBlocked =
    !!monetization && !isLocalAiUnlocked(prefs, monetization.hasPaidFeatures);

  if (localBlocked) {
    return (
      <div className="stack" style={{ gap: 'var(--s-6)' }}>
        <h1 className="h1">{t('aiSettings.title')}</h1>
        <p className="subtle" style={{ margin: 0 }}>
          {t('localAi.premiumRequired')}
        </p>
        <section className="card stack">
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
      </div>
    );
  }

  // ───────── view ─────────

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <header className="stack tight">
        <h1 className="h1">{t('aiSettings.title')}</h1>
      </header>

      {/* Mode picker */}
      <section className="card stack">
        <div
          className="row between"
          style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}
        >
          <h2 className="h2" style={{ margin: 0 }}>
            {t('aiSettings.modeTitle')}
          </h2>
          <span className="subtle" style={{ fontSize: 13 }}>
            {t(`localAi.modeOpt.${prefs.aiMode}.title`)}
            {prefs.aiMode === 'cloud' ? ` · ${prefs.aiProvider}` : ''}
          </span>
        </div>
        {showModeSaved && (
          <p className="subtle" style={{ margin: 0, color: 'var(--accent-ink)' }}>
            {t('localAi.modeSaved')}
          </p>
        )}
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {(['local', 'cloud'] as const).map((m) => {
            const active = prefs.aiMode === m;
            return (
              <button
                key={m}
                type="button"
                className="card"
                disabled={modeBusy}
                aria-pressed={active}
                onClick={() => void switchAiMode(m)}
                style={{
                  flex: '1 1 160px',
                  textAlign: 'left',
                  borderColor: active ? 'var(--accent-ink)' : 'var(--border-soft)',
                  boxShadow: active ? '0 0 0 1px var(--accent-ink)' : undefined,
                  cursor: modeBusy ? 'wait' : 'pointer',
                  opacity: modeBusy && !active ? 0.6 : 1,
                }}
              >
                <div className="row between" style={{ alignItems: 'center', gap: 8 }}>
                  <strong>{t(`localAi.modeOpt.${m}.title`)}</strong>
                  {active && (
                    <span className="badge low" style={{ flexShrink: 0 }}>
                      {t('localAi.modeActive')}
                    </span>
                  )}
                </div>
                <span className="subtle" style={{ fontSize: 12 }}>
                  {t(`localAi.modeOpt.${m}.hint`)}
                </span>
              </button>
            );
          })}
        </div>
        {modeBusy && (
          <span className="subtle" style={{ margin: 0 }}>
            {t('localAi.modeSaving')}
          </span>
        )}
      </section>

      <MyApiKeysSection />

      {/* Migration banner — only for users who were already on Ollama advanced. */}
      {isOllamaActive && (
        <section className="card stack tight" style={{ borderStyle: 'dashed' }}>
          <strong>{t('localAi.migration.title')}</strong>
          <span className="subtle" style={{ margin: 0 }}>
            {t('localAi.migration.body')}
          </span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void migrateToManaged()}
            >
              {t('localAi.migration.trySwitch')}
            </button>
            <button type="button" className="btn ghost" disabled>
              {t('localAi.migration.keepOllama')}
            </button>
          </div>
        </section>
      )}

      {/* Managed lane (standard) */}
      <section className="card stack">
        <div className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
          <h2 className="h2" style={{ margin: 0 }}>
            {t('localAi.managed.title')}
          </h2>
          <span className="badge low">{t('localAi.recommendedTag')}</span>
        </div>
        <p className="subtle" style={{ margin: 0 }}>
          {t('localAi.managed.desc')}
        </p>

        {/* Notice gate */}
        {!noticeAccepted ? (
          <div className="stack tight">
            <button
              type="button"
              className="btn primary"
              onClick={() => setShowNotice(true)}
            >
              {t('localAi.managed.openNotice')}
            </button>
          </div>
        ) : (
          <>
            {!recommendation.basedOnHardware && (
              <p className="subtle" style={{ margin: 0 }}>
                {t('localAi.managed.recommendHintNoHw')}
              </p>
            )}

            <ModelPicker
              models={models}
              recommendation={recommendation}
              currentId={effectiveSelectedModelId}
              onSelect={(id) => setSelectedModelId(id)}
              t={t}
            />

            {(selectedFit === 'slow' || selectedFit === 'too_heavy') && (
              <span style={{ color: 'var(--prio-high-ink)', fontSize: 13 }}>
                {t(`localAi.managed.fitNote.${selectedFit}`)}
              </span>
            )}

            <ManagedStatusRow status={managedStatus} t={t} />

            {setupFlow === 'running' && (
              <SetupProgressBar progress={setupProgress} t={t} />
            )}

            {setupFlow === 'done' && setupResult && !setupResult.ok && (
              <div className="stack tight">
                <span style={{ color: 'var(--prio-high-ink)' }}>
                  {t(`localAi.setupError.${setupResult.errorCode ?? 'binary_missing'}`)}
                </span>
                {setupResult.errorDetail && (
                  <span className="subtle" style={{ fontSize: 12, wordBreak: 'break-word' }}>
                    {setupResult.errorDetail}
                  </span>
                )}
              </div>
            )}

            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn primary"
                disabled={!selectedModel || setupFlow === 'running'}
                onClick={() => {
                  if (selectedModel) void runManagedSetup(selectedModel.id);
                }}
              >
                {prefs.localAiModelId
                  ? t('localAi.managed.restart')
                  : t('localAi.managed.start')}
              </button>
              {managedStatus?.serverRunning && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void stopManagedServer()}
                >
                  {t('localAi.managed.stopServer')}
                </button>
              )}
            </div>
          </>
        )}

        <button
          type="button"
          className="btn link"
          onClick={() => void openNotices()}
          style={{ alignSelf: 'flex-start', padding: 0 }}
        >
          {t('localAi.notice.policyLink')}
        </button>
      </section>

      {/* Advanced disclosure */}
      <section className="card stack tight">
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            if (advancedOpen) {
              setAdvancedOpen(false);
              return;
            }
            // Show warning only when expanding for the first time per session.
            setShowOllamaWarning(true);
          }}
          style={{ alignSelf: 'flex-start' }}
        >
          {advancedOpen
            ? t('localAi.advanced.collapse')
            : t('localAi.advanced.expand')}
        </button>

        {advancedOpen && (
          <div className="stack">
            <strong>{t('localAi.ollamaAdvanced.title')}</strong>
            <span className="subtle" style={{ margin: 0 }}>
              {t('localAi.ollamaAdvanced.desc')}
            </span>
            <span style={{ color: 'var(--prio-med-ink)', fontSize: 13 }}>
              {t('localAi.ollamaAdvanced.deprecationNote')}
            </span>
            <ol className="subtle" style={{ margin: 0, paddingLeft: 20 }}>
              <li>{t('localAi.ollama.step1')}</li>
              <li>{t('localAi.ollama.step2')}</li>
              <li>{t('localAi.ollama.step3')}</li>
            </ol>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn"
                onClick={() => void openOllamaPage()}
              >
                {t('localAi.ollama.openSite')}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void recheckOllama()}
              >
                {t('localAi.ollama.recheck')}
              </button>
            </div>
            <p className="subtle" style={{ margin: 0 }}>
              {ollamaDetected
                ? t('localAi.ollama.detected')
                : t('localAi.ollama.notDetected')}
            </p>
            {ollamaDetected && !isOllamaActive && (
              <button
                type="button"
                className="btn primary"
                onClick={() => void finishOllama()}
              >
                {t('localAi.ollama.done')}
              </button>
            )}
          </div>
        )}
      </section>

      {/* PC capability — unchanged */}
      <section className="card stack">
        <h2 className="h2">{t('localAi.capability.title')}</h2>
        {hw && hwCheckedAt != null ? (
          <HardwareVerdict hw={hw} analyzedAt={hwCheckedAt} lang={lang} t={t} />
        ) : (
          <p className="subtle" style={{ margin: 0 }}>
            {t('localAi.capability.empty')}
          </p>
        )}
        {hwError && (
          <span style={{ color: 'var(--prio-high-ink)' }}>{hwError}</span>
        )}
        <button
          type="button"
          className="btn"
          disabled={hwBusy}
          onClick={() => void refreshHw()}
        >
          {hwBusy ? t('localAi.rechecking') : t('localAi.recheck')}
        </button>
      </section>

      {/* Modals */}
      {showNotice && (
        <ModalOverlay onClose={() => setShowNotice(false)}>
          <div className="stack">
            <h2 className="h2" style={{ margin: 0 }}>
              {t('localAi.notice.title')}
            </h2>
            <p style={{ margin: 0, whiteSpace: 'pre-line' }}>
              {t('localAi.notice.body')}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => void acceptNotice()}
              >
                {t('localAi.notice.accept')}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowNotice(false)}
              >
                {t('localAi.notice.cancel')}
              </button>
            </div>
            <button
              type="button"
              className="btn link"
              onClick={() => void openNotices()}
              style={{ alignSelf: 'flex-start', padding: 0 }}
            >
              {t('localAi.notice.policyLink')}
            </button>
          </div>
        </ModalOverlay>
      )}

      {showOllamaWarning && (
        <ModalOverlay onClose={() => setShowOllamaWarning(false)}>
          <div className="stack">
            <h2 className="h2" style={{ margin: 0 }}>
              {t('localAi.ollamaAdvanced.warningTitle')}
            </h2>
            <p style={{ margin: 0 }}>{t('localAi.ollamaAdvanced.warningBody')}</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn primary"
                onClick={acceptOllamaWarning}
              >
                {t('localAi.ollamaAdvanced.iUnderstand')}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowOllamaWarning(false)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showNotices && (
        <ModalOverlay onClose={() => setShowNotices(false)}>
          <div className="stack">
            <h2 className="h2" style={{ margin: 0 }}>
              {t('localAi.notices.title')}
            </h2>
            <p className="subtle" style={{ margin: 0 }}>
              {t('localAi.notices.desc')}
            </p>
            <pre
              style={{
                margin: 0,
                maxHeight: '55vh',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 12,
                lineHeight: 1.5,
                background: 'var(--bg-subtle, #f6f6f6)',
                padding: 12,
                borderRadius: 8,
              }}
            >
              {noticesText == null
                ? t('localAi.notices.loading')
                : noticesText === ''
                  ? t('localAi.notices.unavailable')
                  : noticesText}
            </pre>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowNotices(false)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ───────── helpers ─────────

/** Visual weight for each fit badge. */
const FIT_BADGE_CLASS: Record<LocalAiModelFit, string> = {
  recommended: 'low',
  usable: 'low',
  slow: 'medium',
  too_heavy: 'high',
};

function ModelPicker(props: {
  models: LocalAiModelInfo[];
  recommendation: LocalAiRecommendation;
  currentId: LocalAiModelId | null;
  onSelect: (id: LocalAiModelId) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const { models, recommendation, currentId, onSelect, t } = props;
  const fitOf = new Map<LocalAiModelId, LocalAiModelFit>(
    recommendation.models.map((r) => [r.modelId, r.fit] as const),
  );
  // Render in the recommendation's best→worst order, not catalog order.
  const ordered = recommendation.models
    .map((r) => models.find((m) => m.id === r.modelId))
    .filter((m): m is LocalAiModelInfo => !!m);

  return (
    <div className="stack tight">
      <strong>{t('localAi.managed.modelTitle')}</strong>
      <div className="stack" style={{ gap: 6 }}>
        {ordered.map((m) => {
          const selected = currentId === m.id;
          const fit = fitOf.get(m.id) ?? 'usable';
          const isPrimary = recommendation.primaryModelId === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className="card"
              aria-pressed={selected}
              onClick={() => onSelect(m.id)}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: selected ? 'var(--accent-ink)' : 'var(--border-soft)',
                boxShadow: selected ? '0 0 0 1px var(--accent-ink)' : undefined,
                opacity: fit === 'too_heavy' ? 0.7 : 1,
              }}
            >
              <div
                className="row between"
                style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
              >
                <strong>{m.displayName}</strong>
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {isPrimary && recommendation.basedOnHardware && (
                    <span className="badge low">
                      {t('localAi.managed.modelRecommendedBadge')}
                    </span>
                  )}
                  {recommendation.basedOnHardware && (
                    <span className={`badge ${FIT_BADGE_CLASS[fit]}`}>
                      {t(`localAi.managed.fit.${fit}`)}
                    </span>
                  )}
                </span>
              </div>
              <span className="subtle" style={{ fontSize: 12 }}>
                {m.shortDescription}
              </span>
              <span className="subtle" style={{ fontSize: 12 }}>
                {t('localAi.managed.modelMeta', {
                  sizeGb: (m.approxBytes / 1_000_000_000).toFixed(1),
                  ramGb: m.minRamGb,
                  license: m.license,
                })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ManagedStatusRow(props: {
  status: LocalAiManagedStatus | null;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const { status, t } = props;
  if (!status) return null;
  const allReady = status.binaryReady && status.modelReady;
  return (
    <div className="stack tight">
      {allReady ? (
        <span className="subtle">{t('localAi.managed.status.readyAll')}</span>
      ) : (
        <span className="subtle">{t('localAi.managed.status.idle')}</span>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <StatusPill
          on={status.binaryReady}
          label={t('localAi.managed.status.binaryReady')}
        />
        <StatusPill
          on={status.modelReady}
          label={t('localAi.managed.status.modelReady')}
        />
        <StatusPill
          on={status.serverRunning}
          label={t('localAi.managed.status.serverRunning')}
        />
      </div>
    </div>
  );
}

function StatusPill(props: { on: boolean; label: string }) {
  return (
    <span
      className="badge low"
      style={{
        background: props.on ? 'var(--prio-low-bg)' : 'transparent',
        opacity: props.on ? 1 : 0.55,
        border: '1px solid var(--border-soft)',
      }}
    >
      {props.on ? '● ' : '○ '}
      {props.label}
    </span>
  );
}

function SetupProgressBar(props: {
  progress: LocalAiSetupProgress | null;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const { progress, t } = props;
  if (!progress) return null;
  return (
    <div className="stack tight">
      <p style={{ margin: 0 }}>{t(`localAi.setupPhase.${progress.phase}`)}</p>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: 'var(--border-soft)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.max(3, Math.min(100, progress.percent))}%`,
            background: 'var(--accent-ink)',
            transition: 'width 0.35s ease',
          }}
        />
      </div>
    </div>
  );
}

function ModalOverlay(props: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="presentation"
      onClick={props.onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 520,
          width: '100%',
          background: 'var(--bg-panel, #fff)',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
