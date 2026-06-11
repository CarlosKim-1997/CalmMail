import { useState, type ReactNode } from 'react';
import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';
import { ipc } from '../lib/ipc';
import { billingErrorMessageKey } from '../lib/billingErrors';
import type { BillingApplyResult, SubscriptionTier } from '@shared/types';

export function PlansScreen() {
  const { t } = useI18n();
  const monetization = useAppStore((s) => s.monetization);
  const auth = useAppStore((s) => s.authStatus);
  const applyBillingResult = useAppStore((s) => s.applyBillingResult);
  const goto = useAppStore((s) => s.goto);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const tier: SubscriptionTier = monetization?.effectiveTier ?? 'free';
  const cloudCap = monetization?.freeMaxCloudBriefingsPerDay ?? 2;
  const pollMin = monetization?.freeMinMonitoringIntervalMinutes ?? 10;
  const awaitedMax = monetization?.freeMaxAwaitedWaitingThreads ?? 5;
  const briefFree = monetization?.freeBriefingImportantCap ?? 10;
  const briefPaid = monetization?.premiumBriefingImportantCap ?? 22;
  const stubEnabled = monetization?.billingStubEnabled ?? false;
  const stripeConfigured = monetization?.stripeConfigured ?? false;
  const checkoutConfigured = monetization?.checkoutUrlConfigured ?? false;
  const canCheckout = stripeConfigured || checkoutConfigured;
  const stripeLinked = monetization?.stripeCustomerLinked ?? false;
  const gmailOk = auth?.gmailConnected ?? false;

  const runBilling = async (
    call: () => Promise<BillingApplyResult>,
    successMsg?: string,
  ): Promise<boolean> => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await call();
      await applyBillingResult(res);
      if (successMsg) setMsg(successMsg);
      return true;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const mapped = billingErrorMessageKey(raw);
      setMsg(mapped ? t(mapped.key) : raw);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const activateByok = async () => {
    const ok = await runBilling(
      () => ipc.invoke(ipc.channels.billingPlansSetTier, { tier: 'byok' }),
      t('plans.byok.activated'),
    );
    if (ok) goto('local-ai');
  };

  const useFreeTier = () => runBilling(() => ipc.invoke(ipc.channels.billingPlansSetTier, { tier: 'free' }));

  const activatePremiumStub = () =>
    runBilling(
      () => ipc.invoke(ipc.channels.billingStubApply, { tier: 'premium' }),
      t('billing.stubPremiumActivated'),
    );

  const cancelPremiumStub = () =>
    runBilling(
      () => ipc.invoke(ipc.channels.billingStubApply, { tier: 'free' }),
      t('billing.stubPremiumCancelled'),
    );

  const openCheckout = async () => {
    if (stripeConfigured && !gmailOk) {
      setMsg(t('billing.errors.gmailRequired'));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await ipc.invoke(ipc.channels.billingOpenCheckout);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const mapped = billingErrorMessageKey(raw);
      setMsg(mapped ? t(mapped.key) : raw);
    } finally {
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await ipc.invoke(ipc.channels.billingOpenPortal);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const mapped = billingErrorMessageKey(raw);
      setMsg(mapped ? t(mapped.key) : raw);
    } finally {
      setBusy(false);
    }
  };

  const tierLabel = (id: SubscriptionTier) => t(`plans.tier.${id}`);

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <div>
        <h1 className="h1">{t('plans.title')}</h1>
        <p className="lede" style={{ marginTop: 8 }}>
          {t('plans.lede')}
        </p>
        <p className="subtle" style={{ marginTop: 8 }}>
          {t('plans.currentPlan', { plan: tierLabel(tier) })}
        </p>
        {stubEnabled && (
          <p className="subtle" style={{ marginTop: 4, color: 'var(--ink-tertiary)' }}>
            {t('billing.stubEnabledNote')}
          </p>
        )}
      </div>

      <div className="plans-grid-wrap">
        <div className="plans-grid">
        <PlanCard
          name={t('plans.free.name')}
          price={t('plans.free.price')}
          features={[
            t('plans.free.f1', { n: cloudCap }),
            t('plans.free.f2', { min: pollMin, awaited: awaitedMax }),
            t('plans.free.f3', { n: briefFree }),
            t('plans.free.f4'),
          ]}
          active={tier === 'free'}
          activeLabel={t('plans.currentBadge')}
          footer={
            tier !== 'free' ? (
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => void useFreeTier()}
              >
                {t('plans.free.useFree')}
              </button>
            ) : null
          }
        />

        <PlanCard
          name={t('plans.byok.name')}
          price={t('plans.byok.price')}
          features={[
            t('plans.byok.f1'),
            t('plans.byok.f2', { n: briefPaid }),
            t('plans.byok.f3'),
            t('plans.byok.f4'),
          ]}
          active={tier === 'byok'}
          activeLabel={t('plans.currentBadge')}
          footer={
            tier === 'byok' ? (
              <div className="stack tight">
                <p className="subtle" style={{ margin: 0 }}>
                  {t('plans.byok.footerHint')}
                </p>
                <button type="button" className="btn" disabled={busy} onClick={() => goto('local-ai')}>
                  {t('plans.byok.openAiSettings')}
                </button>
              </div>
            ) : (
              <button type="button" className="btn primary" disabled={busy} onClick={() => void activateByok()}>
                {t('plans.byok.activate')}
              </button>
            )
          }
        />

        <PlanCard
          name={t('plans.premium.name')}
          price={t('plans.premium.price')}
          features={[
            t('plans.premium.f1'),
            t('plans.premium.f2', { n: briefPaid }),
            t('plans.premium.f3'),
            t('plans.premium.f4'),
          ]}
          active={tier === 'premium'}
          activeLabel={t('plans.currentBadge')}
          footer={
            <div className="stack tight">
              <p className="subtle" style={{ margin: 0 }}>
                {stripeConfigured
                  ? t('billing.stripeCheckoutHintShort')
                  : canCheckout
                    ? t('billing.checkoutHintShort')
                    : t('plans.billingSoonShort')}
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {canCheckout && tier !== 'premium' && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || (stripeConfigured && !gmailOk)}
                    onClick={() => void openCheckout()}
                  >
                    {stripeConfigured ? t('billing.startStripeCheckout') : t('billing.openCheckout')}
                  </button>
                )}
                {stripeLinked && tier === 'premium' && (
                  <button type="button" className="btn" disabled={busy} onClick={() => void openPortal()}>
                    {t('billing.openPortal')}
                  </button>
                )}
                {tier !== 'premium' && (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => void ipc.invoke(ipc.channels.premiumLearnMore)}
                  >
                    {t('plans.premium.cta')}
                  </button>
                )}
                {stubEnabled && tier !== 'premium' && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void activatePremiumStub()}
                  >
                    {t('billing.stubActivatePremium')}
                  </button>
                )}
                {stubEnabled && tier === 'premium' && (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void cancelPremiumStub()}
                  >
                    {t('billing.stubCancelPremium')}
                  </button>
                )}
              </div>
              {monetization?.devPremiumBypass && (
                <p className="subtle" style={{ margin: 0, color: 'var(--ink-tertiary)' }}>
                  {t('settings.premiumDevNote')}
                </p>
              )}
            </div>
          }
        />
        </div>
      </div>

      {msg && (
        <p className="subtle" style={{ margin: 0, color: 'var(--accent-ink)' }}>
          {msg}
        </p>
      )}
    </div>
  );
}

function PlanCard({
  name,
  price,
  features,
  active,
  activeLabel,
  footer,
}: {
  name: string;
  price: string;
  features: string[];
  active?: boolean;
  activeLabel: string;
  footer?: ReactNode;
}) {
  return (
    <section
      className="card stack plans-card"
      style={{
        borderColor: active ? 'var(--accent-ink)' : undefined,
        boxShadow: active ? '0 0 0 1px var(--accent-ink)' : undefined,
      }}
    >
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 className="h2" style={{ margin: 0 }}>
            {name}
          </h2>
          <p className="subtle" style={{ margin: '4px 0 0' }}>
            {price}
          </p>
        </div>
        {active && (
          <span className="badge low" style={{ flexShrink: 0 }}>
            {activeLabel}
          </span>
        )}
      </div>
      <ul className="plans-feature-list">
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {footer && <div className="plans-card__footer">{footer}</div>}
    </section>
  );
}
