/**
 * WindowChrome — transparent overlay for borderless window management.
 *
 * Interaction model:
 * - Hover → dashed rounded border fades in + titlebar appears at top
 * - Drag the titlebar → move window (via Tauri startDragging)
 * - Drag edges/corners → resize window (via Tauri startResizeDragging)
 * - Right-drag on canvas → rotate 3D model (OrbitControls, unaffected)
 * - Left-click on canvas → passes through normally (no capture)
 * - Escape (double-tap) → close window
 *
 * The titlebar and resize edges only appear on hover. When not hovered,
 * the window is fully click-through except for the invisible edge strips.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/*
 * Edge/corner hit zone sizes (px).
 * 6px edges = comfortable grab without eating too much canvas.
 * 14px corners = larger target for diagonal resize.
 */
const EDGE_SIZE = 6;
const CORNER_SIZE = 14;
const BORDER_RADIUS = 12;
const TITLEBAR_HEIGHT = 32;

/**
 * Tauri's ResizeDirection uses cardinal directions:
 * North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest
 */
type ResizeDir = 'North' | 'South' | 'East' | 'West'
  | 'NorthWest' | 'NorthEast' | 'SouthWest' | 'SouthEast';

function getResizeDirection(
  x: number, y: number, w: number, h: number,
): ResizeDir | null {
  const top = y < EDGE_SIZE;
  const bottom = y > h - EDGE_SIZE;
  const left = x < EDGE_SIZE;
  const right = x > w - EDGE_SIZE;

  // Corners (larger hit area for easier grab)
  if (x < CORNER_SIZE && y < CORNER_SIZE) return 'NorthWest';
  if (x > w - CORNER_SIZE && y < CORNER_SIZE) return 'NorthEast';
  if (x < CORNER_SIZE && y > h - CORNER_SIZE) return 'SouthWest';
  if (x > w - CORNER_SIZE && y > h - CORNER_SIZE) return 'SouthEast';

  // Edges
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

export function WindowChrome() {
  const [hovered, setHovered] = useState(false);
  const lastEscapeRef = useRef(0);

  // ── Edge resize via invisible strips ────────────────────────────────

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
      // If not on edge, do nothing — let the event pass through to canvas/UI
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      document.body.style.cursor = '';
    };
  }, []);

  // ── Hover detection (document-level) ────────────────────────────────

  useEffect(() => {
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    document.documentElement.addEventListener('mouseenter', enter);
    document.documentElement.addEventListener('mouseleave', leave);
    return () => {
      document.documentElement.removeEventListener('mouseenter', enter);
      document.documentElement.removeEventListener('mouseleave', leave);
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

  // ── Titlebar drag handler ──────────────────────────────────────────

  const handleTitlebarMouseDown = useCallback(async (e: React.MouseEvent) => {
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
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: 'none',
        }}
      />

      {/* Titlebar — visible on hover, draggable */}
      <div
        onMouseDown={handleTitlebarMouseDown}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: TITLEBAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: `${BORDER_RADIUS}px ${BORDER_RADIUS}px 0 0`,
          background: 'rgba(10, 10, 15, 0.6)',
          backdropFilter: 'blur(8px)',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: hovered ? 'auto' : 'none',
          cursor: 'grab',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* Drag grip dots */}
        <div style={{
          display: 'flex',
          gap: 4,
          opacity: 0.4,
        }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.6)',
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}
