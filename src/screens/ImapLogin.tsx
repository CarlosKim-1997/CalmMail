import { useMemo, useState, type CSSProperties } from 'react';
import { useAppStore } from '../state/appStore';
import { useI18n } from '../i18n/useI18n';

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--line, #dcdcd6)',
  borderRadius: 8,
  font: 'inherit',
  background: 'var(--surface, #fff)',
  color: 'var(--ink-primary, #1f2421)',
};

export function ImapLoginScreen() {
  const { t } = useI18n();
  const auth = useAppStore((s) => s.authStatus);
  const goto = useAppStore((s) => s.goto);
  const imapAutoconfig = useAppStore((s) => s.imapAutoconfig);
  const connectImap = useAppStore((s) => s.connectImap);
  const disconnectImap = useAppStore((s) => s.disconnectImap);
  const error = useAppStore((s) => s.imapConnectError);
  const clearError = useAppStore((s) => s.clearImapConnectError);

  const [email, setEmail] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(993);
  const [secure, setSecure] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(
    () =>
      email.trim().length > 0 &&
      pass.length > 0 &&
      host.trim().length > 0 &&
      port > 0 &&
      !busy,
    [email, pass, host, port, busy],
  );

  const onEmailBlur = async () => {
    const e = email.trim();
    if (!e.includes('@')) return;
    const cfg = await imapAutoconfig(e);
    if (cfg) {
      setHost((h) => (h.trim().length === 0 ? cfg.host : h));
      setPort(cfg.port);
      setSecure(cfg.secure);
    }
    setUser((u) => (u.trim().length === 0 ? e : u));
  };

  const onConnect = async () => {
    clearError();
    setBusy(true);
    try {
      const ok = await connectImap({
        email: email.trim(),
        user: (user || email).trim(),
        pass,
        host: host.trim(),
        port,
        secure,
      });
      if (ok) goto('home');
    } finally {
      setBusy(false);
    }
  };

  if (auth?.imapConnected) {
    return (
      <div className="onboard">
        <h1 className="h1">{t('imap.title')}</h1>
        <div className="card stack">
          <div className="row between">
            <div className="stack tight">
              <strong>{t('imap.connected')}</strong>
              <span className="subtle">{auth.imapEmail}</span>
            </div>
            <span className="badge low">IMAP</span>
          </div>
          <div className="divider" />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="btn ghost" onClick={() => void disconnectImap()}>
              {t('imap.disconnect')}
            </button>
            <button type="button" className="btn primary" onClick={() => goto('home')}>
              {t('gmail.openHome')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard">
      <h1 className="h1">{t('imap.title')}</h1>
      <p className="lede">{t('imap.lede')}</p>

      <div className="card stack">
        {error && <p style={{ color: 'var(--prio-high-ink)', margin: 0 }}>{error}</p>}

        <label className="stack tight">
          <span className="subtle">{t('imap.email')}</span>
          <input
            style={inputStyle}
            type="email"
            value={email}
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => void onEmailBlur()}
          />
        </label>

        <label className="stack tight">
          <span className="subtle">{t('imap.password')}</span>
          <input
            style={inputStyle}
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="btn ghost"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {t('imap.advanced')}
        </button>

        {showAdvanced && (
          <div className="stack">
            <label className="stack tight">
              <span className="subtle">{t('imap.username')}</span>
              <input
                style={inputStyle}
                type="text"
                value={user}
                placeholder={email}
                onChange={(e) => setUser(e.target.value)}
              />
            </label>
            <label className="stack tight">
              <span className="subtle">{t('imap.host')}</span>
              <input
                style={inputStyle}
                type="text"
                value={host}
                placeholder="imap.example.com"
                onChange={(e) => setHost(e.target.value)}
              />
            </label>
            <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <label className="stack tight" style={{ flex: 1 }}>
                <span className="subtle">{t('imap.port')}</span>
                <input
                  style={inputStyle}
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 0)}
                />
              </label>
              <label className="row" style={{ alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={secure}
                  onChange={(e) => setSecure(e.target.checked)}
                />
                <span className="subtle">{t('imap.tls')}</span>
              </label>
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              clearError();
              goto('onboarding');
            }}
          >
            {t('imap.back')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSubmit}
            onClick={() => void onConnect()}
          >
            {busy ? t('imap.connecting') : t('imap.connect')}
          </button>
        </div>
      </div>
    </div>
  );
}
