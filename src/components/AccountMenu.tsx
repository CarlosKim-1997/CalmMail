import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';
import { ipc } from '../lib/ipc';
import type { SubscriptionTier } from '@shared/types';

/**
 * Compact account chip shown at the bottom of the sidebar.
 *
 * Clicking the chip opens a small popover with:
 *   - 프로필 열기 (Google 계정 페이지를 외부 브라우저로 연다)
 *   - 요금제
 *   - 로그아웃 (저장된 토큰 삭제, 온보딩으로 복귀)
 */
export function AccountMenu() {
  const { t } = useI18n();
  const auth = useAppStore((s) => s.authStatus);
  const prefs = useAppStore((s) => s.preferences);
  const monetization = useAppStore((s) => s.monetization);
  const disconnectGmail = useAppStore((s) => s.disconnectGmail);
  const goto = useAppStore((s) => s.goto);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!auth?.gmailConnected) {
    return (
      <div className="subtle" style={{ paddingLeft: 10 }}>
        {t('sidebar.notConnected')}
      </div>
    );
  }

  const initial = (auth.gmailEmail ?? '?').slice(0, 1).toUpperCase();
  const tier: SubscriptionTier = monetization?.effectiveTier ?? 'free';
  const planLabel = t(`sidebar.plan.${tier}`);

  const openGoogleProfile = () => {
    setOpen(false);
    void ipc.invoke(ipc.channels.shellOpenExternal, {
      url: 'https://myaccount.google.com/',
    });
  };

  const openPlans = () => {
    setOpen(false);
    goto('plans');
  };

  const handleLogout = async () => {
    setOpen(false);
    await disconnectGmail();
    goto(prefs?.onboardingCompleted ? 'gmail-login' : 'onboarding');
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="account-chip"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={auth.gmailEmail ?? ''}
      >
        <span className="avatar">{initial}</span>
        <span className="account-chip-text">
          <span className="email">{auth.gmailEmail}</span>
          <span className="plan">{planLabel}</span>
        </span>
        <span className="caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div role="menu" className="account-popover">
          <button
            role="menuitem"
            type="button"
            className="popover-item"
            onClick={openGoogleProfile}
          >
            {t('sidebar.account.openProfile')}
          </button>
          <button role="menuitem" type="button" className="popover-item" onClick={openPlans}>
            {t('sidebar.account.openPlans')}
          </button>
          <button
            role="menuitem"
            type="button"
            className="popover-item danger"
            onClick={() => void handleLogout()}
          >
            {t('sidebar.account.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
