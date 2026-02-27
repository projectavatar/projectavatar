import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useStore } from './state/store.ts';
import { TokenSetup } from './token-setup.tsx';
import { ModelPickerOverlay } from './model-picker-overlay.tsx';
import { AvatarCanvas, WsContext } from './avatar/avatar-canvas.tsx';
import type { WsContextValue } from './avatar/avatar-canvas.tsx';
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

const connectingStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 50,
};

const connectingPillStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(10,10,15,0.85)',
  border: '1px solid var(--color-border)',
  borderRadius: 20,
  fontSize: '0.85rem',
  fontWeight: 500,
  color: 'var(--color-text-muted)',
  backdropFilter: 'blur(8px)',
};

/**
 * App routing logic:
 *
 * 1. No token → TokenSetup
 * 2. Token present → always mount AvatarCanvas (WS connects immediately)
 *    a. No model + connecting  → canvas + "Connecting..." pill + StatusBadge
 *    b. No model + connected   → canvas + ModelPickerOverlay
 *    c. Model set              → full avatar experience
 *
 * WsContext.Provider lives here — above BOTH AvatarCanvas and ModelPickerOverlay —
 * so siblings share the same sendSetModel reference. Do NOT move it inside
 * AvatarCanvas or ModelPickerOverlay will get the default no-op.
 */
export function App() {
  const token           = useStore((s) => s.token);
  const modelId         = useStore((s) => s.modelId);
  const theme           = useStore((s) => s.theme);
  const connectionState = useStore((s) => s.connectionState);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  // Holds the sendSetModel function provided by AvatarCanvas via onSendSetModel.
  // Stored as a ref to avoid re-renders when the function changes; the context
  // value is memoized and reads from the ref at call time.
  const sendSetModelRef = useRef<((modelId: string | null) => void) | null>(null);
  const [wsReady, setWsReady] = useState(false);

  const handleSendSetModelReady = useCallback(
    (fn: ((modelId: string | null) => void) | null) => {
      sendSetModelRef.current = fn;
      setWsReady(fn !== null);
    },
    [],
  );

  // Stable context value — sendSetModel delegates to the ref so the function
  // identity stays constant across WS reconnects. useMemo ensures the object
  // reference is stable and doesn't cause unnecessary re-renders in consumers.
  const wsContextValue = useMemo<WsContextValue>(
    () => ({
      sendSetModel: (id) => {
        if (!sendSetModelRef.current) {
          console.warn('[WsContext] sendSetModel called but WS client is not ready');
          return;
        }
        sendSetModelRef.current(id);
      },
    }),
    // wsReady is listed so useMemo re-runs when the WS becomes ready/unready,
    // but sendSetModel itself stays the same function reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wsReady],
  );

  // Apply theme to body
  useEffect(() => {
    document.body.style.background = theme === 'transparent' ? 'transparent' : 'var(--color-bg)';
  }, [theme]);

  if (!token) return <TokenSetup />;

  const showPicker        = !modelId && connectionState === 'connected';
  const showPickerLoading = !modelId && connectionState !== 'connected';

  return (
    <WsContext.Provider value={wsContextValue}>
      <div style={avatarContainerStyle}>
        <AvatarCanvas onSendSetModel={handleSendSetModelReady} />

        {showPicker && <ModelPickerOverlay />}

        {showPickerLoading && (
          <div style={connectingStyle}>
            <div style={connectingPillStyle}>Connecting...</div>
          </div>
        )}

        {/*
          StatusBadge and settings button are always shown when we have a token
          (even before model is selected) so the user can see connection state
          and access settings if something goes wrong during onboarding.
        */}
        <StatusBadge />
        {modelId && (
          <>
            <button
              style={settingsBtnStyle}
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
            >
              ⚙
            </button>
            <SettingsDrawer />
          </>
        )}
      </div>
    </WsContext.Provider>
  );
}
