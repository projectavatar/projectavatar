/**
 * useClickThrough — transparent click-through for the fullscreen desktop avatar.
 *
 * State machine (fullscreen):
 *   - Mouse on avatar hitbox (no button pressed) → click-through OFF (interact with avatar)
 *   - Mouse outside avatar hitbox → click-through ON immediately (interact with desktop)
 *
 * Hit testing uses 2D convex hull of the projected 3D bounding box corners
 * for a tight fit from any camera angle.
 *
 * Also drives cursor tracking for head/eye follow at the same 5fps rate.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Poll interval — 5fps = 200ms. Shared with avatar-canvas via cursorPollMs. */
export const CURSOR_POLL_MS = 200;

// ─── Tauri interop (lazy-loaded) ──────────────────────────────────────────────

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriContext {
  invoke: InvokeFn;
  win: {
    outerPosition(): Promise<{ x: number; y: number }>;
    outerSize(): Promise<{ width: number; height: number }>;
    scaleFactor(): Promise<number>;
  };
}

let _tauri: TauriContext | null = null;

async function ensureTauri(): Promise<TauriContext | null> {
  if (_tauri) return _tauri;
  try {
    const core = await import('@tauri-apps/api/core');
    const win = await import('@tauri-apps/api/window');
    await core.invoke<unknown>('get_cursor_state');
    _tauri = {
      invoke: core.invoke,
      win: win.getCurrentWindow() as unknown as TauriContext['win'],
    };
    return _tauri;
  } catch {
    return null;
  }
}

async function setIgnoreCursor(invoke: InvokeFn, ignore: boolean): Promise<void> {
  try {
    await invoke('set_ignore_cursor_events', { ignore });
  } catch { /* best effort */ }
}

// ─── Convex hull + point-in-polygon ───────────────────────────────────────────

interface Point2D { x: number; y: number }

/** Graham scan convex hull — returns points in CCW order. */
function convexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points.slice();

  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  // Build lower and upper hulls. Using <= 0 (not < 0) to exclude
  // collinear points — safe for bounding box corners where duplicates
  // on edges are expected.
  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Winding number point-in-polygon test. */
function pointInConvexHull(hull: Point2D[], px: number, py: number): boolean {
  if (hull.length < 3) return false;
  let wn = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if (a.y <= py) {
      if (b.y > py) {
        const cross = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
        if (cross > 0) wn++;
      }
    } else {
      if (b.y <= py) {
        const cross = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
        if (cross < 0) wn--;
      }
    }
  }
  return wn !== 0;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface ClickThroughState {
  /** True when the avatar is "activated" — UI elements should be visible. */
  hovered: boolean;
}

