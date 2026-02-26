import { useState } from 'react';
import { useStore } from './state/store.ts';
import { isValidToken } from '@project-avatar/shared';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '2rem',
    background: 'var(--color-bg)',
  },
  card: {
    maxWidth: '480px',
    width: '100%',
    padding: '2rem',
    background: 'var(--color-surface)',
    borderRadius: '12px',
    border: '1px solid var(--color-border)',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 600 as const,
    marginBottom: '0.5rem',
  },
  subtitle: {
    fontSize: '0.9rem',
    color: 'var(--color-text-muted)',
    marginBottom: '1.5rem',
    lineHeight: 1.5,
  },
  section: {
    marginBottom: '1.5rem',
  },
  label: {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: 500 as const,
    marginBottom: '0.5rem',
    color: 'var(--color-text-muted)',
  },
  input: {
    width: '100%',
    fontSize: '14px',
    fontFamily: 'var(--font-mono)',
    padding: '10px 12px',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    color: 'var(--color-text)',
    outline: 'none',
  },
  button: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '0.95rem',
    fontWeight: 600 as const,
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.2s ease',
  },
  primaryButton: {
    background: 'var(--color-accent)',
    color: '#fff',
  },
  secondaryButton: {
    background: 'transparent',
    color: 'var(--color-accent)',
    border: '1px solid var(--color-accent)',
    marginTop: '0.75rem',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    margin: '1.5rem 0',
    color: 'var(--color-text-muted)',
    fontSize: '0.8rem',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'var(--color-border)',
  },
  error: {
    color: 'var(--color-danger)',
    fontSize: '0.85rem',
    marginTop: '0.5rem',
  },
  tokenDisplay: {
    padding: '10px 12px',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    wordBreak: 'break-all' as const,
    lineHeight: 1.6,
    marginBottom: '0.75rem',
  },
  link: {
    color: 'var(--color-accent)',
    textDecoration: 'none',
    fontSize: '0.85rem',
    wordBreak: 'break-all' as const,
  },
  hint: {
    fontSize: '0.8rem',
    color: 'var(--color-text-muted)',
    marginTop: '1rem',
    lineHeight: 1.5,
  },
} as const;

export function TokenSetup() {
  const [inputToken, setInputToken] = useState('');
  const [error, setError] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  const setToken = useStore((s) => s.setToken);
  const generateAndSetToken = useStore((s) => s.generateAndSetToken);
  const relayUrl = useStore((s) => s.relayUrl);

  const handlePasteToken = () => {
    const trimmed = inputToken.trim();
    if (!isValidToken(trimmed)) {
      setError('Invalid token — must be 32-64 characters (letters, numbers, _ or -)');
      return;
    }
    setError('');
    setToken(trimmed);
  };

  const handleGenerate = () => {
    const token = generateAndSetToken();
    setGeneratedToken(token);
  };

  const handleContinue = () => {
    // Token is already set by generateAndSetToken
    // Trigger a re-render to show the avatar
    if (generatedToken) {
      setToken(generatedToken);
    }
  };

  const skillInstallUrl = generatedToken
    ? `${relayUrl}/skill/install?token=${generatedToken}`
    : null;

  // If token was just generated, show it with setup instructions
  if (generatedToken) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Token Generated</h1>
          <p style={styles.subtitle}>
            Save this token — you'll need it to connect your AI agent.
          </p>

          <div style={styles.section}>
            <label style={styles.label}>Your Token</label>
            <div style={styles.tokenDisplay}>{generatedToken}</div>
          </div>

          <div style={styles.section}>
            <label style={styles.label}>Skill Install URL</label>
            <p style={{ ...styles.subtitle, marginBottom: '0.5rem' }}>
              Give this URL to your AI agent to install the avatar skill:
            </p>
            <a
              href={skillInstallUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.link}
            >
              {skillInstallUrl}
            </a>
          </div>

          <button
            onClick={handleContinue}
            style={{ ...styles.button, ...styles.primaryButton }}
          >
            Continue to Avatar
          </button>

          <p style={styles.hint}>
            For OBS browser source, use this URL with your token:
            <br />
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
              {window.location.origin}?token={generatedToken}
            </code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Project Avatar</h1>
        <p style={styles.subtitle}>
          Connect your AI agent to a 3D avatar that reacts in real-time.
          You'll need a token to link the avatar to your agent's relay channel.
        </p>

        <div style={styles.section}>
          <button
            onClick={handleGenerate}
            style={{ ...styles.button, ...styles.primaryButton }}
          >
            Generate New Token
          </button>
        </div>

        <div style={styles.divider}>
          <div style={styles.dividerLine} />
          <span>or enter existing token</span>
          <div style={styles.dividerLine} />
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Token</label>
          <input
            type="text"
            value={inputToken}
            onChange={(e) => {
              setInputToken(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handlePasteToken();
            }}
            placeholder="Paste your token here..."
            style={styles.input}
          />
          {error && <p style={styles.error}>{error}</p>}
        </div>

        <button
          onClick={handlePasteToken}
          style={{ ...styles.button, ...styles.secondaryButton }}
          disabled={!inputToken.trim()}
        >
          Connect
        </button>
      </div>
    </div>
  );
}
