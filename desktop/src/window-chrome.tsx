/**
 * WindowChrome — transparent overlay for borderless window management.
 *
 * Interaction model:
 * - Left-drag anywhere on canvas → move window (via Tauri startDragging)
 * - Drag edges/corners → resize window (via Tauri startResizeDragging)
 * - Right-drag on canvas → rotate 3D model (OrbitControls, unaffected)
 * - Hover → dashed border + titlebar with close/pin buttons
 * - Escape (double-tap) → close window
 *
 * The titlebar and resize edges only appear on hover. When not hovered,
 * the window is fully click-through except for the invisible edge strips.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const EDGE_SIZE = 10;
const CORNER_SIZE = 20;
const BORDER_RADIUS = 12;
const TITLEBAR_HEIGHT = 32;

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

const btnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  cursor: 'pointer',
  transition: 'background 0.15s',
  color: 'rgba(232, 232, 240, 0.8)',
  background: 'rgba(255, 255, 255, 0.08)',
};

export function WindowChrome() {
  // ── Set --titlebar-inset CSS variable ───────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--titlebar-inset', `${TITLEBAR_HEIGHT}px`);
    // Round the window corners and clip content
    root.style.borderRadius = `${BORDER_RADIUS}px`;
    root.style.overflow = 'hidden';
    return () => {
      root.style.removeProperty('--titlebar-inset');
      root.style.borderRadius = '';
      root.style.overflow = '';
    };
  }, []);

  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(true); // alwaysOnTop default
  const lastEscapeRef = useRef(0);
  // Lock hover ON during resize — OS steals mouse events, so we
  // lock on resize start and unlock on next mouseenter.
  const hoverLockedRef = useRef(false);

  // ── Edge resize + left-click drag ───────────────────────────────────

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

    // Drag threshold: only start window drag after mouse moves 5px from mousedown.
    // This lets clicks pass through to UI elements and OrbitControls.
    const DRAG_THRESHOLD = 5;
    let dragOrigin: { x: number; y: number } | null = null;
    let dragStarted = false;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;

      // Skip UI elements — anything clickable/interactive should not trigger drag.
      // Check the target and its ancestors for interactive elements.
      const target = e.target as HTMLElement;
      if (
        target.closest('[data-no-drag]') ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('[role="switch"]') ||
        target.closest('[role="button"]') ||
        target.closest('[data-clickable]') ||
        // Any element with an onClick handler or pointer cursor is interactive
        window.getComputedStyle(target).cursor === 'pointer' ||
        target.closest('[style*="cursor: pointer"]') ||
        target.closest('[style*="cursor:pointer"]')
      ) {
        return;
      }

      // Edge resize — immediate, no threshold
      const dir = getResizeDirection(
        e.clientX, e.clientY, window.innerWidth, window.innerHeight,
      );
      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        hoverLockedRef.current = true;
        setHovered(true);
        getCurrentWindow().startResizeDragging(dir);
        return;
      }

      // Store origin for drag threshold check
      dragOrigin = { x: e.clientX, y: e.clientY };
      dragStarted = false;
    };

    const onMouseMoveForDrag = (e: MouseEvent) => {
      if (!dragOrigin || dragStarted) return;
      const dx = e.clientX - dragOrigin.x;
      const dy = e.clientY - dragOrigin.y;
      if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
        dragStarted = true;
        dragOrigin = null;
        getCurrentWindow().startDragging();
      }
    };

    const onMouseUp = () => {
      dragOrigin = null;
      dragStarted = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousemove', onMouseMoveForDrag);
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousemove', onMouseMoveForDrag);
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
    };
  }, []);

  // ── Hover detection ─────────────────────────────────────────────────

  useEffect(() => {
    const enter = () => {
      hoverLockedRef.current = false;
      setHovered(true);
    };
    const leave = () => {
      if (!hoverLockedRef.current) setHovered(false);
    };
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
          opacity: (hovered) ? 1 : 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: 'none',
        }}
      />

      {/* Titlebar — visible on hover */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: TITLEBAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 8px',
          gap: 4,
          borderRadius: `${BORDER_RADIUS}px ${BORDER_RADIUS}px 0 0`,
          background: 'rgba(10, 10, 15, 0.6)',
          backdropFilter: 'blur(8px)',
          opacity: (hovered) ? 1 : 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: (hovered) ? 'auto' : 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* Pin / always-on-top toggle */}
        <button
          data-no-drag
          onClick={handleTogglePin}
          title={pinned ? 'Unpin from top' : 'Pin to top'}
          style={{
            ...btnStyle,
            color: pinned ? 'var(--color-accent, #6c5ce7)' : 'rgba(232, 232, 240, 0.5)',
          }}
        >
          📌
        </button>

        {/* Close */}
        <button
          data-no-drag
          onClick={handleClose}
          title="Close"
          style={{
            ...btnStyle,
            fontSize: 14,
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(231, 76, 60, 0.6)'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = btnStyle.background as string; }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
