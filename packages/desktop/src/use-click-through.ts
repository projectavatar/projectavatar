/**
 * useClickThrough — transparent click-through for the desktop avatar.
 *
 * Behavior:
 *   1. Default: click-through mode ON, UI hidden.
 *   2. Polls global cursor at 5fps via Tauri `get_cursor_position`.
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface ClickThroughState {
  /** Whether the cursor is over the model (UI should be visible). */
  hovered: boolean;
}

export function useClickThrough(
  avatarScene: AvatarScene | null,
): ClickThroughState {
  const [hovered, setHovered] = useState(false);

  const sceneRef = useRef(avatarScene);
  sceneRef.current = avatarScene;

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);

  // Reusable THREE objects (avoid GC)
  const bboxRef = useRef(new THREE.Box3());
  const ndcMinRef = useRef(new THREE.Vector3());
  const ndcMaxRef = useRef(new THREE.Vector3());
  const cornersRef = useRef<THREE.Vector3[]>(
    Array.from({ length: 8 }, () => new THREE.Vector3()),
  );

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

          const hit = testBboxHit(
            vrmRoot, scene.camera, ndcX, ndcY,
            bboxRef.current, ndcMinRef.current, ndcMaxRef.current, cornersRef.current,
          );

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

  return { hovered };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the VRM root in the Three.js scene.
 * VRM models are added as a Group with visible SkinnedMesh children.
 */
function findVrmRoot(scene: THREE.Scene): THREE.Object3D | null {
  for (const child of scene.children) {
    // VRM scene is typically a Group containing the armature + meshes
    if (child.type === 'Group' && child.visible) {
      // Check if it has skinned meshes (VRM model indicator)
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
 * Project the object's world-space bounding box to NDC and check if
 * the cursor (ndcX, ndcY) falls within it (with padding).
 */
function testBboxHit(
  obj: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  bbox: THREE.Box3,
  ndcMin: THREE.Vector3,
  ndcMax: THREE.Vector3,
  corners: THREE.Vector3[],
): boolean {
  bbox.setFromObject(obj);

  const { min, max } = bbox;
  corners[0].set(min.x, min.y, min.z);
  corners[1].set(min.x, min.y, max.z);
  corners[2].set(min.x, max.y, min.z);
  corners[3].set(min.x, max.y, max.z);
  corners[4].set(max.x, min.y, min.z);
  corners[5].set(max.x, min.y, max.z);
  corners[6].set(max.x, max.y, min.z);
  corners[7].set(max.x, max.y, max.z);

  ndcMin.set(Infinity, Infinity, 0);
  ndcMax.set(-Infinity, -Infinity, 0);

  for (const corner of corners) {
    corner.project(camera);
    ndcMin.x = Math.min(ndcMin.x, corner.x);
    ndcMin.y = Math.min(ndcMin.y, corner.y);
    ndcMax.x = Math.max(ndcMax.x, corner.x);
    ndcMax.y = Math.max(ndcMax.y, corner.y);
  }

  ndcMin.x -= BBOX_PADDING_NDC;
  ndcMin.y -= BBOX_PADDING_NDC;
  ndcMax.x += BBOX_PADDING_NDC;
  ndcMax.y += BBOX_PADDING_NDC;

  return ndcX >= ndcMin.x && ndcX <= ndcMax.x && ndcY >= ndcMin.y && ndcY <= ndcMax.y;
}
