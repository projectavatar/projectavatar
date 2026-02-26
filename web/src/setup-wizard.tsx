import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from './state/store.ts';
import { isValidToken } from '@project-avatar/shared';
import { AvatarCanvas } from './avatar/avatar-canvas.tsx';
import manifest from './assets/models/manifest.json';
import type { ConnectionState } from './state/store.ts';
import type { ModelEntry } from './types.ts';

type WizardStep = 'pick-model' | 'setup';

const models = (manifest as unknown as { models: ModelEntry[] }).models;

// ─── Styles ────────────────────────────────────────────────────────────────

const wizardContainer: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'var(--color-bg)',
  position: 'relative',
};

const pickerPage: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100%',
  padding: '2rem',
};

const pickerTitle: React.CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 600,
  marginBottom: '0.5rem',
  color: 'var(--color-text)',
};

const pickerSubtitle: React.CSSProperties = {
  fontSize: '0.95rem',
  color: 'var(--color-text-muted)',
  marginBottom: '2rem',
  textAlign: 'center',
  maxWidth: 480,
  lineHeight: 1.5,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '1rem',
  maxWidth: 720,
  width: '100%',
  marginBottom: '2rem',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  overflow: 'hidden',
  cursor: 'pointer',
  transition: 'border-color 0.2s, transform 0.15s',
};

const cardThumbnailFallback: React.CSSProperties = {
  width: '100%',
  height: 160,
  background: 'linear-gradient(135deg, var(--color-accent), #6366f1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '3rem',
};

const cardBody: React.CSSProperties = {
  padding: '0.75rem 1rem 1rem',
};

const cardName: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 600,
  marginBottom: '0.25rem',
  color: 'var(--color-text)',
};

const cardDesc: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
  lineHeight: 1.4,
};

const tokenLinkStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  textDecoration: 'underline',
  fontFamily: 'inherit',
  padding: 0,
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
};

const modalCard: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  padding: '1.5rem',
  maxWidth: 400,
  width: '90%',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: '14px',
  fontFamily: 'var(--font-mono)',
  padding: '10px 12px',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-text)',
  outline: 'none',
  boxSizing: 'border-box',
  marginTop: '0.75rem',
};

const buttonPrimary: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  fontSize: '0.9rem',
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: 'var(--color-accent)',
  color: '#fff',
  marginTop: '0.75rem',
};

// ─── Setup step overlay ────────────────────────────────────────────────────

const setupWrapper: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
};

const overlayBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  pointerEvents: 'none',
};

const overlayCard: React.CSSProperties = {
  background: 'rgba(10, 10, 15, 0.85)',
  backdropFilter: 'blur(12px)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '2rem',
  maxWidth: 520,
  width: '90%',
  pointerEvents: 'auto',
};

const overlayTitle: React.CSSProperties = {
  fontSize: '1.35rem',
  fontWeight: 600,
  marginBottom: '1.25rem',
  color: 'var(--color-text)',
};

const fieldLabel: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: 'var(--color-text-muted)',
  marginBottom: '0.35rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const fieldRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginBottom: '1rem',
};

const fieldValue: React.CSSProperties = {
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

const copyBtn: React.CSSProperties = {
  flexShrink: 0,
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 500,
  transition: 'background 0.15s',
  whiteSpace: 'nowrap',
};

const hintText: React.CSSProperties = {
  fontSize: '0.85rem',
  color: 'var(--color-text-muted)',
  lineHeight: 1.5,
  margin: '0.75rem 0 1rem',
};

const connectedBtn: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  fontSize: '0.95rem',
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: 'var(--color-success)',
  color: '#fff',
  marginTop: '0.5rem',
};

const skipBtn: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  fontSize: '0.85rem',
  fontWeight: 500,
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  marginTop: '0.5rem',
};

const statusRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 500,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--color-border)',
  marginBottom: '0.75rem',
  alignSelf: 'center',
  width: 'fit-content',
  margin: '0 auto 0.75rem',
};

const statusDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
};

const STATUS_COLORS: Record<ConnectionState, string> = {
  connected: 'var(--color-success)',
  connecting: 'var(--color-warning)',
  reconnecting: 'var(--color-warning)',
  disconnected: 'var(--color-danger)',
};

const STATUS_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
};

function InlineStatus() {
  const connectionState = useStore((s) => s.connectionState);
  const reconnectAttempt = useStore((s) => s.reconnectAttempt);

  const color = STATUS_COLORS[connectionState];
  let label = STATUS_LABELS[connectionState];
  if (connectionState === 'reconnecting' && reconnectAttempt > 0) {
    label = `Reconnecting (#${reconnectAttempt})`;
  }

  return (
    <div style={statusRow}>
      <div
        style={{
          ...statusDot,
          background: color,
          boxShadow: connectionState === 'connected' ? `0 0 6px ${color}` : 'none',
        }}
      />
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  );
}

