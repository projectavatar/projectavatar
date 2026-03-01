/**
 * WindowChrome — transparent overlay for borderless window management.
 *
 * Interaction model:
 * - Drag the grip handle (top center) → move window
 * - Drag edges/corners → resize window (via Tauri startResizeDragging)
 * - Right-drag on canvas → rotate 3D model (OrbitControls, unaffected)
 * - Hover/move mouse → controls appear, hide after 1s idle
 * - Escape (double-tap) → close window
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { useIdleHide } from '../../web/src/hooks/use-idle-hide.ts';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

const EDGE_SIZE = 10;
const CORNER_SIZE = 20;
const BORDER_RADIUS = 12;

type ResizeDir = 'North' | 'South' | 'East' | 'West'
  | 'NorthWest' | 'NorthEast' | 'SouthWest' | 'SouthEast';

function getResizeDirection(
  x: number, y: number, w: number, h: number,
): ResizeDir | null {
  const top = y < EDGE_SIZE;
  const bottom = y > h - EDGE_SIZE;
  const left = x < EDGE_SIZE;
  const right = x > w - EDGE_SIZE;

  if (x < CORNER_SIZE && y < CORNER_SIZE) return 'NorthWest';
  if (x > w - CORNER_SIZE && y < CORNER_SIZE) return 'NorthEast';
  if (x < CORNER_SIZE && y > h - CORNER_SIZE) return 'SouthWest';
  if (x > w - CORNER_SIZE && y > h - CORNER_SIZE) return 'SouthEast';

  if (top) return 'North';
  if (bottom) return 'South';
  if (left) return 'West';
  if (right) return 'East';

  return null;
}

function getCursorForDirection(dir: ResizeDir | null): string {
  switch (dir) {
    case 'North': case 'South': return 'ns-resize';
    case 'West': case 'East': return 'ew-resize';
    case 'NorthWest': case 'SouthEast': return 'nwse-resize';
    case 'NorthEast': case 'SouthWest': return 'nesw-resize';
    default: return 'default';
  }
}

// Match gear button style exactly
const chromeBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  cursor: 'pointer',
  transition: 'border-color 0.15s',
  color: 'var(--color-text-muted)',
  background: 'rgba(10, 10, 15, 0.75)',
  backdropFilter: 'blur(8px)',
};

export function WindowChrome() {
  // ── Round window corners ────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.style.borderRadius = `${BORDER_RADIUS}px`;
    root.style.overflow = 'hidden';
    return () => {
      root.style.borderRadius = '';
      root.style.overflow = '';
    };
  }, []);

  const [pinned, setPinned] = useState(true);
  const [clickThrough, setClickThrough] = useState(false);
  const [resizing, setResizing] = useState(false);
  const lastEscapeRef = useRef(0);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Same 1s idle hide as the gear button
  const uiVisible = useIdleHide(1000);
  const visible = (uiVisible || resizing) && !clickThrough;

  // ── Edge resize ─────────────────────────────────────────────────────

  useEffect(() => {
    let currentDir: ResizeDir | null = null;

    const onMouseMove = (e: MouseEvent) => {
      const dir = getResizeDirection(
        e.clientX, e.clientY, window.innerWidth, window.innerHeight,
      );
      if (dir !== currentDir) {
        currentDir = dir;
        document.body.style.cursor = dir ? getCursorForDirection(dir) : '';
      }
    };

    const onMouseDown = async (e: MouseEvent) => {
      if (e.button !== 0) return;
      const dir = getResizeDirection(
        e.clientX, e.clientY, window.innerWidth, window.innerHeight,
      );
      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        await getCurrentWindow().startResizeDragging(dir);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      document.body.style.cursor = '';
    };
  }, []);

  // ── Keep chrome visible during resize ───────────────────────────────

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setResizing(true);
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => setResizing(false), 2000);
    });
    observer.observe(document.documentElement);
    return () => {
      observer.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, []);

  // ── Click-through toggle (Ctrl+Shift+M) ─────────────────────────

  useEffect(() => {
    const SHORTCUT = 'CmdOrCtrl+Shift+M';
    let registered = false;

    register(SHORTCUT, () => {
      setClickThrough((prev) => {
        const next = !prev;
        getCurrentWindow().setIgnoreCursorEvents(next);
        return next;
      });
    }).then(() => { registered = true; }).catch(console.warn);

    return () => {
      if (registered) unregister(SHORTCUT).catch(() => {});
    };
  }, []);

  // ── Escape to close (double-tap within 500ms) ──────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const now = Date.now();
      if (now - lastEscapeRef.current < 500) {
        getCurrentWindow().close();
      }
      lastEscapeRef.current = now;
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Persist window position & size ──────────────────────────────────

  useEffect(() => {
    const win = getCurrentWindow();
    const STORAGE_KEY = 'window-bounds';

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { x, y, width, height } = JSON.parse(saved);
        win.setPosition(new PhysicalPosition(x, y)).catch(() => {});
        win.setSize(new PhysicalSize(width, height)).catch(() => {});
      }
    } catch { /* ignore */ }

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const save = async () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const pos = await win.outerPosition();
          const size = await win.outerSize();
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            x: pos.x, y: pos.y,
            width: size.width, height: size.height,
          }));
        } catch { /* ignore */ }
      }, 200);
    };

    const unlistenMove = win.onMoved(save);
    const unlistenResize = win.onResized(save);

    return () => {
      unlistenMove.then((fn) => fn());
      unlistenResize.then((fn) => fn());
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, []);

  // ── Button handlers ────────────────────────────────────────────────

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    getCurrentWindow().close();
  }, []);

  const handleTogglePin = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !pinned;
    setPinned(next);
    await getCurrentWindow().setAlwaysOnTop(next);
  }, [pinned]);

  const handleGripMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    await getCurrentWindow().startDragging();
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      {/* Dashed border — visible on hover */}
      <div
        style={{
          position: 'absolute',
          inset: 2,
          borderRadius: BORDER_RADIUS,
          border: '2px dashed rgba(255, 255, 255, 0.35)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: 'none',
        }}
      />

      {/* Click-through indicator */}
      {clickThrough && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '4px 12px',
          borderRadius: 6,
          background: 'rgba(10, 10, 15, 0.75)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          fontSize: 11,
          pointerEvents: 'none',
          opacity: 0.7,
          whiteSpace: 'nowrap',
        }}>
          Click-through · Ctrl+Shift+M to interact
        </div>
      )}

      {/* Top bar: grip handle (center) + pin/close (right) */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: visible ? 'auto' : 'none',
          userSelect: 'none',
        }}
      >
        {/* Spacer to balance the right-side buttons */}
        <div style={{ flex: 1 }} />

        {/* Drag grip handle */}
        <div
          onMouseDown={handleGripMouseDown}
          title="Drag to move"
          style={{
            ...chromeBtnStyle,
            width: 'auto',
            padding: '0 20px',
            gap: 4,
            cursor: 'grab',
          }}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.45)',
            }} />
          ))}
        </div>

        {/* Right-side buttons */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button
            onClick={handleTogglePin}
            title={pinned ? 'Unpin from top' : 'Pin to top'}
            style={{
              ...chromeBtnStyle,
              color: pinned ? 'var(--color-accent, #6c5ce7)' : 'rgba(232, 232, 240, 0.5)',
            }}
          >
            📌
          </button>

          <button
            onClick={handleClose}
            title="Close"
            style={chromeBtnStyle}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(231, 76, 60, 0.6)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = chromeBtnStyle.background as string; }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
