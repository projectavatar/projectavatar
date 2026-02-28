import { useState, useCallback } from 'react';
import { useStore } from '../state/store.ts';
import { useWsClient } from '../avatar/avatar-canvas.tsx';
import { isValidToken } from '@project-avatar/shared';
import manifest from '../assets/models/manifest.json';
import type { ModelEntry } from '../types.ts';

const models = (manifest as unknown as { models: ModelEntry[] }).models;

// ─── Styles ────────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  zIndex: 200,
  display: 'flex',
  justifyContent: 'flex-start',
};

const drawerStyle: React.CSSProperties = {
  width: '340px',
  maxWidth: '90vw',
  height: '100%',
  background: 'var(--color-surface)',
  borderRight: '1px solid var(--color-border)',
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
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  appearance: 'auto' as const,
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
  lineHeight: 1.4,
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);
  return (
    <button
      onClick={handleCopy}
      style={{
        ...btnStyle,
        background: copied ? 'rgba(34,197,94,0.15)' : 'transparent',
        border: '1px solid var(--color-border)',
        color: copied ? 'var(--color-success)' : 'var(--color-text-muted)',
        fontSize: '0.75rem',
        padding: '6px 10px',
        flexShrink: 0,
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function UrlField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={sectionStyle}>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <div style={{
          flex: 1,
          padding: '7px 10px',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          color: 'var(--color-text-muted)',
          wordBreak: 'break-all',
          lineHeight: 1.4,
          userSelect: 'all',
        }}>
          {value}
        </div>
        <CopyButton value={value} />
      </div>
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

// ─── Main Drawer ───────────────────────────────────────────────────────────────

export function SettingsDrawer() {
  const {
    token,
    modelId,
    relayUrl,
    theme,
    settingsOpen,
    connectionState,
    setToken,
    setRelayUrl,
    setTheme,
    setSettingsOpen,
    generateAndSetToken,
  } = useStore();

  const { sendSetModel } = useWsClient();

  const [tokenInput, setTokenInput] = useState(token ?? '');
  const [relayInput, setRelayInput] = useState(relayUrl);
  const [tokenError, setTokenError] = useState('');

  // Share link: token only — model is owned by the DO, not the URL
  const avatarUrl  = token ? `${window.location.origin}/?token=${token}` : null;
  const skillUrl   = token ? `${relayUrl}/skill/install?token=${token}` : null;
  const isConnected = connectionState === 'connected';

  if (!settingsOpen) return null;

  const handleSaveToken = () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setToken(null);
      setSettingsOpen(false);
      return;
    }
    if (!isValidToken(trimmed)) {
      setTokenError('Invalid token format');
      return;
    }
    setTokenError('');
    setToken(trimmed);
  };

  const handleSaveRelay = () => {
    setRelayUrl(relayInput.trim() || 'https://relay.projectavatar.io');
  };

  const handleGenerate = () => {
    const t = generateAndSetToken();
    setTokenInput(t);
    setTokenError('');
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value || null;
    if (!isConnected) return; // Silently ignore if not connected
    sendSetModel(id);
    // Store updates when model_changed echo arrives from DO
  };

  return (
    <div style={overlayStyle} onClick={() => setSettingsOpen(false)}>
      <div style={drawerStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={titleStyle}>Settings</span>
          <button style={closeBtnStyle} onClick={() => setSettingsOpen(false)}>×</button>
        </div>

        {/* Share links */}
        {skillUrl && (
          <UrlField
            label="Skill Install URL"
            value={skillUrl}
            hint="Give this URL to your AI agent to connect it to your avatar."
          />
        )}
        {avatarUrl && (
          <UrlField
            label="Avatar URL"
            value={avatarUrl}
            hint="Open this on any screen or add to OBS as a browser source."
          />
        )}

        <div style={{ borderTop: '1px solid var(--color-border)' }} />

        {/* Model picker */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Avatar Model</label>
          <select
            value={modelId ?? ''}
            onChange={handleModelChange}
            style={{ ...selectStyle, opacity: isConnected ? 1 : 0.5 }}
            disabled={!isConnected}
          >
            <option value="" disabled>Select a model...</option>
            {models.map((m: ModelEntry) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {!isConnected && (
            <div style={{ ...hintStyle, color: 'var(--color-warning)' }}>
              Connect to the relay to change the model.
            </div>
          )}
          {isConnected && (
            <div style={hintStyle}>
              Model change syncs to all connected screens instantly.
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)' }} />

        {/* Token */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Token</label>
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => { setTokenInput(e.target.value); setTokenError(''); }}
            placeholder="Enter or generate a token"
            style={inputStyle}
          />
          {tokenError && (
            <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{tokenError}</span>
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
              New token
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

        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Project Avatar v1.1.0
            <br />
            Relay: {relayUrl}
          </p>
        </div>
      </div>
    </div>
  );
}
