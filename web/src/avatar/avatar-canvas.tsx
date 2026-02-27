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

// ─── WS Context — exposes sendSetModel to any descendant ──────────────────────

interface WsContextValue {
  /** Send a set_model message to the relay DO. No-op if not connected. */
  sendSetModel: (modelId: string | null) => void;
}

const WsContext = createContext<WsContextValue>({
  sendSetModel: () => {},
});

export function useWsClient(): WsContextValue {
  return useContext(WsContext);
}

// ─── AvatarCanvas ─────────────────────────────────────────────────────────────

/**
 * Three.js canvas wrapper — mounts the scene, VRM manager,
 * all controllers, and the WebSocket client.
 *
 * Provides a `WsContext` so descendant components (model pickers, settings)
 * can call `sendSetModel` without prop drilling.
 *
 * Model lifecycle:
 * - On mount, the VRM is loaded from `modelUrl` (optimistic cache from localStorage)
 * - When `channel_state` arrives from the DO, `applyChannelState` updates the store
 * - If modelUrl changes, this component re-mounts the Three.js scene with the new model
 * - The DO is the source of truth for model selection
 */
export function AvatarCanvas() {
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
    if (!token) return;

    const onEvent = (event: AvatarEvent) => {
      stateMachineRef.current?.handleEvent(event);
      recordAgentEvent(); // Update presence timestamp live as events arrive
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
      // DO is source of truth — apply its state, overwriting local cache
      applyChannelState(data);
    };

    const onModelChanged = (model: string | null) => {
      // Broadcast from DO: another client changed the model (or echo of our own set_model)
      // setModelId updates store + localStorage; modelUrl change triggers scene re-mount
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
    setConnectionState('connecting');
    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [token, relayUrl, setConnectionState, setReconnectAttempt, applyChannelState, setModelId, recordAgentEvent]);

  const wsContextValue: WsContextValue = {
    sendSetModel: (modelId) => {
      wsRef.current?.sendSetModel(modelId);
    },
  };

  return (
    <WsContext.Provider value={wsContextValue}>
      <canvas ref={canvasRef} style={canvasStyle} />
    </WsContext.Provider>
  );
}
