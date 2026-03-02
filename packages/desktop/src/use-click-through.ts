/**
 * useClickThrough — transparent click-through for the desktop avatar.
 *
 * Behavior:
 *   1. Default: click-through mode ON, UI hidden.
 *   2. Polls global cursor at 5fps via Tauri \`get_cursor_position\`.
 *   3. Projects cursor to NDC, tests against VRM bounding box.
 *   4. Cursor hits model → disable click-through, show UI (hovered=true).
 *   5. Cursor leaves model → after 1s, re-enable click-through, hide UI.
 *
 * The avatar-canvas cursor poll (for head/eye tracking) runs independently
 * at the same 5fps rate via the cursorPollMs prop.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Poll interval — 5fps = 200ms. */
const POLL_MS = 200;

/** Timeout before re-enabling click-through after cursor leaves model (ms). */
const HIDE_TIMEOUT_MS = 1000;

/**
 * NDC padding around the projected bounding box.
 * Ensures the hit area covers chrome buttons and border.
 */
const BBOX_PADDING_NDC = 0.08;

// ─── Tauri interop (lazy-loaded) ──────────────────────────────────────────────

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
let _invoke: InvokeFn | null = null;
let _getCurrentWindow: (() => {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
}) | null = null;

async function ensureTauri(): Promise<boolean> {
  if (_invoke) return true;
  try {
    const core = await import('@tauri-apps/api/core');
    const win = await import('@tauri-apps/api/window');
    // Probe — throws if not in Tauri runtime
    await core.invoke<[number, number] | null>('get_cursor_position');
    _invoke = core.invoke;
    _getCurrentWindow = win.getCurrentWindow as unknown as typeof _getCurrentWindow;
    return true;
  } catch {
    return false;
  }
}

async function setIgnoreCursorEvents(ignore: boolean): Promise<void> {
  if (!_invoke) return;
  try {
    await _invoke('set_ignore_cursor_events', { ignore });
  } catch { /* best effort */ }
}

// ─── Debug overlay rect (NDC → CSS %) ────────────────────────────────────────

export interface DebugBbox {
  /** CSS left % (0–100) */
  left: number;
  /** CSS top % (0–100) */
  top: number;
  /** CSS width % (0–100) */
  width: number;
  /** CSS height % (0–100) */
  height: number;
  /** Whether cursor is inside */
  hit: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface ClickThroughState {
  /** Whether the cursor is over the model (UI should be visible). */
  hovered: boolean;
  /** Debug bounding box in CSS % coordinates (only updated when debug=true). */
  debugBbox: DebugBbox | null;
}

export function useClickThrough(
  avatarScene: AvatarScene | null,
  /** Enable debug overlay data. */
  debug = false,
): ClickThroughState {
  const [hovered, setHovered] = useState(false);
  const [debugBbox, setDebugBbox] = useState<DebugBbox | null>(null);

  const sceneRef = useRef(avatarScene);
  sceneRef.current = avatarScene;

  const debugRef = useRef(debug);
  debugRef.current = debug;

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);

  // Reusable THREE objects (avoid GC)
  const ndcMinRef = useRef(new THREE.Vector3());
  const ndcMaxRef = useRef(new THREE.Vector3());
  const boneWorldPos = useRef(new THREE.Vector3());

  const enterModel = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (!hoveredRef.current) {
      hoveredRef.current = true;
      setHovered(true);
      void setIgnoreCursorEvents(false);
    }
  }, []);

  const leaveModel = useCallback(() => {
    if (hideTimerRef.current) return; // already scheduled
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (hoveredRef.current) {
        hoveredRef.current = false;
        setHovered(false);
        void setIgnoreCursorEvents(true);
      }
    }, HIDE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      const ok = await ensureTauri();
      if (!ok || cancelled) return;

      // Start in click-through mode
      void setIgnoreCursorEvents(true);

      const win = _getCurrentWindow!();

      const poll = async () => {
        if (cancelled || !_invoke) return;
        const scene = sceneRef.current;
        if (!scene) return;

        try {
          const pos = await (_invoke as InvokeFn)('get_cursor_position') as [number, number] | null;
          if (!pos || cancelled) return;

          const [screenX, screenY] = pos;
          const winPos = await win.outerPosition();
          const winSize = await win.outerSize();
          const scale = await win.scaleFactor();

          const w = winSize.width / scale;
          const h = winSize.height / scale;
          const localX = (screenX - winPos.x) / scale;
          const localY = (screenY - winPos.y) / scale;
          const ndcX = (localX / w) * 2 - 1;
          const ndcY = -((localY / h) * 2 - 1);

          // Hit test — find the VRM root in the scene (first visible Group child)
          const vrmRoot = findVrmRoot(scene.scene);
          if (!vrmRoot) return;

          const hit = testBoneHit(
            vrmRoot, scene.camera, ndcX, ndcY,
            ndcMinRef.current, ndcMaxRef.current, boneWorldPos.current,
          );

          // Update debug bbox overlay
          if (debugRef.current) {
            const nMin = ndcMinRef.current;
            const nMax = ndcMaxRef.current;
            // NDC (-1..1) → CSS % (0..100)
            const left   = ((nMin.x + 1) / 2) * 100;
            const right  = ((nMax.x + 1) / 2) * 100;
            // NDC Y is flipped vs CSS (NDC +1 = top, CSS 0% = top)
            const top    = ((1 - nMax.y) / 2) * 100;
            const bottom = ((1 - nMin.y) / 2) * 100;
            setDebugBbox({
              left,
              top,
              width: right - left,
              height: bottom - top,
              hit,
            });
          }

          if (hit) {
            enterModel();
          } else {
            leaveModel();
          }
        } catch { /* poll error — skip */ }
      };

      pollId = setInterval(poll, POLL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      // Restore normal cursor events on cleanup
      void setIgnoreCursorEvents(false);
    };
  }, [enterModel, leaveModel]);

  return { hovered, debugBbox: debug ? debugBbox : null };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * VRM humanoid bone names used for hit-testing.
 * These trace the visible silhouette of the body — head top, shoulders,
 * hands, hips, and feet — giving a tight hitbox regardless of camera angle.
 */
