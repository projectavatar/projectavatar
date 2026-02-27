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
// AvatarCanvas and ModelPickerOverlay), NOT inside AvatarCanvas itself.
// ModelPickerOverlay is a sibling of AvatarCanvas, not a descendant, so a
// provider inside AvatarCanvas would never be seen by it.
//
// The context is created here (co-located with the WebSocket client that owns
// the ref), but the Provider is in app.tsx. AvatarCanvas registers its
// sendSetModel via `useWsRegistry` so app.tsx can surface it through the context.

export interface WsContextValue {
  /** Send a set_model message to the relay DO. Logs a warning if not connected. */
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
 * Renders the VRM scene and manages the WebSocket lifecycle. Does NOT provide
 * WsContext itself — that provider lives in app.tsx above both AvatarCanvas
 * and ModelPickerOverlay so siblings can share the same context.
 *
 * The `onSendSetModel` prop is the bridge: AvatarCanvas calls it with a stable
 * function reference when the WS client is ready, so app.tsx can wire it into
 * the WsContext value.
 */
export function AvatarCanvas({ onSendSetModel }: {
  onSendSetModel?: (fn: ((modelId: string | null) => void) | null) => void;
}) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const sceneRef        = useRef<AvatarScene | null>(null);
  const wsRef           = useRef<WebSocketClient | null>(null);
  const stateMachineRef = useRef<StateMachine | null>(null);

  const token               = useStore((s) => s.token);
  const relayUrl            = useStore((s) => s.relayUrl);
  const modelUrl            = useStore((s) => s.modelUrl);
  const setConnectionState  = useStore((s) => s.setConnectionState);
  const setReconnectAttempt = useStore((s) => s.setReconnectAttempt);
  const setAvatarState      = useStore((s) => s.setAvatarState);
  const applyChannelState   = useStore((s) => s.applyChannelState);
  const setModelId          = useStore((s) => s.setModelId);
  const recordAgentEvent    = useStore((s) => s.recordAgentEvent);

  // Initialize scene + avatar system. Re-runs when modelUrl changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const avatarScene = new AvatarScene(canvas);
    sceneRef.current  = avatarScene;
    const vrmManager  = new VrmManager(avatarScene.scene);

    const setupControllers = (vrm: import('@pixiv/three-vrm').VRM) => {
      const expressionCtrl = new ExpressionController(vrm);
      const animationCtrl  = new AnimationController(vrm);
      const blinkCtrl      = new BlinkController(vrm);
      const propManager    = new PropManager(vrm);

      const stateMachine = new StateMachine(
        expressionCtrl,
        animationCtrl,
        blinkCtrl,
        propManager,
        {
          onStateChange: (state) => {
            setAvatarState({
              emotion:   state.emotion,
              action:    state.action,
              prop:      state.prop,
              intensity: state.intensity,
            });
          },
        },
      );
      stateMachineRef.current = stateMachine;
      avatarScene.onUpdate((delta) => {
        vrmManager.update(delta);
        stateMachine.update(delta);
      });
    };

    const initModel = async () => {
      if (modelUrl) {
        try {
          const vrm = await vrmManager.load(modelUrl);
          setupControllers(vrm);
        } catch (err) {
          console.warn('[AvatarCanvas] Failed to load VRM model, using placeholder:', err);
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

  // WebSocket connection lifecycle. Re-runs when token or relayUrl changes.
  useEffect(() => {
    if (!token) {
      // No token — clear sendSetModel from parent context
      onSendSetModel?.(null);
      return;
    }

    const onEvent = (event: AvatarEvent) => {
      stateMachineRef.current?.handleEvent(event);
      // recordAgentEvent updates lastAgentEventAt + sets agentPresence to 'active'.
      // Note: this is also called for replayed lastEvent on connect, which is intentional —
      // if the DO has a recent lastEvent, presence should reflect that via lastAgentEventAt
      // (already applied in applyChannelState). The replay sets the visual pose only.
      // agentPresence staleness is handled by StatusBadge computing it from lastAgentEventAt.
      recordAgentEvent();
    };

    const onConnectionChange = (
      state: 'connected' | 'disconnected' | 'reconnecting',
      attempt?: number,
    ) => {
      setConnectionState(
        state === 'connected' ? 'connected'
          : state === 'reconnecting' ? 'reconnecting'
          : 'disconnected',
      );
      setReconnectAttempt(attempt ?? 0);
    };

    const onChannelState = (data: ChannelState & { lastEvent: AvatarEvent | null }) => {
      applyChannelState(data);
    };

    const onModelChanged = (model: string | null) => {
      setModelId(model);
    };

    const ws = new WebSocketClient(
      relayUrl,
      token,
      onEvent,
      onConnectionChange,
      onChannelState,
      onModelChanged,
    );
    wsRef.current = ws;

    // Expose sendSetModel to parent (app.tsx → WsContext.Provider)
    // Stable arrow function — wsRef.current is read at call time, not captured
    onSendSetModel?.((modelId) => wsRef.current?.sendSetModel(modelId));

    setConnectionState('connecting');
    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
      onSendSetModel?.(null);
    };
  }, [token, relayUrl, setConnectionState, setReconnectAttempt, applyChannelState, setModelId, recordAgentEvent, onSendSetModel]);

  return <canvas ref={canvasRef} style={canvasStyle} />;
}
