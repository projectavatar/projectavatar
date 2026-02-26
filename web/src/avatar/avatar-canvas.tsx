import { useRef, useEffect } from 'react';
import { useStore } from '../state/store.ts';
import { WebSocketClient } from '../ws/web-socket-client.ts';
import { AvatarScene } from './avatar-scene.ts';
import { VrmManager } from './vrm-manager.ts';
import { ExpressionController } from './expression-controller.ts';
import { AnimationController } from './animation-controller.ts';
import { BlinkController } from './blink-controller.ts';
import { PropManager } from './prop-manager.ts';
import { StateMachine } from './state-machine.ts';
import type { AvatarEvent } from '@project-avatar/shared';

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

/**
 * Three.js canvas wrapper — mounts the scene, VRM manager,
 * all controllers, and the WebSocket client. This is the heart of the app.
 */
export function AvatarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<AvatarScene | null>(null);
  const wsRef = useRef<WebSocketClient | null>(null);
  const stateMachineRef = useRef<StateMachine | null>(null);

  const token = useStore((s) => s.token);
  const relayUrl = useStore((s) => s.relayUrl);
  const modelUrl = useStore((s) => s.modelUrl);
  const setConnectionState = useStore((s) => s.setConnectionState);
  const setReconnectAttempt = useStore((s) => s.setReconnectAttempt);
  const setAvatarState = useStore((s) => s.setAvatarState);

  // Initialize scene + avatar system
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const avatarScene = new AvatarScene(canvas);
    sceneRef.current = avatarScene;

    const vrmManager = new VrmManager(avatarScene.scene);

    // Try loading VRM, fall back to placeholder
    const initModel = async () => {
      if (modelUrl) {
        try {
          const vrm = await vrmManager.load(modelUrl);
          setupControllers(avatarScene, vrm);
        } catch (err) {
          console.warn('[AvatarCanvas] Failed to load VRM model, using placeholder:', err);
          vrmManager.showPlaceholder();
          setupPlaceholderLoop(avatarScene, vrmManager);
        }
      } else {
        vrmManager.showPlaceholder();
        setupPlaceholderLoop(avatarScene, vrmManager);
      }
    };

    const setupControllers = (scene: AvatarScene, vrm: import('@pixiv/three-vrm').VRM) => {
      const expressionCtrl = new ExpressionController(vrm);
      const animationCtrl = new AnimationController(vrm);
      const blinkCtrl = new BlinkController(vrm);
      const propManager = new PropManager(vrm);

      const stateMachine = new StateMachine(
        expressionCtrl,
        animationCtrl,
        blinkCtrl,
        propManager,
        {
          onStateChange: (state) => {
            setAvatarState({
              emotion: state.emotion,
              action: state.action,
              prop: state.prop,
              intensity: state.intensity,
            });
          },
        },
      );
      stateMachineRef.current = stateMachine;

      // Register the update loop
      const updateFn = (delta: number) => {
        vrmManager.update(delta);
        stateMachine.update(delta);
      };
      scene.onUpdate(updateFn);
    };

    const setupPlaceholderLoop = (scene: AvatarScene, manager: VrmManager) => {
      const updateFn = (delta: number) => {
        manager.update(delta);
      };
      scene.onUpdate(updateFn);
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

  // WebSocket connection lifecycle
  useEffect(() => {
    if (!token) return;

    const onEvent = (event: AvatarEvent) => {
      stateMachineRef.current?.handleEvent(event);
    };

    const onConnectionChange = (
      state: 'connected' | 'disconnected' | 'reconnecting',
      attempt?: number,
    ) => {
      setConnectionState(state === 'connected' ? 'connected' : state === 'reconnecting' ? 'reconnecting' : 'disconnected');
      if (attempt !== undefined) {
        setReconnectAttempt(attempt);
      } else {
        setReconnectAttempt(0);
      }
    };

    const ws = new WebSocketClient(relayUrl, token, onEvent, onConnectionChange);
    wsRef.current = ws;
    setConnectionState('connecting');
    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [token, relayUrl, setConnectionState, setReconnectAttempt]);

  return <canvas ref={canvasRef} style={canvasStyle} />;
}