const HIT_BONES = [
  'head',
  'leftShoulder', 'rightShoulder',
  'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg',
  'leftFoot', 'rightFoot',
] as const;

/**
 * Find the VRM instance in the Three.js scene.
 * Looks for the first visible Group child that has a 'humanoid' property
 * (attached by @pixiv/three-vrm on the VRM scene root).
 */
function findVrmRoot(scene: THREE.Scene): THREE.Object3D | null {
  for (const child of scene.children) {
    if (child.type === 'Group' && child.visible) {
      let hasSkinned = false;
      child.traverse((obj) => {
        if ((obj as THREE.SkinnedMesh).isSkinnedMesh) hasSkinned = true;
      });
      if (hasSkinned) return child;
    }
  }
  return null;
}

/**
 * Walk up from the VRM scene root to find the VRM instance.
 * The VRM humanoid is stored on the scene's userData by @pixiv/three-vrm.
 */
function getHumanoid(obj: THREE.Object3D): {
  getNormalizedBoneNode(name: string): THREE.Object3D | null;
} | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vrm = (obj as any)?.userData?.vrm;
  return vrm?.humanoid ?? null;
}

/**
 * Project key body bones to NDC and check if the cursor falls within
 * the resulting screen-space rectangle (with padding).
 *
 * Unlike a full AABB, this ignores depth — it only considers the
 * projected positions of bones that define the visible silhouette.
 */
function testBoneHit(
  vrmRoot: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  ndcMin: THREE.Vector3,
  ndcMax: THREE.Vector3,
  worldPos: THREE.Vector3,
): boolean {
  const humanoid = getHumanoid(vrmRoot);
  if (!humanoid) {
    // Fallback: no humanoid data — use a simple AABB
    return testFallbackBbox(vrmRoot, camera, ndcX, ndcY, ndcMin, ndcMax);
  }

  ndcMin.set(Infinity, Infinity, 0);
  ndcMax.set(-Infinity, -Infinity, 0);

  let projected = 0;
  for (const boneName of HIT_BONES) {
    const bone = humanoid.getNormalizedBoneNode(boneName);
    if (!bone) continue;

    bone.getWorldPosition(worldPos);
    worldPos.project(camera);

    ndcMin.x = Math.min(ndcMin.x, worldPos.x);
    ndcMin.y = Math.min(ndcMin.y, worldPos.y);
    ndcMax.x = Math.max(ndcMax.x, worldPos.x);
    ndcMax.y = Math.max(ndcMax.y, worldPos.y);
    projected++;
  }

  if (projected < 3) return false; // not enough bones

  ndcMin.x -= BBOX_PADDING_NDC;
  ndcMin.y -= BBOX_PADDING_NDC;
  ndcMax.x += BBOX_PADDING_NDC;
  ndcMax.y += BBOX_PADDING_NDC;

  return ndcX >= ndcMin.x && ndcX <= ndcMax.x && ndcY >= ndcMin.y && ndcY <= ndcMax.y;
}

/** Simple AABB fallback when VRM humanoid is unavailable. */
function testFallbackBbox(
  obj: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  ndcMin: THREE.Vector3,
  ndcMax: THREE.Vector3,
): boolean {
  const bbox = new THREE.Box3().setFromObject(obj);
  const corners = [
    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z),
  ];

  ndcMin.set(Infinity, Infinity, 0);
  ndcMax.set(-Infinity, -Infinity, 0);

  for (const c of corners) {
    c.project(camera);
    ndcMin.x = Math.min(ndcMin.x, c.x);
    ndcMin.y = Math.min(ndcMin.y, c.y);
    ndcMax.x = Math.max(ndcMax.x, c.x);
    ndcMax.y = Math.max(ndcMax.y, c.y);
  }

  ndcMin.x -= BBOX_PADDING_NDC;
  ndcMin.y -= BBOX_PADDING_NDC;
  ndcMax.x += BBOX_PADDING_NDC;
  ndcMax.y += BBOX_PADDING_NDC;

  return ndcX >= ndcMin.x && ndcX <= ndcMax.x && ndcY >= ndcMin.y && ndcY <= ndcMax.y;
}
