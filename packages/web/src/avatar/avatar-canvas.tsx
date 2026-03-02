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
  AssetResolver,
} from '@project-avatar/avatar-engine';

import type { AvatarEvent, ChannelState } from '@project-avatar/shared';
import type { ClipsJsonData } from '@project-avatar/avatar-engine';
import { LoadingOverlay } from '../components/loading-overlay.tsx';
import type { LoadingState } from '../components/loading-overlay.tsx';

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

export function AvatarCanvas({ onSendSetModel, onStateMachine, onEffectsManager, onScene, cursorPollMs, externalCursorPoll, onProjectCursor, renderScale = 2 }: {
  onSendSetModel?: (fn: ((modelId: string | null) => void) | null) => void;
  onStateMachine?: (sm: StateMachine | null) => void;
  onEffectsManager?: (em: EffectsManager | null) => void;
  /** Callback with the AvatarScene instance (exposes camera, scene, VRM root). */
  onScene?: (scene: AvatarScene | null) => void;
  /** Override Tauri cursor poll interval in ms (default: 32). */
  cursorPollMs?: number;
  /** When true, skip built-in Tauri cursor polling (external consumer drives it). */
  externalCursorPoll?: boolean;
  /** Callback to receive the projectCursor function for external cursor input. */
  onProjectCursor?: (fn: ((ndcX: number, ndcY: number) => void) | null) => void;
  renderScale?: number;
}) {
  const [animationsLoaded, setAnimationsLoaded] = useState(false);
  const [loadingState, setLoadingState] = useState<LoadingState>({ label: 'loading model', progress: null, done: false });
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const sceneRef        = useRef<AvatarScene | null>(null);
  const animControllerRef = useRef<AnimationController | null>(null);
  const wsRef           = useRef<WebSocketClient | null>(null);
  const stateMachineRef = useRef<StateMachine | null>(null);
  const effectsManagerRef = useRef<EffectsManager | null>(null);
  const assetResolverRef = useRef<AssetResolver | null>(null);

  const token                = useStore((s) => s.token);
  const relayUrl             = useStore((s) => s.relayUrl);
  const modelUrl             = useStore((s) => s.modelUrl);
  const assetBaseUrl         = useStore((s) => s.assetBaseUrl);
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
    onScene?.(avatarScene);

    // Eye lookAt proxy — blends between camera and cursor position
    const lookAtProxy = new THREE.Object3D();
    lookAtProxy.position.copy(avatarScene.camera.position);
    avatarScene.scene.add(lookAtProxy);

    const vrmManager  = new VrmManager(avatarScene.scene);

    // Asset resolver — desktop sets assetBaseUrl to fetch from web CDN
    // Stored in ref so blob URLs survive the full scene lifecycle
    assetResolverRef.current?.dispose();
    const assetResolver = assetBaseUrl
      ? new AssetResolver({ baseUrl: assetBaseUrl })
      : null;
    assetResolverRef.current = assetResolver;

    const setupControllers = (vrm: import('@pixiv/three-vrm').VRM) => {
      const animationController = new AnimationController(vrm, clipRegistry, assetResolver ?? undefined);
      animControllerRef.current = animationController;
      // Track animation loading progress
      const totalClips = clipRegistry.getAllClipFiles().length;
      let loadedClips = 0;
      animationController.onClipLoaded = () => {
        loadedClips++;
        setLoadingState({
          label: 'loading animations',
          progress: 0.65 + (loadedClips / totalClips) * 0.35,
          done: false,
        });
      };

      setLoadingState({ label: 'loading animations', progress: 0.65, done: false });
      animationController.loadAnimations()
        .then(() => {
          setAnimationsLoaded(true);
          setLoadingState({ label: '', progress: 1, done: true });
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
          setLoadingState({ label: '', progress: 1, done: true });
          vrmManager.show(); // show anyway on failure
        });
      const stateMachine = new StateMachine(
        new ExpressionController(vrm),
        animationController,
        new BlinkController(vrm),
        new PropManager(avatarScene.scene, assetResolver ?? undefined),
        {
          onStateChange: (state) => setAvatarState({
            emotions: state.emotions, action: state.action,
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
          setLoadingState({ label: 'loading model', progress: 0, done: false });
          const resolvedModelUrl = assetResolver
            ? await assetResolver.resolve(modelUrl)
            : modelUrl;
          const vrm = await vrmManager.load(resolvedModelUrl, (pct) => {
            setLoadingState({ label: 'loading model', progress: pct * 0.65, done: false });
          });
          if (cancelled) return;
          vrmManager.setLookAtTarget(lookAtProxy);
          avatarScene.setVrmRoot(vrm.scene);
          // Dynamic framing: zoomed out → body center, zoomed in → face
          avatarScene.setFramingPoints(vrmManager.bodyCenter, vrmManager.faceCenter);
          // Set clamp bones: head for vertical, hips for horizontal
          const headBone = vrm.humanoid?.getNormalizedBoneNode('head') ?? null;
          const hipsBone = vrm.humanoid?.getNormalizedBoneNode('hips') ?? null;
          avatarScene.setClampBones(headBone, hipsBone);
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

    // Cursor tracking constants
    const EYE_IDLE_TIMEOUT = 5000;  // ms before eyes return to camera
    const EYE_LERP_SPEED = 3;      // eye follow responsiveness
    const EYE_BYPASS_SPEED = 2.0;  // speed when head tracking bypassed
    const NDC_CLAMP = 2;           // clamp NDC range for offscreen cursor
    const CURSOR_POLL_MS = cursorPollMs ?? 32;     // configurable cursor polling rate

    const cursorTarget = new THREE.Vector3();
    let lastCursorMove = 0;

    // Smooth eye tracking + zoom-aware idle mode — runs every frame.
    // Cleaned up via avatarScene.dispose() which clears all update callbacks.
    const eyeGoal = new THREE.Vector3();
    const _shinWorldPos = new THREE.Vector3();
    const _shinProjected = new THREE.Vector3();
    // Cached bone refs — populated after VRM load, avoids per-frame lookups
    let _legBones: Array<{ knee: THREE.Object3D; foot: THREE.Object3D }> | null = null;
    avatarScene.onUpdate((dt) => {
      const ctrl = animControllerRef.current;

      // Switch idle mode based on mid-shin visibility.
      // Mid-shin visible → air mode (dangling legs look intentional).
      // Mid-shin off-screen → ground mode (hides feet issues).
      if (ctrl) {
        // Cache bone refs on first access
        if (!_legBones) {
          const humanoid = vrmManager.vrm?.humanoid;
          if (humanoid) {
            _legBones = [];
            for (const side of ['left', 'right'] as const) {
              const knee = humanoid.getNormalizedBoneNode(side === 'left' ? 'leftLowerLeg' : 'rightLowerLeg');
              const foot = humanoid.getNormalizedBoneNode(side === 'left' ? 'leftFoot' : 'rightFoot');
              if (knee && foot) _legBones.push({ knee, foot });
            }
          }
        }
        let kneeVisible = false;
        if (_legBones) {
          for (const { knee, foot } of _legBones) {
            knee.getWorldPosition(_shinWorldPos);
            foot.getWorldPosition(_shinProjected);
            // Midpoint between knee and foot (mid-shin)
            _shinWorldPos.lerp(_shinProjected, 0.5);
            _shinProjected.copy(_shinWorldPos).project(avatarScene.camera);
            if (_shinProjected.y > -1) { kneeVisible = true; break; }
          }
        }
        const wantGround = !kneeVisible;
        const currentMode = ctrl.getIdleMode();
        if (wantGround && currentMode === 'air') {
          ctrl.setIdleMode('ground');
        } else if (!wantGround && currentMode === 'ground') {
          ctrl.setIdleMode('air');
        }
      }

      // Respect bypass flag — some clips disable head/eye tracking
      if (ctrl?.isHeadTrackingBypassed) {
        lookAtProxy.position.lerp(avatarScene.camera.position, 1 - Math.exp(-EYE_BYPASS_SPEED * dt));
        return;
      }
      const now = performance.now();
      const cursorActive = lastCursorMove > 0 && (now - lastCursorMove < EYE_IDLE_TIMEOUT);

      // Compute goal: cursor target or camera
      if (cursorActive) {
        eyeGoal.copy(cursorTarget);
      } else {
        eyeGoal.copy(avatarScene.camera.position);
      }

      // Smooth lerp toward goal — eyes follow at a natural pace
      const t = 1 - Math.exp(-EYE_LERP_SPEED * dt);
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
      // Plane 10% from camera toward origin
      _planePos.copy(cam.position).multiplyScalar(0.1);
      _plane.setFromNormalAndCoplanarPoint(_camDir, _planePos);
      _ndcVec.set(ndcX, ndcY);
      _raycaster.setFromCamera(_ndcVec, cam);
      if (_raycaster.ray.intersectPlane(_plane, cursorTarget)) {
        ctrl.setCursorTarget(cursorTarget);
        lastCursorMove = performance.now();
      }
    };

    // Expose projectCursor to external consumers
    onProjectCursor?.(projectCursor);

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

    // Try Tauri global cursor — skip if external consumer handles it
    if (!externalCursorPoll) import('@tauri-apps/api/core').then(async ({ invoke }) => {
      if (cancelled) return;
      try {
        await invoke<[number, number] | null>('get_cursor_position');
      } catch {
        return; // Not in Tauri runtime
      }
      if (cancelled) return;
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);

      const win = getCurrentWindow();
      let prevScreenX = -1;
      let prevScreenY = -1;
      const poll = async () => {
        try {
          const pos2 = await invoke<[number, number] | null>('get_cursor_position');
          if (!pos2) return;
          const [screenX, screenY] = pos2;
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
            Math.max(-NDC_CLAMP, Math.min(NDC_CLAMP, ((screenX - pos.x) / scale / w) * 2 - 1)),
            Math.max(-NDC_CLAMP, Math.min(NDC_CLAMP, -(((screenY - pos.y) / scale / h) * 2 - 1))),
          );
        } catch { /* poll error — skip frame */ }
      };
      cursorPollId = setInterval(poll, CURSOR_POLL_MS);
    }).catch(() => {});

    return () => {
      if (cursorPollId) clearInterval(cursorPollId);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      avatarScene.scene.remove(lookAtProxy);
      cancelled = true;
      onProjectCursor?.(null);
      onScene?.(null);
      onStateMachine?.(null);
      onEffectsManager?.(null);
      stateMachineRef.current?.dispose();
      stateMachineRef.current = null;
      effectsManagerRef.current?.dispose();
      effectsManagerRef.current = null;
      avatarScene.dispose();
      vrmManager.dispose();
      assetResolverRef.current?.dispose();
      assetResolverRef.current = null;
      sceneRef.current = null;
    };
  }, [modelUrl, assetBaseUrl, setAvatarState]); // onScene, cursorPollMs, externalCursorPoll, onProjectCursor intentionally excluded — they are consumed once during setup; adding them would re-create the entire scene

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
      <canvas ref={canvasRef} style={baseCanvasStyle} />
      {!animationsLoaded && <LoadingOverlay state={loadingState} />}
    </div>
  );
}
