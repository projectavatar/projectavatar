/**
 * useClickThrough — transparent click-through for the fullscreen desktop avatar.
 *
 * State machine (fullscreen):
 *   - Mouse on avatar hitbox (no button pressed) → click-through OFF (interact with avatar)
 *   - Mouse outside avatar hitbox → click-through ON immediately (interact with desktop)
 *
 * Also drives cursor tracking for head/eye follow at the same 5fps rate,
 * replacing the Tauri cursor poll in avatar-canvas (single poll, no duplication).
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

/** NDC bounding box for the avatar hitbox (debug visualization). */
export interface HitboxNdc {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ClickThroughState {
  /** True when the avatar is "activated" — UI elements should be visible. */
  hovered: boolean;
  /** NDC bounds of the avatar hitbox (updated every poll). */
  hitbox: HitboxNdc | null;
}

export function useClickThrough(
  avatarScene: AvatarScene | null,
  /** Callback to project cursor NDC for head/eye tracking. */
  onCursorNdc?: (ndcX: number, ndcY: number) => void,
): ClickThroughState {
  const [hovered, setHovered] = useState(false);
  const [hitbox, setHitbox] = useState<HitboxNdc | null>(null);

  const sceneRef = useRef(avatarScene);
  sceneRef.current = avatarScene;

  const onCursorNdcRef = useRef(onCursorNdc);
  onCursorNdcRef.current = onCursorNdc;

  // State ref (avoid re-renders on every poll)
  const activatedRef = useRef(false);

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

          // Hit test against VRM bounding box
          const vrmRoot = scene.vrmRoot;
          let hit = false;
          if (vrmRoot) {
            hit = testBboxHit(
              vrmRoot, scene.camera, ndcX, ndcY,
              bboxRef.current, ndcMinRef.current, ndcMaxRef.current,
              cornersRef.current, cubeSizeRef.current, cubeCenterRef.current,
            );
            // Expose hitbox NDC for debug overlay
            setHitbox({
              minX: ndcMinRef.current.x,
              minY: ndcMinRef.current.y,
              maxX: ndcMaxRef.current.x,
              maxY: ndcMaxRef.current.y,
            });
          }

          // Fullscreen state machine:
          // On hitbox + no button → activate (can interact with avatar)
          // Off hitbox → deactivate immediately (clicks pass to desktop)
          if (hit && !buttonPressed) {
            if (!activatedRef.current) {
              activatedRef.current = true;
              setHovered(true);
              void setIgnoreCursor(invoke, false);
            }
          } else if (!hit && !buttonPressed) {
            // Only release when no button is held (don't drop mid-drag)
            if (activatedRef.current) {
              activatedRef.current = false;
              setHovered(false);
              void setIgnoreCursor(invoke, true);
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
      void ensureTauri().then((t) => t && setIgnoreCursor(t.invoke, false));
    };
  }, []);

  return { hovered, hitbox };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Project the VRM bounding box to NDC and test cursor hit.
 * Uses the model AABB with
 * X halved for T-pose, Z matched to X, Y untouched.
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

  // T-pose compensation: halve X, use same length for Z, keep Y as-is.
  const size = bbox.getSize(cubeSize);
  const center = bbox.getCenter(cubeCenter);
  const halfX = size.x / 4; // half of T-pose width
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
