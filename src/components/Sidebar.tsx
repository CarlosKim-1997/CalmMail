import { useAppStore, type RouteId } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';
import { AccountMenu } from './AccountMenu';
import { BrandHomeButton } from './BrandHomeButton';

const NAV: Array<{ id: RouteId; key: string }> = [
  { id: 'briefing', key: 'sidebar.briefing' },
  { id: 'awaited', key: 'sidebar.awaited' },
  { id: 'vips', key: 'sidebar.vips' },
  { id: 'local-ai', key: 'sidebar.aiSettings' },
  { id: 'settings', key: 'sidebar.settings' },
];

export function Sidebar() {
  const { t } = useI18n();
  const route = useAppStore((s) => s.route);
  const goto = useAppStore((s) => s.goto);

  return (
    <aside className="sidebar">
      <BrandHomeButton active={route === 'home'} onClick={() => goto('home')} />
      <nav>
        {NAV.map(({ id, key }) => (
          <button
            key={id}
            type="button"
            className={route === id ? 'active' : ''}
            onClick={() => goto(id)}
          >
            {t(key)}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      <AccountMenu />
    </aside>
  );
}
