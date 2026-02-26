import { useState } from 'react';
import { useStore } from '../state/store.ts';
import { isValidToken } from '@project-avatar/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  zIndex: 200,
  display: 'flex',
  justifyContent: 'flex-end',
};

const drawerStyle: React.CSSProperties = {
  width: '340px',
  maxWidth: '90vw',
  height: '100%',
  background: 'var(--color-surface)',
  borderLeft: '1px solid var(--color-border)',
  padding: '1.5rem',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.1rem',
  fontWeight: 600,
};

const closeBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  transition: 'background 0.15s',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 500,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-text)',
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: '0.85rem',
  fontWeight: 500,
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  appearance: 'auto' as const,
};

export function SettingsDrawer() {
  const {
    token,
    relayUrl,
    theme,
    settingsOpen,
    setToken,
    setRelayUrl,
    setTheme,
    setSettingsOpen,
    generateAndSetToken,
  } = useStore();

  const [tokenInput, setTokenInput] = useState(token ?? '');
  const [relayInput, setRelayInput] = useState(relayUrl);
  const [error, setError] = useState('');

  if (!settingsOpen) return null;

  const handleSaveToken = () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setToken(null);
      setSettingsOpen(false);
      return;
    }
    if (!isValidToken(trimmed)) {
      setError('Invalid token format');
      return;
    }
    setError('');
    setToken(trimmed);
  };

  const handleSaveRelay = () => {
    setRelayUrl(relayInput.trim() || 'https://relay.projectavatar.io');
  };

  const handleGenerate = () => {
    const t = generateAndSetToken();
    setTokenInput(t);
    setError('');
  };

  return (
    <div style={overlayStyle} onClick={() => setSettingsOpen(false)}>
      <div style={drawerStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={titleStyle}>Settings</span>
          <button style={closeBtnStyle} onClick={() => setSettingsOpen(false)}>
            ×
          </button>
        </div>

        {/* Token */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Token</label>
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value);
              setError('');
            }}
            placeholder="Enter or generate a token"
            style={inputStyle}
          />
          {error && (
            <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{error}</span>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              style={{ ...btnStyle, background: 'var(--color-accent)', color: '#fff', flex: 1 }}
              onClick={handleSaveToken}
            >
              Save
            </button>
            <button
              style={{
                ...btnStyle,
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                flex: 1,
              }}
              onClick={handleGenerate}
            >
              Generate
            </button>
          </div>
        </div>

        {/* Relay URL */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Relay URL</label>
          <input
            type="text"
            value={relayInput}
            onChange={(e) => setRelayInput(e.target.value)}
            placeholder="https://relay.projectavatar.io"
            style={inputStyle}
          />
          <button
            style={{ ...btnStyle, background: 'var(--color-accent)', color: '#fff' }}
            onClick={handleSaveRelay}
          >
            Update
          </button>
        </div>

        {/* Theme */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Theme</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'dark' | 'transparent')}
            style={selectStyle}
          >
            <option value="dark">Dark Background</option>
            <option value="transparent">Transparent (OBS)</option>
          </select>
        </div>

        {/* Info */}
        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Project Avatar v1.0.0
            <br />
            Relay: {relayUrl}
          </p>
        </div>
      </div>
    </div>
  );
}
