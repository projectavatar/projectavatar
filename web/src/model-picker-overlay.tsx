import { useState } from 'react';
import { useWsClient } from './avatar/avatar-canvas.tsx';
import manifest from './assets/models/manifest.json';
import type { ModelEntry } from './types.ts';

const models = (manifest as unknown as { models: ModelEntry[] }).models;

/**
 * ModelPickerOverlay — shown after WebSocket connects when the DO has no model set.
 *
 * On model select:
 * 1. Sends `set_model` to the DO via WebSocket (via WsContext)
 * 2. Shows the selected card as "pending" so the user gets immediate feedback
 * 3. The overlay disappears when `model_changed` arrives from the DO and the
 *    store's modelId becomes non-null (handled in app.tsx routing)
 *
 * If the WebSocket drops between sending and receiving the echo, the pending
 * state prevents the UI from appearing stuck — a "Waiting for relay..." message
 * is shown. The overlay will clear naturally once the WS reconnects and
 * model_changed arrives.
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

const pendingPillStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '8px 16px',
  background: 'rgba(10,10,15,0.85)',
  border: '1px solid var(--color-border)',
  borderRadius: 20,
  fontSize: '0.85rem',
  color: 'var(--color-text-muted)',
  backdropFilter: 'blur(8px)',
};

export function ModelPickerOverlay() {
  const { sendSetModel } = useWsClient();
  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const [pendingId, setPendingId]   = useState<string | null>(null);

  const handleSelect = (id: string) => {
    if (pendingId) return; // already waiting for echo
    setPendingId(id);
    // Sends to DO — the overlay disappears when model_changed echo arrives and
    // app.tsx sees modelId !== null. If WS is disconnected, sendSetModel warns
    // in console; the pending state gives feedback that selection was registered.
    sendSetModel(id);
  };

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
                  opacity: isDisabled ? 0.4 : 1,
                  cursor: isDisabled ? 'default' : 'pointer',
                }}
                onClick={() => !isDisabled && handleSelect(model.id)}
                onMouseEnter={() => !isDisabled && setHoveredId(model.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {model.thumbnail ? (
                  <img
                    src={model.thumbnail}
                    alt={model.name}
                    style={{ width: '100%', height: 140, objectFit: 'cover' }}
                  />
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

        {pendingId && (
          <div style={pendingPillStyle}>
            Waiting for relay... (if this takes too long, check your connection)
          </div>
        )}
      </div>
    </div>
  );
}
