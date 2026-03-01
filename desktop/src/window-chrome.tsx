/**
 * WindowChrome — transparent overlay for window management.
 *
 * Interaction model:
 * - Mouse near edges/corners (within EDGE px) → resize cursor, left-drag to resize
 * - Left-drag anywhere else → move the window
 * - Right-drag anywhere → rotate the 3D model (passes through to OrbitControls)
 * - Hover → dashed rounded border fades in
 * - Escape → close the window
 *
 * Architecture:
 * The overlay sits above the canvas at z-index 9999. The INNER area
 * (not near edges) has pointerEvents: none so right-clicks pass through
 * to OrbitControls. The edge strips always capture events.
 *
 * Left-click behavior:
 * - On edge → startResizeDragging
 * - On inner area → we intercept via a document-level mousedown and
 *   call startDragging if no resize direction is detected
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Edge hit zone size in px */
const EDGE = 6;
/** Corner hit zone size in px (extends further for easier grab) */
const CORNER = 14;
/** Border radius for the dashed outline */
const RADIUS = 12;

type ResizeDirection =
  | 'Top' | 'Bottom' | 'Left' | 'Right'
  | 'TopLeft' | 'TopRight' | 'BottomLeft' | 'BottomRight';

function getResizeDirection(
  x: number, y: number, w: number, h: number,
): ResizeDirection | null {
  const top = y < EDGE;
  const bottom = y > h - EDGE;
  const left = x < EDGE;
  const right = x > w - EDGE;

  // Corners first (larger area)
  if (x < CORNER && y < CORNER) return 'TopLeft';
  if (x > w - CORNER && y < CORNER) return 'TopRight';
  if (x < CORNER && y > h - CORNER) return 'BottomLeft';
  if (x > w - CORNER && y > h - CORNER) return 'BottomRight';

  // Edges
  if (top) return 'Top';
  if (bottom) return 'Bottom';
  if (left) return 'Left';
  if (right) return 'Right';

  return null;
}

function getCursorForDirection(dir: ResizeDirection | null): string {
  switch (dir) {
    case 'Top': case 'Bottom': return 'ns-resize';
    case 'Left': case 'Right': return 'ew-resize';
    case 'TopLeft': case 'BottomRight': return 'nwse-resize';
    case 'TopRight': case 'BottomLeft': return 'nesw-resize';
    default: return 'default';
  }
}

export function WindowChrome() {
  const [hovered, setHovered] = useState(false);
  const [cursorDir, setCursorDir] = useState<ResizeDirection | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // Track mouse to determine if we're on an edge
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const dir = getResizeDirection(
      e.clientX, e.clientY, window.innerWidth, window.innerHeight,
    );
    setCursorDir(dir);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  // Global left-click handler: resize on edges, drag-move elsewhere
  useEffect(() => {
    const handler = async (e: MouseEvent) => {
      if (e.button !== 0) return; // Only left-click

      const dir = getResizeDirection(
        e.clientX, e.clientY, window.innerWidth, window.innerHeight,
      );

      const appWindow = getCurrentWindow();

      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        await appWindow.startResizeDragging(dir);
      } else {
        // Left-drag in inner area = move window
        // But don't steal clicks from UI elements (buttons, inputs, etc.)
        const target = e.target as HTMLElement;
        const isInteractive = target.closest('button, input, select, textarea, a, [role="button"], [data-no-drag]');
        if (!isInteractive) {
          e.preventDefault();
          await appWindow.startDragging();
        }
      }
    };

    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  // Track window hover via mouseenter/mouseleave on document
  useEffect(() => {
    const enter = () => setHovered(true);
    const leave = () => { setHovered(false); setCursorDir(null); };
    document.documentElement.addEventListener('mouseenter', enter);
    document.documentElement.addEventListener('mouseleave', leave);
    return () => {
      document.documentElement.removeEventListener('mouseenter', enter);
      document.documentElement.removeEventListener('mouseleave', leave);
    };
  }, []);

  // Set cursor on body based on edge detection
  useEffect(() => {
    document.body.style.cursor = cursorDir
      ? getCursorForDirection(cursorDir)
      : '';
  }, [cursorDir]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') getCurrentWindow().close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      ref={frameRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none', // Click-through — events handled globally
      }}
    >
      {/* Dashed border — visible on hover */}
      <div
        style={{
          position: 'absolute',
          inset: 2,
          borderRadius: RADIUS,
          border: '2px dashed rgba(255, 255, 255, 0.35)',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
