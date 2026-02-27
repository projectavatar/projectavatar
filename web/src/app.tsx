import { useEffect } from 'react';
import { useStore } from './state/store.ts';
import { TokenSetup } from './token-setup.tsx';
import { ModelPickerOverlay } from './model-picker-overlay.tsx';
import { AvatarCanvas } from './avatar/avatar-canvas.tsx';
import { StatusBadge } from './components/status-badge.tsx';
import { SettingsDrawer } from './components/settings-drawer.tsx';

const settingsBtnStyle: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: 12,
  width: 32,
  height: 32,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  color: 'var(--color-text-muted)',
  background: 'rgba(10, 10, 15, 0.75)',
  backdropFilter: 'blur(8px)',
  border: '1px solid var(--color-border)',
  cursor: 'pointer',
  zIndex: 100,
  transition: 'border-color 0.15s',
};

const avatarContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
};

/**
 * App routing logic:
 *
 * 1. No token → TokenSetup (generate or paste a token)
 * 2. Token, no model → AvatarCanvas (connects to DO) + ModelPickerOverlay on top
 *    The avatar canvas starts connecting immediately. The DO sends channel_state
 *    which either has a model (skip picker) or null (show picker).
 * 3. Token + model → full avatar experience
 *
 * The model picker is an OVERLAY — not a full-screen replacement. This means
 * the WebSocket connects as soon as we have a token, regardless of model state.
 * Multi-screen users who already have a model in the DO will never see the picker.
 */
export function App() {
  const token          = useStore((s) => s.token);
  const modelId        = useStore((s) => s.modelId);
  const theme          = useStore((s) => s.theme);
  const connectionState = useStore((s) => s.connectionState);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  // Apply theme to body
  useEffect(() => {
    document.body.style.background = theme === 'transparent' ? 'transparent' : 'var(--color-bg)';
  }, [theme]);

  // No token → show token setup screen
  if (!token) {
    return <TokenSetup />;
  }

  // Token present → always render the canvas (connects to DO)
  // If model is null, show the picker as an overlay while canvas runs in background
  const showPicker = !modelId && connectionState === 'connected';
  const showPickerLoading = !modelId && connectionState !== 'connected';

  return (
    <div style={avatarContainerStyle}>
      {/* Canvas always mounts when we have a token — connects WS, starts Three.js */}
      <AvatarCanvas />

      {/* Model picker overlay — shown while connected + no model */}
      {showPicker && <ModelPickerOverlay />}

      {/* Subtle loading indicator while connecting + no model yet */}
      {showPickerLoading && (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 50,
        }}>
          <div style={{
            padding: '8px 16px',
            background: 'rgba(10,10,15,0.8)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            fontSize: '0.85rem',
            color: 'var(--color-text-muted)',
          }}>
            Connecting...
          </div>
        </div>
      )}

      {/* Status + settings — only shown when we have a model */}
      {modelId && (
        <>
          <StatusBadge />
          <button
            style={settingsBtnStyle}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            ⚙
          </button>
          <SettingsDrawer />
        </>
      )}
    </div>
  );
}
