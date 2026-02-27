import { useEffect, useRef, useState } from 'react';
import { useStore } from './state/store.ts';
import { isValidToken } from '@project-avatar/shared';

/**
 * TokenSetup — shown when there's no token at all.
 *
 * Auto-generates a token immediately and shows the link to share with the agent.
 * The user can also paste an existing token if they have one.
 *
 * Once a token is set, App.tsx takes over and connects to the DO.
 * Model selection happens after connection, not here.
 */

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'var(--color-bg)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2rem',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '2rem',
  maxWidth: 480,
  width: '100%',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 600,
  marginBottom: '0.5rem',
  color: 'var(--color-text)',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '0.9rem',
  color: 'var(--color-text-muted)',
  lineHeight: 1.5,
  marginBottom: '1.5rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.35rem',
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginBottom: '1.25rem',
};

const fieldValueStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  color: 'var(--color-text)',
  wordBreak: 'break-all',
  lineHeight: 1.4,
  userSelect: 'all',
};

const copyBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--color-border)',
  margin: '1.25rem 0',
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
  boxSizing: 'border-box',
  marginBottom: '0.5rem',
};

const primaryBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  fontSize: '0.9rem',
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: 'var(--color-accent)',
  color: '#fff',
};

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={fieldRowStyle}>
        <div style={fieldValueStyle}>{value}</div>
        <button
          style={{
            ...copyBtnStyle,
            background: copied ? 'rgba(34,197,94,0.15)' : copyBtnStyle.background,
            color: copied ? 'var(--color-success)' : copyBtnStyle.color,
          }}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function TokenSetup() {
  const token              = useStore((s) => s.token);
  const relayUrl           = useStore((s) => s.relayUrl);
  const generateAndSetToken = useStore((s) => s.generateAndSetToken);
  const setToken           = useStore((s) => s.setToken);

  const [existingToken, setExistingToken] = useState('');
  const [tokenError, setTokenError]       = useState('');

  // Auto-generate token on first render (ref guard prevents StrictMode double-fire)
  const generated = useRef(false);
  useEffect(() => {
    if (!token && !generated.current) {
      generated.current = true;
      generateAndSetToken();
    }
  }, [token, generateAndSetToken]);

  const avatarUrl  = token ? `${window.location.origin}/?token=${token}` : '';
  const skillUrl   = token ? `${relayUrl}/skill/install?token=${token}` : '';

  const handleUseExisting = () => {
    const trimmed = existingToken.trim();
    if (!isValidToken(trimmed)) {
      setTokenError('Invalid token — must be 32-64 characters (letters, numbers, _ or -)');
      return;
    }
    setTokenError('');
    setToken(trimmed);
  };

  if (!token) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={titleStyle}>Setting up...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={titleStyle}>Your avatar is ready</div>
        <p style={subtitleStyle}>
          Share the Skill Install URL with your AI agent to connect it to your avatar.
          Then open the Avatar URL to watch it react.
        </p>

        <CopyField label="Skill Install URL" value={skillUrl} />
        <CopyField label="Avatar URL" value={avatarUrl} />

        <div style={dividerStyle} />

        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
          Already have a token? Use it to reconnect to your existing avatar.
        </div>
        <input
          type="text"
          value={existingToken}
          onChange={(e) => { setExistingToken(e.target.value); setTokenError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleUseExisting(); }}
          placeholder="Paste existing token..."
          style={inputStyle}
        />
        {tokenError && (
          <div style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            {tokenError}
          </div>
        )}
        <button
          onClick={handleUseExisting}
          style={{ ...primaryBtnStyle, opacity: existingToken.trim() ? 1 : 0.5 }}
          disabled={!existingToken.trim()}
        >
          Use existing token
        </button>
      </div>
    </div>
  );
}
