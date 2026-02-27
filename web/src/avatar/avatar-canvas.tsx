import { useRef, useEffect, createContext, useContext } from 'react';
import { useStore } from '../state/store.ts';
import { WebSocketClient } from '../ws/web-socket-client.ts';
import { AvatarScene } from './avatar-scene.ts';
import { VrmManager } from './vrm-manager.ts';
import { ExpressionController } from './expression-controller.ts';
import { AnimationController } from './animation-controller.ts';
import { BlinkController } from './blink-controller.ts';
import { PropManager } from './prop-manager.ts';
import { StateMachine } from './state-machine.ts';
import type { AvatarEvent, ChannelState } from '@project-avatar/shared';

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

// ─── WS Context ───────────────────────────────────────────────────────────────
//
// Provides `sendSetModel` to any component in the tree — consumed by
// ModelPickerOverlay and SettingsDrawer.
//
// IMPORTANT: The Provider must be rendered at the App level (above both
// AvatarCanvas and ModelPickerOverlay). ModelPickerOverlay is a sibling of
// AvatarCanvas, not a descendant — a provider inside AvatarCanvas would be
// invisible to it.
//
// Context is created here (co-located with the WS client), but the Provider
// is in app.tsx. AvatarCanvas exposes sendSetModel via the onSendSetModel prop,
// which app.tsx stores in a ref and delegates to via the stable context value.

export interface WsContextValue {
  /** Send a set_model message to the relay DO. Warns if not connected. */
  sendSetModel: (modelId: string | null) => void;
}

export const WsContext = createContext<WsContextValue>({
  sendSetModel: () => {
    console.warn('[WsContext] sendSetModel called outside WsContext.Provider — is the provider mounted?');
  },
});

export function useWsClient(): WsContextValue {
  return useContext(WsContext);
}

// ─── AvatarCanvas ─────────────────────────────────────────────────────────────

/**
 * Three.js canvas + WebSocket client.
 *
 * Does NOT provide WsContext — that lives in app.tsx so siblings
 * (ModelPickerOverlay, SettingsDrawer) can share the same sendSetModel.
 *
 * Bridge pattern: AvatarCanvas calls `onSendSetModel(fn)` when the WS client
 * is ready and `onSendSetModel(null)` on disconnect. app.tsx stores this in a
 * ref and delegates from the stable WsContext value.
 */
export function AvatarCanvas({ onSendSetModel }: {
  onSendSetModel?: (fn: ((modelId: string | null) => void) | null) => void;
}) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const sceneRef        = useRef<AvatarScene | null>(null);
  const wsRef           = useRef<WebSocketClient | null>(null);
  const stateMachineRef = useRef<StateMachine | null>(null);

  const token                = useStore((s) => s.token);
  const relayUrl             = useStore((s) => s.relayUrl);
  const modelUrl             = useStore((s) => s.modelUrl);
  const setConnectionState   = useStore((s) => s.setConnectionState);
  const setReconnectAttempt  = useStore((s) => s.setReconnectAttempt);
  const setAvatarState       = useStore((s) => s.setAvatarState);
  const applyChannelState    = useStore((s) => s.applyChannelState);
  const setModelId           = useStore((s) => s.setModelId);
  const recordAgentEvent     = useStore((s) => s.recordAgentEvent);
  const resetConnectionState = useStore((s) => s.resetConnectionState);

  // Scene lifecycle — re-runs when modelUrl changes (new VRM to load)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const avatarScene = new AvatarScene(canvas);
    sceneRef.current  = avatarScene;
    const vrmManager  = new VrmManager(avatarScene.scene);

    const setupControllers = (vrm: import('@pixiv/three-vrm').VRM) => {
      const stateMachine = new StateMachine(
        new ExpressionController(vrm),
        new AnimationController(vrm),
        new BlinkController(vrm),
        new PropManager(vrm),
        {
          onStateChange: (state) => setAvatarState({
            emotion: state.emotion, action: state.action,
            prop: state.prop, intensity: state.intensity,
          }),
        },
      );
      stateMachineRef.current = stateMachine;
      avatarScene.onUpdate((delta) => { vrmManager.update(delta); stateMachine.update(delta); });
    };

    const initModel = async () => {
      if (modelUrl) {
        try {
          const vrm = await vrmManager.load(modelUrl);
          setupControllers(vrm);
        } catch (err) {
          console.warn('[AvatarCanvas] Failed to load VRM:', err);
          vrmManager.showPlaceholder();
          avatarScene.onUpdate((delta) => vrmManager.update(delta));
        }
      } else {
        vrmManager.showPlaceholder();
        avatarScene.onUpdate((delta) => vrmManager.update(delta));
      }
    };

    void initModel();
    avatarScene.start();

    return () => {
      stateMachineRef.current?.dispose();
      stateMachineRef.current = null;
      avatarScene.dispose();
      vrmManager.dispose();
      sceneRef.current = null;
    };
  }, [modelUrl, setAvatarState]);

  // WebSocket lifecycle — re-runs when token or relayUrl changes
  useEffect(() => {
    if (!token) {
      onSendSetModel?.(null);
      resetConnectionState();
      return;
    }

    const onEvent = (event: AvatarEvent) => {
      stateMachineRef.current?.handleEvent(event);
      recordAgentEvent();
    };

    const onConnectionChange = (
      state: 'connected' | 'disconnected' | 'reconnecting',
      attempt?: number,
    ) => {
      if (state === 'disconnected' || state === 'reconnecting') {
        // Clear channelStateReceived so the picker gate resets correctly.
        // On reconnect, channel_state will arrive fresh and set it back to true.
        resetConnectionState();
      }
      setConnectionState(
        state === 'connected' ? 'connected'
          : state === 'reconnecting' ? 'reconnecting'
          : 'disconnected',
      );
      setReconnectAttempt(attempt ?? 0);
    };

    const onChannelState = (data: ChannelState & { lastEvent: AvatarEvent | null }) => {
      applyChannelState(data); // sets channelStateReceived = true
    };

    const onModelChanged = (model: string | null) => {
      setModelId(model);
    };

    const ws = new WebSocketClient(
      relayUrl, token, onEvent, onConnectionChange, onChannelState, onModelChanged,
    );
    wsRef.current = ws;

    setConnectionState('connecting');
    ws.connect(); // connect first, then advertise sendSetModel

    // Expose sendSetModel AFTER connect() — WS is now dialing.
    // Stable arrow — reads wsRef.current at call time, not captured here.
    onSendSetModel?.((modelId) => wsRef.current?.sendSetModel(modelId));

    return () => {
      ws.disconnect();
      wsRef.current = null;
      onSendSetModel?.(null);
      resetConnectionState();
    };
  }, [token, relayUrl, setConnectionState, setReconnectAttempt, applyChannelState, setModelId, recordAgentEvent, resetConnectionState, onSendSetModel]);

  return <canvas ref={canvasRef} style={canvasStyle} />;
}
