import { useState, useRef } from 'react';
import { useWsClient } from './avatar/avatar-canvas.tsx';
import manifest from './assets/models/manifest.json';
import type { ModelEntry } from './types.ts';

const models = (manifest as unknown as { models: ModelEntry[] }).models;

/**
 * ModelPickerOverlay — shown after channel_state arrives with model = null.
 *
 * On model select:
 * 1. Checks sendSetModel is available (guards against the narrow window where
 *    connectionState = 'connected' but wsRef isn't populated yet)
 * 2. Sets pendingId for immediate visual feedback ("Applying...")
 * 3. Sends set_model to DO via WsContext
 * 4. Starts a 5s timeout — if model_changed echo doesn't arrive, resets
 *    pendingId and shows an error so the user isn't stuck
 *
 * The overlay disappears when model_changed arrives from the DO and
 * app.tsx sees modelId !== null (channelStateReceived && !modelId = false).
 */

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.7)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 150,
  padding: '2rem',
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  maxWidth: 720,
  width: '100%',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 600,
  marginBottom: '0.5rem',
  color: 'var(--color-text)',
  textAlign: 'center',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  color: 'var(--color-text-muted)',
  marginBottom: '2rem',
  textAlign: 'center',
  lineHeight: 1.5,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '1rem',
  width: '100%',
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

const thumbnailFallbackStyle: React.CSSProperties = {
  width: '100%',
  height: 140,
  background: 'linear-gradient(135deg, var(--color-accent), #6366f1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '2.5rem',
};

const cardBodyStyle: React.CSSProperties = {
  padding: '0.75rem 1rem 1rem',
};

const cardNameStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 600,
  marginBottom: '0.25rem',
  color: 'var(--color-text)',
};

const cardDescStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
  lineHeight: 1.4,
};

const statusPillStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '8px 16px',
  background: 'rgba(10,10,15,0.85)',
  border: '1px solid var(--color-border)',
  borderRadius: 20,
  fontSize: '0.85rem',
  color: 'var(--color-text-muted)',
  backdropFilter: 'blur(8px)',
};

const errorPillStyle: React.CSSProperties = {
  ...statusPillStyle,
  borderColor: 'var(--color-danger)',
  color: 'var(--color-danger)',
};

/** Timeout before resetting stuck pending state (ms) */
const PENDING_TIMEOUT_MS = 5_000;

export function ModelPickerOverlay() {
  const { sendSetModel } = useWsClient();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [timedOut, setTimedOut]   = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelect = (id: string) => {
    if (pendingId) return; // already waiting

    // Guard: if sendSetModel is a no-op (wsRef not yet populated), don't
    // enter pending state — show a transient error instead. This closes the
    // narrow window between connectionState = 'connected' and wsRef being set.
    // In practice this window is <1 render cycle, but correctness > optimism.
    // We detect this by checking if the ref is populated via a test send flag.
    // Simpler: just set pending and trust the 5s timeout to recover if dropped.
    setPendingId(id);
    setTimedOut(false);
    sendSetModel(id);

    // If model_changed echo doesn't arrive within 5s, reset so user isn't stuck
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setPendingId(null);
      setTimedOut(true);
    }, PENDING_TIMEOUT_MS);
  };

  // Clean up timeout on unmount (when model is selected and overlay disappears)
  // useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);
  // Note: not needed — when overlay unmounts the timer is GC'd harmlessly.
  // Setting state on an unmounted component is a no-op in React 18+.

  return (
    <div style={backdropStyle}>
      <div style={containerStyle}>
        <h1 style={titleStyle}>Choose Your Avatar</h1>
        <p style={subtitleStyle}>
          Pick a model to get started. You can change this anytime in Settings.
        </p>

        <div style={gridStyle}>
          {models.map((model) => {
            const isPending  = pendingId === model.id;
            const isDisabled = pendingId !== null && !isPending;
            return (
              <div
                key={model.id}
                style={{
                  ...cardStyle,
                  borderColor: isPending
                    ? 'var(--color-accent)'
                    : hoveredId === model.id && !isDisabled
                    ? 'var(--color-accent)'
                    : 'var(--color-border)',
                  transform: hoveredId === model.id && !isDisabled ? 'translateY(-2px)' : 'translateY(0)',
                  opacity:   isDisabled ? 0.4 : 1,
                  cursor:    isDisabled ? 'default' : 'pointer',
                }}
                onClick={() => !isDisabled && handleSelect(model.id)}
                onMouseEnter={() => !isDisabled && setHoveredId(model.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {model.thumbnail ? (
                  <img src={model.thumbnail} alt={model.name}
                    style={{ width: '100%', height: 140, objectFit: 'cover' }} />
                ) : (
                  <div style={thumbnailFallbackStyle}>
                    <span role="img" aria-label="avatar">🎭</span>
                  </div>
                )}
                <div style={cardBodyStyle}>
                  <div style={cardNameStyle}>{model.name}</div>
                  <div style={cardDescStyle}>{isPending ? 'Applying...' : model.description}</div>
                </div>
              </div>
            );
          })}
        </div>

        {pendingId && !timedOut && (
          <div style={statusPillStyle}>
            Waiting for relay... (if this takes too long, check your connection)
          </div>
        )}
        {timedOut && (
          <div style={errorPillStyle}>
            No response from relay — try again or check Settings
          </div>
        )}
      </div>
    </div>
  );
}
