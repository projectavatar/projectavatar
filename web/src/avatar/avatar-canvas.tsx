import { useRef, useEffect, useState, createContext, useContext } from 'react';
import { useStore } from '../state/store.ts';
import { WebSocketClient } from '../ws/web-socket-client.ts';
import {
  AvatarScene,
  VrmManager,
  ExpressionController,
  AnimationController,
  BlinkController,
  PropManager,
  StateMachine,
  ClipRegistry,
} from '@project-avatar/avatar-engine';
import type { AvatarEvent, ChannelState } from '@project-avatar/shared';
import type { ClipsJsonData } from '@project-avatar/avatar-engine';

// Import clips data for the registry
import clipsData from '../data/clips.json';

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

// ─── WS Context ───────────────────────────────────────────────────────────────

export interface WsContextValue {
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

// ─── Clip Registry (singleton) ────────────────────────────────────────────────

const clipRegistry = new ClipRegistry(clipsData as ClipsJsonData);

// ─── AvatarCanvas ─────────────────────────────────────────────────────────────

export function AvatarCanvas({ onSendSetModel, onStateMachine }: {
  onSendSetModel?: (fn: ((modelId: string | null) => void) | null) => void;
  onStateMachine?: (sm: StateMachine | null) => void;
}) {
  const [animationsLoaded, setAnimationsLoaded] = useState(false);
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
      const animationController = new AnimationController(vrm, clipRegistry);
      animationController.loadAnimations()
        .then(() => setAnimationsLoaded(true))
        .catch((err) => {
          console.warn('[AvatarCanvas] Animation load failed:', err);
          setAnimationsLoaded(true);
        });
      const stateMachine = new StateMachine(
        new ExpressionController(vrm),
        animationController,
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
      onStateMachine?.(stateMachine);
      avatarScene.onUpdate((delta) => { vrmManager.update(delta); stateMachine.update(delta); });
    };

    let cancelled = false;

    const initModel = async () => {
      if (modelUrl) {
        try {
          const vrm = await vrmManager.load(modelUrl);
          if (cancelled) return;
          setupControllers(vrm);
        } catch (err) {
          if (cancelled) return;
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
      cancelled = true;
      onStateMachine?.(null);
      stateMachineRef.current?.dispose();
      stateMachineRef.current = null;
      avatarScene.dispose();
      vrmManager.dispose();
      sceneRef.current = null;
    };
  }, [modelUrl, setAvatarState]);

  // WebSocket lifecycle
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
      applyChannelState(data);
    };

    const onModelChanged = (model: string | null) => {
      setModelId(model);
    };

    const ws = new WebSocketClient(
      relayUrl, token, onEvent, onConnectionChange, onChannelState, onModelChanged,
    );
    wsRef.current = ws;

    setConnectionState('connecting');
    ws.connect();

    onSendSetModel?.((modelId) => wsRef.current?.sendSetModel(modelId));

    return () => {
      ws.disconnect();
      wsRef.current = null;
      onSendSetModel?.(null);
      resetConnectionState();
    };
  }, [token, relayUrl, setConnectionState, setReconnectAttempt, applyChannelState, setModelId, recordAgentEvent, resetConnectionState, onSendSetModel]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={canvasStyle} />
      {!animationsLoaded && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          color: 'var(--color-text-muted)', fontSize: 11, opacity: 0.6, pointerEvents: 'none',
        }}>
          loading animations…
        </div>
      )}
    </div>
  );
}
