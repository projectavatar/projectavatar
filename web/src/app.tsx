import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useIdleHide } from './hooks/use-idle-hide.ts';
import { useStore } from './state/store.ts';
import { TokenSetup } from './token-setup.tsx';
import { ModelPickerOverlay } from './model-picker-overlay.tsx';
import { AvatarCanvas, WsContext } from './avatar/avatar-canvas.tsx';
import type { WsContextValue } from './avatar/avatar-canvas.tsx';
import { StatusBadge } from './components/status-badge.tsx';
import { SettingsDrawer } from './components/settings-drawer.tsx';
import { DevPanel } from './components/dev-panel.tsx';
import type { StateMachine, EffectsManager } from '@project-avatar/avatar-engine';

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
 *    a. No channel_state yet (connecting or just connected) → canvas + "Connecting..." pill
 *    b. channel_state received + no model → ModelPickerOverlay
 *    c. channel_state received + model set → full avatar
 *
 * WsContext.Provider lives here — above BOTH AvatarCanvas and ModelPickerOverlay —
 * so siblings share the same sendSetModel. Do NOT move it into AvatarCanvas.
 *
 * Context value is memoized with [] (stable for App lifetime) — sendSetModel
 * reads from sendSetModelRef at call time, so the function identity is constant
 * even across WS reconnects. No wsReady state needed; the ref is the source
 * of truth and the warning covers the not-ready case.
 */
export function App() {
  const token                  = useStore((s) => s.token);
  const modelId                = useStore((s) => s.modelId);
  const theme                  = useStore((s) => s.theme);
  const channelStateReceived   = useStore((s) => s.channelStateReceived);
  const effects                 = useStore((s) => s.effects);
  const renderScale              = useStore((s) => s.renderScale);
  const setSettingsOpen        = useStore((s) => s.setSettingsOpen);

  // Auto-hide UI overlays after 5s of mouse inactivity
  const uiVisible = useIdleHide(1000);

  // Bridge: AvatarCanvas pushes its sendSetModel here via onSendSetModel prop.
  // Reading the ref at call time means the context value never needs to change.
  const sendSetModelRef = useRef<((modelId: string | null) => void) | null>(null);
  const stateMachineRef = useRef<StateMachine | null>(null);
  const effectsManagerRef = useRef<EffectsManager | null>(null);
  const [stateMachine, setStateMachine] = useState<StateMachine | null>(null);
  const [effectsManager, setEffectsManager] = useState<EffectsManager | null>(null);

  const handleSendSetModelReady = useCallback(
    (fn: ((modelId: string | null) => void) | null) => {
      sendSetModelRef.current = fn;
    },
    [],
  );

  const handleStateMachine = useCallback(
    (sm: StateMachine | null) => {
      stateMachineRef.current = sm;
      setStateMachine(sm);
    },
    [],
  );

  const handleEffectsManager = useCallback(
    (em: EffectsManager | null) => {
      effectsManagerRef.current = em;
      setEffectsManager(em);
    },
    [],
  );

  // Stable for App lifetime — reads ref at call time, never recreated.
  // No wsReady dependency needed; the warning covers the not-connected case.
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
    [], // stable for App lifetime
  );

  // Sync effects state from store to manager
  useEffect(() => {
    if (effectsManager) effectsManager.applyState(effects);
  }, [effectsManager, effects]);

  // Sync render scale — not available on sceneRef yet, pass via prop

  useEffect(() => {
    if (theme === 'transparent') {
      // Override global.css background on both html and body for true window transparency
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      document.documentElement.style.setProperty('--color-bg', 'transparent');
    } else {
      document.documentElement.style.background = '';
      document.body.style.background = '';
      document.documentElement.style.removeProperty('--color-bg');
    }
  }, [theme]);

  if (!token) return <TokenSetup />;

  // Gate picker on channelStateReceived, not just connectionState === 'connected'.
  // This prevents the picker from flashing open between onopen (connectionState flips
  // to 'connected') and the first message event (channel_state arrives).
  const showPicker   = channelStateReceived && !modelId;
  const showLoading  = !channelStateReceived;

  return (
    <WsContext.Provider value={wsContextValue}>
      <div style={avatarContainerStyle}>
        <AvatarCanvas onSendSetModel={handleSendSetModelReady} onStateMachine={handleStateMachine} onEffectsManager={handleEffectsManager} renderScale={renderScale} />

        {showPicker && <ModelPickerOverlay />}

        {showLoading && (
          <div style={connectingStyle}>
            <div style={connectingPillStyle}>Connecting...</div>
          </div>
        )}

        {/* StatusBadge always shown — user can see connection state during onboarding */}
        <StatusBadge />

        {modelId && (
          <>
            <button
              style={{
                ...settingsBtnStyle,
                opacity: uiVisible ? 1 : 0,
                transition: 'opacity 0.3s ease, border-color 0.15s',
                pointerEvents: uiVisible ? 'auto' : 'none',
              }}
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
            >
              ⚙
            </button>
            <SettingsDrawer />
          </>
        )}

        {/* Dev panel — toggle with backtick key */}
        <DevPanel stateMachine={stateMachine} />
      </div>
    </WsContext.Provider>
  );
}
