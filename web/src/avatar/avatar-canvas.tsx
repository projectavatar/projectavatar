import { useRef, useEffect, useState, createContext, useContext } from 'react';
import * as THREE from 'three';
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
  VfxManager,
  ClipRegistry,
  EffectsManager,
} from '@project-avatar/avatar-engine';

import type { AvatarEvent, ChannelState } from '@project-avatar/shared';
import type { ClipsJsonData } from '@project-avatar/avatar-engine';

// Import clips data for the registry
import clipsData from '../data/clips.json';

const baseCanvasStyle: React.CSSProperties = {
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

const clipRegistry = new ClipRegistry(clipsData as unknown as ClipsJsonData);

// ─── AvatarCanvas ─────────────────────────────────────────────────────────────

export function AvatarCanvas({ onSendSetModel, onStateMachine, onEffectsManager, renderScale = 2 }: {
  onSendSetModel?: (fn: ((modelId: string | null) => void) | null) => void;
  onStateMachine?: (sm: StateMachine | null) => void;
  onEffectsManager?: (em: EffectsManager | null) => void;
  renderScale?: number;
}) {
  const [animationsLoaded, setAnimationsLoaded] = useState(false);
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const sceneRef        = useRef<AvatarScene | null>(null);
  const animControllerRef = useRef<AnimationController | null>(null);
  const wsRef           = useRef<WebSocketClient | null>(null);
  const stateMachineRef = useRef<StateMachine | null>(null);
  const effectsManagerRef = useRef<EffectsManager | null>(null);

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

    const avatarScene = new AvatarScene(canvas, { orbit: true, dev: import.meta.env.DEV });
    sceneRef.current  = avatarScene;

    // Eye lookAt proxy — blends between camera and cursor position
    const lookAtProxy = new THREE.Object3D();
    lookAtProxy.position.copy(avatarScene.camera.position);
    avatarScene.scene.add(lookAtProxy);

    const vrmManager  = new VrmManager(avatarScene.scene);

    const setupControllers = (vrm: import('@pixiv/three-vrm').VRM) => {
      const animationController = new AnimationController(vrm, clipRegistry);
      animControllerRef.current = animationController;
      animationController.loadAnimations()
        .then(() => {
          setAnimationsLoaded(true);
          // Reveal after the first mixer tick + 500ms for the T-pose→idle crossfade to settle
          animationController.onFirstFrame(() => {
            // 500ms: wait for T-pose→idle crossfade to settle, then reveal model
            setTimeout(() => {
              vrmManager.show();
            }, 500);
            // +500ms more before enabling effects (trails sample hand positions
            // during crossfade and create long streaks otherwise)
            setTimeout(() => {
              if (effectsManagerRef.current) {
                effectsManagerRef.current.setModelReady(true);
              }
            }, 1000);
          });
        })
        .catch((err) => {
          console.warn('[AvatarCanvas] Animation load failed:', err);
          document.title = `ANIM ERROR: ${err}`;
          setAnimationsLoaded(true);
          vrmManager.show(); // show anyway on failure
        });
      const stateMachine = new StateMachine(
        new ExpressionController(vrm),
        animationController,
        new BlinkController(vrm),
        new PropManager(avatarScene.scene),
        {
          onStateChange: (state) => setAvatarState({
            emotion: state.emotion, action: state.action,
            intensity: state.intensity,
          }),
        },
      );
      stateMachine.setCamera(avatarScene.camera);
      stateMachineRef.current = stateMachine;
      onStateMachine?.(stateMachine);

      // --- Emotion VFX ---
      const vfxMgr = new VfxManager(avatarScene.scene);
      const { emotionVfx, actionVfx } = clipRegistry.getVfxBindings();
      vfxMgr.loadBindings(emotionVfx, actionVfx);
      stateMachine.setVfxManager(vfxMgr);

      // ─── Effects ──────────────────────────────────────────────
      const effectsManager = new EffectsManager(
        vrm, avatarScene.scene, avatarScene.renderer, avatarScene.camera,
      );
      effectsManagerRef.current = effectsManager;
      onEffectsManager?.(effectsManager);

      // Integrate bloom: custom render through composer when active
      avatarScene.setCustomRender(() => {
        if (!effectsManager.renderBloom()) {
          avatarScene.renderer.render(avatarScene.scene, avatarScene.camera);
        }
      });

      // Resize bloom composer with renderer
      avatarScene.onResize((w, h) => effectsManager.setSize(w, h));

      avatarScene.onUpdate((delta) => {
        stateMachine.update(delta);
        effectsManager.update(delta);
        vrmManager.update(delta);
      });
    };

    let cancelled = false;

    const initModel = async () => {
      if (modelUrl) {
        try {
          const vrm = await vrmManager.load(modelUrl);
          if (cancelled) return;
          vrmManager.setLookAtTarget(lookAtProxy);
          // Dynamic framing: zoomed out → body center, zoomed in → face
          avatarScene.setFramingPoints(vrmManager.bodyCenter, vrmManager.faceCenter);
          setupControllers(vrm);
        } catch (err) {
          if (cancelled) return;
          console.warn('[AvatarCanvas] Failed to load VRM:', err);
          document.title = `VRM LOAD ERROR: ${err}`;
          vrmManager.showPlaceholder();
          avatarScene.onUpdate((delta) => vrmManager.update(delta));
        }
      } else {
        vrmManager.showPlaceholder();
        avatarScene.onUpdate((delta) => vrmManager.update(delta));
      }
    };

    void initModel();

    const cursorTarget = new THREE.Vector3();
    let lastCursorMove = 0;
    const EYE_IDLE_TIMEOUT = 5000;

    // Smooth eye tracking — lerp proxy position toward target each frame
    const eyeGoal = new THREE.Vector3();
    avatarScene.onUpdate((dt) => {
      const ctrl = animControllerRef.current;
      // Respect bypass flag — some clips disable head/eye tracking
      if (ctrl?.isHeadTrackingBypassed) {
        lookAtProxy.position.lerp(avatarScene.camera.position, 1 - Math.exp(-2.0 * dt));
        return;
      }
      const now = performance.now();
      const cursorActive = lastCursorMove > 0 && (now - lastCursorMove < EYE_IDLE_TIMEOUT);

      // Compute goal: cursor target or camera
      // Dead zone: if cursor target is close to camera-to-origin line, look at camera
      // (prevents jitter when cursor crosses directly over the model)
      if (cursorActive && cursorTarget.distanceTo(avatarScene.camera.position) > 0.5) {
        eyeGoal.copy(cursorTarget);
      } else {
        eyeGoal.copy(avatarScene.camera.position);
      }

      // Smooth lerp toward goal — eyes follow at a natural pace
      const speed = 0.8;
      const t = 1 - Math.exp(-speed * dt);
      lookAtProxy.position.lerp(eyeGoal, t);
    });

    avatarScene.start();

    // ── Cursor → head + eye tracking ─────────────────────────────────
    // Pre-allocated objects for cursor→world projection (avoids GC pressure)
    const _raycaster = new THREE.Raycaster();
    const _ndcVec = new THREE.Vector2();
    const _camDir = new THREE.Vector3();
    const _planePos = new THREE.Vector3();
    const _plane = new THREE.Plane();

    /** Project screen NDC to 3D world point and update cursor target. */
    const projectCursor = (ndcX: number, ndcY: number) => {
      const ctrl = animControllerRef.current;
      if (!ctrl) return;
      const cam = avatarScene.camera;
      cam.getWorldDirection(_camDir);
      // Plane 50% between camera and origin, facing camera direction
      _planePos.copy(cam.position).lerp(_planePos.set(0, 0, 0), 0.5);
      _plane.setFromNormalAndCoplanarPoint(_camDir, _planePos);
      _ndcVec.set(ndcX, ndcY);
      _raycaster.setFromCamera(_ndcVec, cam);
      if (_raycaster.ray.intersectPlane(_plane, cursorTarget)) {
        ctrl.setCursorTarget(cursorTarget);
        lastCursorMove = performance.now();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      projectCursor(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    let cursorPollId: ReturnType<typeof setInterval> | null = null;

    const onMouseLeave = () => {
      lastCursorMove = 0;
      animControllerRef.current?.setCursorTarget(null);
    };

    // Start with web mousemove, upgrade to Tauri global polling if available
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);

    // Try Tauri global cursor — probe with real invoke before committing
    import('@tauri-apps/api/core').then(async ({ invoke }) => {
      try {
        await invoke<[number, number]>('get_cursor_position');
      } catch {
        return; // Not in Tauri runtime
      }
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);

      const win = getCurrentWindow();
      let prevScreenX = -1;
      let prevScreenY = -1;
      const poll = async () => {
        try {
          const [screenX, screenY] = await invoke<[number, number]>('get_cursor_position');
          if (screenX === -1 && screenY === -1) return;
          // Only update if cursor actually moved
          if (screenX === prevScreenX && screenY === prevScreenY) return;
          prevScreenX = screenX;
          prevScreenY = screenY;
          const pos = await win.outerPosition();
          const size = await win.outerSize();
          const scale = await win.scaleFactor();
          const w = size.width / scale;
          const h = size.height / scale;
          projectCursor(
            Math.max(-2, Math.min(2, ((screenX - pos.x) / scale / w) * 2 - 1)),
            Math.max(-2, Math.min(2, -(((screenY - pos.y) / scale / h) * 2 - 1))),
          );
        } catch { /* poll error — skip frame */ }
      };
      cursorPollId = setInterval(poll, 32); // ~30Hz
    }).catch(() => {});

    return () => {
      if (cursorPollId) clearInterval(cursorPollId);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      avatarScene.scene.remove(lookAtProxy);
      cancelled = true;
      onStateMachine?.(null);
      onEffectsManager?.(null);
      stateMachineRef.current?.dispose();
      stateMachineRef.current = null;
      effectsManagerRef.current?.dispose();
      effectsManagerRef.current = null;
      avatarScene.dispose();
      vrmManager.dispose();
      sceneRef.current = null;
    };
  }, [modelUrl, setAvatarState]);

  // Sync render scale (pixel ratio)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.renderer.setPixelRatio(renderScale);
    // Force resize to apply
    const canvas = scene.renderer.domElement;
    scene.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }, [renderScale]);

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
      <canvas ref={canvasRef} style={{
        ...baseCanvasStyle,
        
      }} />
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
