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
  const theme            = useStore((s) => s.theme);
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
      const now = performance.now();
      const cursorActive = lastCursorMove > 0 && (now - lastCursorMove < EYE_IDLE_TIMEOUT);

      // Compute goal: cursor target (with 2x overshoot) or camera
      if (cursorActive) {
        eyeGoal.copy(cursorTarget).sub(avatarScene.camera.position).multiplyScalar(1.5).add(avatarScene.camera.position);
      } else {
        eyeGoal.copy(avatarScene.camera.position);
      }

      // Smooth lerp toward goal — eyes follow at a natural pace
      const speed = cursorActive ? 4.0 : 2.0;
      const t = 1 - Math.exp(-speed * dt);
      lookAtProxy.position.lerp(eyeGoal, t);
    });

    avatarScene.start();

    // ── Cursor → head + eye tracking ─────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    // Dynamic plane — always halfway between camera and origin,
    // facing the camera. Scales with zoom level.
    const targetPlane = new THREE.Plane();


    const onMouseMove = (e: MouseEvent) => {
      const ctrl = animControllerRef.current;
      if (!ctrl) return;
      const rect = canvas.getBoundingClientRect();
      mouseNDC.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      // Place plane parallel to screen, passing through camera position.
      // This maps cursor movement to screen-space directions.
      const cam = avatarScene.camera;
      const camDir = new THREE.Vector3();
      cam.getWorldDirection(camDir);
      // Plane slightly in front of camera (10% toward origin), facing camera direction
      const planePos = cam.position.clone().lerp(new THREE.Vector3(0, 0, 0), 0.5);
      targetPlane.setFromNormalAndCoplanarPoint(camDir, planePos);


      raycaster.setFromCamera(mouseNDC, cam);
      if (raycaster.ray.intersectPlane(targetPlane, cursorTarget)) {
        ctrl.setCursorTarget(cursorTarget);
        lastCursorMove = performance.now();
      }
    };
    // Desktop (Tauri): poll global cursor position via Rust plugin
    // Web: use mousemove event (cursor only tracked inside window)
    let cursorPollId: ReturnType<typeof setInterval> | null = null;

    const onMouseLeave = () => {
      // Cursor left the window — clear target so head/eyes return to camera
      lastCursorMove = 0;
      animControllerRef.current?.setCursorTarget(null);
    };

    // Start with web mousemove, upgrade to Tauri global polling if available
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);

    // Try to enable Tauri global cursor tracking (replaces mousemove)
    import('@tauri-apps/api/core').then(({ invoke }) => {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        console.log('[CursorTrack] Tauri detected — switching to global cursor polling');
        // Remove web listeners — Tauri handles everything
        window.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseleave', onMouseLeave);

        const win = getCurrentWindow();
        const poll = async () => {
          try {
            const [screenX, screenY] = await invoke<[number, number]>('get_cursor_position');
            const pos = await win.outerPosition();
            const size = await win.outerSize();
            const scale = await win.scaleFactor();

            const relX = (screenX - pos.x) / scale;
            const relY = (screenY - pos.y) / scale;
            const w = size.width / scale;
            const h = size.height / scale;

            const ndcX = Math.max(-2, Math.min(2, (relX / w) * 2 - 1));
            const ndcY = Math.max(-2, Math.min(2, -(relY / h) * 2 + 1));

            const cam = avatarScene.camera;
            const camDir = new THREE.Vector3();
            cam.getWorldDirection(camDir);
            const planePos = cam.position.clone().lerp(new THREE.Vector3(0, 0, 0), 0.5);
            const plane = new THREE.Plane();
            plane.setFromNormalAndCoplanarPoint(camDir, planePos);

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
            if (raycaster.ray.intersectPlane(plane, cursorTarget)) {
              animControllerRef.current?.setCursorTarget(cursorTarget);
              lastCursorMove = performance.now();
            }
          } catch (err) { console.error('[CursorPoll]', err); }
        };
        cursorPollId = setInterval(poll, 50);
      });
    }).catch(() => {
      // Not in Tauri — web mousemove stays active
    });

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
