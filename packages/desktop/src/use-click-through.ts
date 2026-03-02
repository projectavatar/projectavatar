/**
 * useClickThrough — transparent click-through for the desktop avatar.
 *
 * State machine:
 *   - Mouse outside window (1s timeout) → click-through ON, UI hidden
 *   - Mouse inside window but outside hitbox → click-through ON
 *   - Mouse enters hitbox → "activated" — click-through OFF, chrome visible
 *   - Once activated, stays active until mouse leaves the window (+ 1s timeout)
 *
 * The avatar-canvas cursor poll (for head/eye tracking) runs independently
 * at the same 5fps rate via the cursorPollMs prop.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Poll interval — 5fps = 200ms. */
const POLL_MS = 200;

/** Timeout before releasing after cursor leaves window (ms). */
const LEAVE_TIMEOUT_MS = 1000;

/**
 * NDC padding around the projected bounding box.
 * Ensures the hit area covers chrome buttons and border.
 */
const BBOX_PADDING_NDC = 0;

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
    await core.invoke<[number, number] | null>('get_cursor_position');
    _invoke = core.invoke;
    _getCurrentWindow = win.getCurrentWindow as unknown as typeof _getCurrentWindow;
    return true;
  } catch {
    return false;
  }
}

async function setIgnoreCursor(ignore: boolean): Promise<void> {
  if (!_invoke) return;
  try {
    await _invoke('set_ignore_cursor_events', { ignore });
  } catch { /* best effort */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface ClickThroughState {
  /** True when the avatar is "activated" — chrome + UI elements should be visible. */
  hovered: boolean;
}

export function useClickThrough(
  avatarScene: AvatarScene | null,
): ClickThroughState {
  const [hovered, setHovered] = useState(false);

  const sceneRef = useRef(avatarScene);
  sceneRef.current = avatarScene;

  // Internal state refs (avoid re-renders on every poll)
  const activatedRef = useRef(false);   // hitbox was entered → stays on until window leave
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reusable THREE objects
  const bboxRef = useRef(new THREE.Box3());
  const ndcMinRef = useRef(new THREE.Vector3());
  const ndcMaxRef = useRef(new THREE.Vector3());
  const cornersRef = useRef<THREE.Vector3[]>(
    Array.from({ length: 8 }, () => new THREE.Vector3()),
  );

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const deactivate = () => {
      activatedRef.current = false;
      setHovered(false);
      void setIgnoreCursor(true);
    };

    const activate = () => {
      // Cancel any pending leave timeout
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      activatedRef.current = true;
      setHovered(true);
      void setIgnoreCursor(false);
    };

    const scheduleLeave = () => {
      if (leaveTimerRef.current) return; // already scheduled
      leaveTimerRef.current = setTimeout(() => {
        leaveTimerRef.current = null;
        deactivate();
      }, LEAVE_TIMEOUT_MS);
    };

    const cancelLeave = () => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
    };

    const start = async () => {
      const ok = await ensureTauri();
      if (!ok || cancelled) return;

      // Start in click-through mode
      void setIgnoreCursor(true);

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

          const insideWindow = localX >= 0 && localX <= w && localY >= 0 && localY <= h;

          // Always compute hitbox + update debug visuals
          const vrmRoot = findVrmRoot(scene.scene);
          let hit = false;
          if (vrmRoot) {
            hit = testBboxHit(
              vrmRoot, scene.camera, ndcX, ndcY,
              bboxRef.current, ndcMinRef.current, ndcMaxRef.current, cornersRef.current,
            );

          }

          // State machine
          if (!insideWindow) {
            // Cancel hover timer if mouse left window
            if (hoverTimerRef.current) {
              clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = null;
            }
            scheduleLeave();
          } else {
            cancelLeave();
            if (!activatedRef.current) {
              // Check if a mouse button is pressed (user dragging something)
              let buttonPressed = false;
              try {
                buttonPressed = await (_invoke as InvokeFn)('is_mouse_button_pressed') as boolean;
              } catch { /* ignore */ }

              if (hit && !buttonPressed) {
                // Start 1s hover timer to activate (only if not dragging)
                if (!hoverTimerRef.current) {
                  hoverTimerRef.current = setTimeout(() => {
                    hoverTimerRef.current = null;
                    activate();
                  }, 1000);
                }
              } else {
                // Left hitbox or button pressed — cancel hover timer
                if (hoverTimerRef.current) {
                  clearTimeout(hoverTimerRef.current);
                  hoverTimerRef.current = null;
                }
              }
            }
          }
        } catch { /* poll error — skip */ }
      };

      pollId = setInterval(poll, POLL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      void setIgnoreCursor(false);
    };
  }, []);

  return { hovered };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const _cubeSize = new THREE.Vector3();
const _cubeCenter = new THREE.Vector3();

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
  if (bbox.isEmpty()) return false;

  // Expand AABB into a cube so hitbox is consistent from every angle,
  // but shrink X by 1.5 to compensate for T-pose width inflation.
  const size = bbox.getSize(_cubeSize);
  const maxSide = Math.max(size.x, size.y, size.z);
  const center = bbox.getCenter(_cubeCenter);
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

  ndcMin.x -= BBOX_PADDING_NDC;
  ndcMin.y -= BBOX_PADDING_NDC;
  ndcMax.x += BBOX_PADDING_NDC;
  ndcMax.y += BBOX_PADDING_NDC;

  return ndcX >= ndcMin.x && ndcX <= ndcMax.x && ndcY >= ndcMin.y && ndcY <= ndcMax.y;
}
