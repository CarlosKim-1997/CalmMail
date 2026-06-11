import { useEffect } from 'react';
import type { BillingApplyResult, MonitorPollReport } from '@shared/types';
import { useAppStore } from './state/appStore';
import { ipc } from './lib/ipc';
import { Sidebar } from './components/Sidebar';
import { OnboardingScreen } from './screens/Onboarding';
import { GmailLoginScreen } from './screens/GmailLogin';
import { AiModeScreen } from './screens/AiMode';
import { CapabilityScreen } from './screens/Capability';
import { HomeScreen } from './screens/Home';
import { BriefingScreen } from './screens/Briefing';
import { SettingsScreen } from './screens/Settings';
import { VipsScreen } from './screens/Vips';
import { AwaitedScreen } from './screens/Awaited';
import { LocalAiScreen } from './screens/LocalAi';
import { PlansScreen } from './screens/Plans';
import { GmailReconnectBanner } from './components/GmailReconnectBanner';

export function App() {
  const route = useAppStore((s) => s.route);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const refreshNotifications = useAppStore((s) => s.refreshNotifications);
  const refreshInbox = useAppStore((s) => s.refreshInbox);
  const refreshAuth = useAppStore((s) => s.refreshAuth);
  const authStatus = useAppStore((s) => s.authStatus);
  const goto = useAppStore((s) => s.goto);
  const isBootstrapped = useAppStore((s) => s.isBootstrapped);
  const language = useAppStore((s) => s.preferences?.language ?? 'ko');

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'ko';
  }, [language]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // When Gmail is not connected, only redirect away from screens that require it.
  // Do NOT reset while the user is in the pre-Gmail wizard (gmail-login → ai-mode → capability),
  // or "Get started" would immediately snap back to onboarding.
  useEffect(() => {
    if (!isBootstrapped || !authStatus) return;
    const preGmailWizard: Array<typeof route> = [
      'onboarding',
      'gmail-login',
      'ai-mode',
      'capability',
    ];
    if (!authStatus.gmailConnected) {
      if (!preGmailWizard.includes(route)) {
        goto('onboarding');
      }
    } else if (route === 'onboarding') {
      const prefs = useAppStore.getState().preferences;
      goto(prefs?.onboardingCompleted ? 'home' : 'gmail-login');
    }
  }, [isBootstrapped, authStatus, route, goto]);

  // Live updates from the main process.
  useEffect(() => {
    const offNotify = ipc.on(ipc.channels.evtNewNotification, () => {
      void refreshNotifications();
    });
    const onMonitorTick = useAppStore.getState().onMonitorTick;
    const refreshInboxSync = useAppStore.getState().refreshInboxSync;
    const offTick = ipc.on<MonitorPollReport>(ipc.channels.evtMonitorTick, (report) => {
      onMonitorTick(report);
      void refreshInbox().then(() => refreshInboxSync());
      void refreshNotifications();
    });
    const offAuth = ipc.on(ipc.channels.evtAuthChanged, () => {
      void refreshAuth();
    });
    const applyBillingResult = useAppStore.getState().applyBillingResult;
    const offBilling = ipc.on<BillingApplyResult>(ipc.channels.evtBillingChanged, (result) => {
      void applyBillingResult(result);
    });
    return () => {
      offNotify();
      offTick();
      offAuth();
      offBilling();
    };
  }, [refreshNotifications, refreshInbox, refreshAuth]);

  const isOnboardingPath =
    route === 'onboarding' ||
    route === 'gmail-login' ||
    route === 'ai-mode' ||
    route === 'capability';

  return (
    <div className={isOnboardingPath ? '' : 'app-shell'}>
      {!isOnboardingPath && <Sidebar />}
      <div className={route === 'home' ? 'main-pane main-pane--home' : 'main-pane'}>
        {!isOnboardingPath && <GmailReconnectBanner />}
        {route === 'onboarding' && <OnboardingScreen />}
        {route === 'gmail-login' && <GmailLoginScreen />}
        {route === 'ai-mode' && <AiModeScreen />}
        {route === 'capability' && <CapabilityScreen />}
        {route === 'home' && <HomeScreen />}
        {route === 'briefing' && <BriefingScreen />}
        {route === 'settings' && <SettingsScreen />}
        {route === 'vips' && <VipsScreen />}
        {route === 'awaited' && <AwaitedScreen />}
        {route === 'local-ai' && <LocalAiScreen />}
        {route === 'plans' && <PlansScreen />}
      </div>
    </div>
  );
}