export function useClickThrough(
  avatarScene: AvatarScene | null,
  onCursorNdc?: (ndcX: number, ndcY: number) => void,
  /**
   * Force click-through OFF regardless of hitbox state.
   * Used when UI overlays (settings drawer) need mouse interaction.
   * When true: click-through disabled, hovered=true.
   * When false/undefined: normal hitbox-based state machine.
   */
  forceActive?: boolean,
): ClickThroughState {
  const [hovered, setHovered] = useState(false);

  const sceneRef = useRef(avatarScene);
  sceneRef.current = avatarScene;

  const onCursorNdcRef = useRef(onCursorNdc);
  onCursorNdcRef.current = onCursorNdc;

  const activatedRef = useRef(false);
  const draggingRef = useRef(false);
  const forceActiveRef = useRef(forceActive ?? false);
  forceActiveRef.current = forceActive ?? false;

  // Reusable THREE objects
  const bboxRef = useRef(new THREE.Box3());
  const cornersRef = useRef<THREE.Vector3[]>(
    Array.from({ length: 8 }, () => new THREE.Vector3()),
  );
  const cubeSizeRef = useRef(new THREE.Vector3());
  const cubeCenterRef = useRef(new THREE.Vector3());
  const prevScreenRef = useRef<[number, number]>([-1, -1]);

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      const tauri = await ensureTauri();
      if (!tauri || cancelled) return;

      const { invoke, win } = tauri;
      void setIgnoreCursor(invoke, true);

      const poll = async () => {
        if (cancelled) return;
        const scene = sceneRef.current;
        if (!scene) return;

        try {
          const state = await invoke('get_cursor_state') as [number, number, boolean, boolean, boolean] | null;
          if (!state || cancelled) return;

          const [screenX, screenY, leftPressed, _rightPressed, anyPressed] = state;
          const winPos = await win.outerPosition();
          const winSize = await win.outerSize();
          const scale = await win.scaleFactor();

          const w = winSize.width / scale;
          const h = winSize.height / scale;
          const localX = (screenX - winPos.x) / scale;
          const localY = (screenY - winPos.y) / scale;
          const ndcX = Math.max(-2, Math.min(2, (localX / w) * 2 - 1));
          const ndcY = Math.max(-2, Math.min(2, -((localY / h) * 2 - 1)));

          const [prevX, prevY] = prevScreenRef.current;
          if (screenX !== prevX || screenY !== prevY) {
            prevScreenRef.current = [screenX, screenY];
            onCursorNdcRef.current?.(ndcX, ndcY);
          }

          const vrmRoot = scene.vrmRoot;
          let hit = false;
          if (vrmRoot) {
            const hull = projectHull(
              vrmRoot, scene.camera,
              bboxRef.current, cornersRef.current,
              cubeSizeRef.current, cubeCenterRef.current,
            );
            if (hull) {
              hit = pointInConvexHull(hull, ndcX, ndcY);
            }
          }

          // State machine:
          // 1. hit + no button → activate (click-through OFF), show hover
          // 2. hit + left button + already active → start OS drag
          // 3. no hit + no button → deactivate (click-through ON)
          //
          // By activating on hover (before click), click-through is already
          // OFF when the user clicks, so the click registers immediately.

          if (hit && leftPressed && activatedRef.current && !draggingRef.current) {
            draggingRef.current = true;
            void invoke('start_drag');
          }


          if (!anyPressed) {
            if (draggingRef.current) {
              // Re-focus after drag so next interaction works.
              void invoke('set_focus');
              window.focus();
            }
            draggingRef.current = false;
          }


          const shouldBeActive = hit || forceActiveRef.current || draggingRef.current;

          if (shouldBeActive) {
            if (!activatedRef.current) {
              activatedRef.current = true;
              setHovered(true);
              void setIgnoreCursor(invoke, false);
            }
          } else if (!anyPressed) {
            if (activatedRef.current) {
              activatedRef.current = false;
              setHovered(false);
              void setIgnoreCursor(invoke, true);
            }
          }
          // Push debug state to perf overlay
          const dbgScene = sceneRef.current;
          if (dbgScene) {
            dbgScene.setDebugState('ct', activatedRef.current ? 'OFF (interactive)' : 'ON (passthrough)');
            dbgScene.setDebugState('hit', hit ? 'yes' : 'no');
            dbgScene.setDebugState('drag', draggingRef.current ? 'active' : 'no');
            dbgScene.setDebugState('btn', leftPressed ? 'L' : (_rightPressed ? 'R' : (anyPressed ? '?' : '-')));
            dbgScene.setDebugState('cursor', Math.round(localX) + ',' + Math.round(localY));
          }

        } catch { /* poll error — skip */ }
      };

      pollId = setInterval(poll, CURSOR_POLL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      void ensureTauri().then((t) => t && setIgnoreCursor(t.invoke, false));
    };
  }, []);

  return { hovered };
}

// ─── 3D → 2D projection ──────────────────────────────────────────────────────

/**
 * Project the shrunk bounding box corners to NDC and return their convex hull.
 * T-pose compensation: X halved, Z = X, Y untouched.
 */
function projectHull(
  obj: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  bbox: THREE.Box3,
  corners: THREE.Vector3[],
  cubeSize: THREE.Vector3,
  cubeCenter: THREE.Vector3,
): Point2D[] | null {
  bbox.setFromObject(obj);
  if (bbox.isEmpty()) return null;

  // T-pose compensation: halve X, use same length for Z, keep Y as-is.
  const size = bbox.getSize(cubeSize);
  const center = bbox.getCenter(cubeCenter);
  const halfX = size.x / 4;
  bbox.min.set(center.x - halfX, bbox.min.y, center.z - halfX);
  bbox.max.set(center.x + halfX, bbox.max.y, center.z + halfX);

  const { min, max } = bbox;
  corners[0].set(min.x, min.y, min.z);
  corners[1].set(min.x, min.y, max.z);
  corners[2].set(min.x, max.y, min.z);
  corners[3].set(min.x, max.y, max.z);
  corners[4].set(max.x, min.y, min.z);
  corners[5].set(max.x, min.y, max.z);
  corners[6].set(max.x, max.y, min.z);
  corners[7].set(max.x, max.y, max.z);

  const projected: Point2D[] = [];
  for (const corner of corners) {
    corner.project(camera);
    projected.push({ x: corner.x, y: corner.y });
  }

  return convexHull(projected);
}
