/**
 * useClickThrough — transparent click-through for the desktop avatar.
 *
 * State machine:
 *   - Mouse outside window (1s timeout) → click-through ON, UI hidden
 *   - Mouse inside window but outside hitbox → click-through ON
 *   - Mouse hovers hitbox for 0.5s (no button pressed) → "activated"
 *   - Activated: click-through OFF, chrome visible
 *   - Once activated, stays active until mouse leaves the window (+ 1s timeout)
 *
 * Also drives cursor tracking for head/eye follow at the same 5fps rate,
 * replacing the Tauri cursor poll in avatar-canvas (single poll, no duplication).
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Poll interval — 5fps = 200ms. Shared with avatar-canvas via cursorPollMs. */
export const CURSOR_POLL_MS = 200;

/** Timeout before releasing after cursor leaves window (ms). */
const LEAVE_TIMEOUT_MS = 1000;

/** Hover time on hitbox before activating (ms). */
const HOVER_ACTIVATE_MS = 500;

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
    // Probe — throws if not in Tauri runtime
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface ClickThroughState {
  /** True when the avatar is "activated" — chrome + UI elements should be visible. */
  hovered: boolean;
}

export function useClickThrough(
  avatarScene: AvatarScene | null,
  /** Callback to project cursor NDC for head/eye tracking. */
  onCursorNdc?: (ndcX: number, ndcY: number) => void,
): ClickThroughState {
  const [hovered, setHovered] = useState(false);

  const sceneRef = useRef(avatarScene);
  sceneRef.current = avatarScene;

  const onCursorNdcRef = useRef(onCursorNdc);
  onCursorNdcRef.current = onCursorNdc;

  // State refs (avoid re-renders on every poll)
  const activatedRef = useRef(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reusable THREE objects
  const bboxRef = useRef(new THREE.Box3());
  const ndcMinRef = useRef(new THREE.Vector3());
  const ndcMaxRef = useRef(new THREE.Vector3());
  const cornersRef = useRef<THREE.Vector3[]>(
    Array.from({ length: 8 }, () => new THREE.Vector3()),
  );
  const cubeSizeRef = useRef(new THREE.Vector3());
  const cubeCenterRef = useRef(new THREE.Vector3());
  const prevScreenRef = useRef<[number, number]>([-1, -1]);

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const deactivate = (invoke: InvokeFn) => {
      activatedRef.current = false;
      setHovered(false);
      void setIgnoreCursor(invoke, true);
    };

    const activate = (invoke: InvokeFn) => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      activatedRef.current = true;
      setHovered(true);
      void setIgnoreCursor(invoke, false);
    };

    const scheduleLeave = (invoke: InvokeFn) => {
      if (leaveTimerRef.current) return;
      leaveTimerRef.current = setTimeout(() => {
        leaveTimerRef.current = null;
        deactivate(invoke);
      }, LEAVE_TIMEOUT_MS);
    };

    const cancelLeave = () => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
    };

    const cancelHover = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };

    const start = async () => {
      const tauri = await ensureTauri();
      if (!tauri || cancelled) return;

      const { invoke, win } = tauri;

      // Start in click-through mode
      void setIgnoreCursor(invoke, true);

      const poll = async () => {
        if (cancelled) return;
        const scene = sceneRef.current;
        if (!scene) return;

        try {
          // Single IPC: cursor position + button state
          const state = await invoke('get_cursor_state') as [number, number, boolean] | null;
          if (!state || cancelled) return;

          const [screenX, screenY, buttonPressed] = state;
          const winPos = await win.outerPosition();
          const winSize = await win.outerSize();
          const scale = await win.scaleFactor();

          const w = winSize.width / scale;
          const h = winSize.height / scale;
          const localX = (screenX - winPos.x) / scale;
          const localY = (screenY - winPos.y) / scale;
          const ndcX = Math.max(-2, Math.min(2, (localX / w) * 2 - 1));
          const ndcY = Math.max(-2, Math.min(2, -((localY / h) * 2 - 1)));

          // Feed cursor NDC to head/eye tracking only when cursor actually moved
          const [prevX, prevY] = prevScreenRef.current;
          if (screenX !== prevX || screenY !== prevY) {
            prevScreenRef.current = [screenX, screenY];
            onCursorNdcRef.current?.(ndcX, ndcY);
          }

          const insideWindow = localX >= 0 && localX <= w && localY >= 0 && localY <= h;

          // Hit test against VRM bounding box
          const vrmRoot = scene.vrmRoot;
          let hit = false;
          if (vrmRoot) {
            hit = testBboxHit(
              vrmRoot, scene.camera, ndcX, ndcY,
              bboxRef.current, ndcMinRef.current, ndcMaxRef.current,
              cornersRef.current, cubeSizeRef.current, cubeCenterRef.current,
            );
          }

          // State machine
          if (!insideWindow) {
            cancelHover();
            scheduleLeave(invoke);
          } else {
            cancelLeave();
            if (!activatedRef.current) {
              if (hit && !buttonPressed) {
                // Start hover timer (only if not already counting)
                if (!hoverTimerRef.current) {
                  hoverTimerRef.current = setTimeout(() => {
                    hoverTimerRef.current = null;
                    activate(invoke);
                  }, HOVER_ACTIVATE_MS);
                }
              } else {
                cancelHover();
              }
            }
          }
        } catch { /* poll error — skip */ }
      };

      pollId = setInterval(poll, CURSOR_POLL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      void ensureTauri().then((t) => t && setIgnoreCursor(t.invoke, false));
    };
  }, []);

  return { hovered };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Project the VRM bounding box to NDC and test cursor hit.
 * AABB is expanded into a cube (consistent from all angles) with
 * X and Z shrunk by 1.5× to compensate for T-pose width.
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
  cubeSize: THREE.Vector3,
  cubeCenter: THREE.Vector3,
): boolean {
  bbox.setFromObject(obj);
  if (bbox.isEmpty()) return false;

  // Expand into cube, shrink X/Z for T-pose compensation
  const size = bbox.getSize(cubeSize);
  const maxSide = Math.max(size.x, size.y, size.z);
  const center = bbox.getCenter(cubeCenter);
  const half = maxSide / 2;
  const halfXZ = half / 1.5;
  bbox.min.set(center.x - halfXZ, center.y - half, center.z - halfXZ);
  bbox.max.set(center.x + halfXZ, center.y + half, center.z + halfXZ);

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

  return ndcX >= ndcMin.x && ndcX <= ndcMax.x && ndcY >= ndcMin.y && ndcY <= ndcMax.y;
}