// ─── Components ────────────────────────────────────────────────────────────

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Clipboard write failed — show error state briefly
        setCopied(false);
      }
    );
  }, [value]);

  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <div style={fieldRow}>
        <div style={fieldValue}>{value}</div>
        <button
          style={{
            ...copyBtn,
            background: copied ? 'rgba(34,197,94,0.15)' : copyBtn.background,
            color: copied ? 'var(--color-success)' : copyBtn.color,
          }}
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function TokenModal({ onClose }: { onClose: () => void }) {
  const [inputToken, setInputToken] = useState('');
  const [error, setError] = useState('');
  const setToken = useStore((s) => s.setToken);

  const handleSubmit = () => {
    const trimmed = inputToken.trim();
    if (!isValidToken(trimmed)) {
      setError('Invalid token — must be 32-64 characters (letters, numbers, _ or -)');
      return;
    }
    setToken(trimmed);
    onClose();
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text)' }}>
          Enter existing token
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
          Paste a token you already have to reconnect to your avatar.
        </div>
        <input
          type="text"
          value={inputToken}
          onChange={(e) => { setInputToken(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="Paste your token here..."
          style={inputStyle}
          autoFocus
        />
        {error && <div style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginTop: '0.4rem' }}>{error}</div>}
        <button onClick={handleSubmit} style={buttonPrimary} disabled={!inputToken.trim()}>
          Connect
        </button>
      </div>
    </div>
  );
}

// ─── Model Picker Step ─────────────────────────────────────────────────────

function ModelPickerStep({ onSelect }: { onSelect: (id: string) => void }) {
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div style={pickerPage}>
      <h1 style={pickerTitle}>Choose Your Avatar</h1>
      <p style={pickerSubtitle}>
        Pick a model to get started. You can change this later.
      </p>

      <div style={gridStyle}>
        {models.map((model) => (
          <div
            key={model.id}
            style={{
              ...cardStyle,
              borderColor: hoveredId === model.id ? 'var(--color-accent)' : 'var(--color-border)',
              transform: hoveredId === model.id ? 'translateY(-2px)' : 'translateY(0)',
            }}
            onClick={() => onSelect(model.id)}
            onMouseEnter={() => setHoveredId(model.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {model.thumbnail ? (
              <img
                src={model.thumbnail}
                alt={model.name}
                style={{ width: '100%', height: 160, objectFit: 'cover' }}
              />
            ) : (
              <div style={cardThumbnailFallback}>
                <span role="img" aria-label="avatar">🎭</span>
              </div>
            )}
            <div style={cardBody}>
              <div style={cardName}>{model.name}</div>
              <div style={cardDesc}>{model.description}</div>
            </div>
          </div>
        ))}
      </div>

      <button style={tokenLinkStyle} onClick={() => setShowTokenModal(true)}>
        I already have a token
      </button>

      {showTokenModal && <TokenModal onClose={() => setShowTokenModal(false)} />}
    </div>
  );
}

// ─── Setup Step ────────────────────────────────────────────────────────────

function SetupStep() {
  const token = useStore((s) => s.token);
  const modelId = useStore((s) => s.modelId);
  const relayUrl = useStore((s) => s.relayUrl);
  const connectionState = useStore((s) => s.connectionState);
  const setSetupComplete = useStore((s) => s.setSetupComplete);

  const avatarUrl = `${window.location.origin}/?token=${token ?? ''}&model=${modelId ?? ''}`;
  const skillUrl = `${relayUrl}/skill/install?token=${token ?? ''}&model=${modelId ?? ''}`;

  const handleFinish = useCallback(() => {
    setSetupComplete(true);
  }, [setSetupComplete]);

  return (
    <div style={setupWrapper}>
      <AvatarCanvas />
      <div style={overlayBackdrop}>
        <div style={overlayCard}>
          <div style={overlayTitle}>Your avatar is ready</div>

          <CopyField label="Avatar URL" value={avatarUrl} />
          <CopyField label="Skill Install URL" value={skillUrl} />

          <p style={hintText}>
            Give your AI agent the Skill Install URL above — tell it:<br />
            <em style={{ color: 'var(--color-text)', fontStyle: 'italic' }}>
              "Install this skill: [paste URL]"
            </em><br />
            Your avatar connects automatically once the skill is installed.
          </p>

          <InlineStatus />

          {connectionState === 'connected' ? (
            <button style={connectedBtn} onClick={handleFinish}>
              Connected! Let's go →
            </button>
          ) : null}

          <button style={skipBtn} onClick={handleFinish}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Wizard Root ───────────────────────────────────────────────────────────

export function SetupWizard() {
  const token = useStore((s) => s.token);
  const modelId = useStore((s) => s.modelId);
  const generateAndSetToken = useStore((s) => s.generateAndSetToken);
  const setModelId = useStore((s) => s.setModelId);

  // Auto-generate token if not present (ref guard prevents StrictMode double-fire)
  const generated = useRef(false);
  useEffect(() => {
    if (!token && !generated.current) {
      generated.current = true;
      generateAndSetToken();
    }
  }, [token, generateAndSetToken]);

  // If only one model available, auto-select it and skip the picker
  useEffect(() => {
    if (!modelId && models.length === 1 && models[0]) {
      setModelId(models[0].id);
    }
  }, [modelId, setModelId]);

  // Determine starting step:
  // - modelId already set (from URL, localStorage, or auto-select above) → setup
  // - multiple models and none selected → pick-model
  const initialStep: WizardStep = (modelId || models.length === 1) ? 'setup' : 'pick-model';
  const [step, setStep] = useState<WizardStep>(initialStep);

  const handleModelSelect = useCallback(
    (id: string) => {
      setModelId(id);
      setStep('setup');
    },
    [setModelId],
  );

  // Re-sync step if modelId arrives asynchronously (e.g. from auto-select effect)
  useEffect(() => {
    if (modelId && step === 'pick-model') {
      setStep('setup');
    }
  }, [modelId, step]);

  return (
    <div style={wizardContainer}>
      {step === 'pick-model' && <ModelPickerStep onSelect={handleModelSelect} />}
      {step === 'setup' && <SetupStep />}
    </div>
  );
}
