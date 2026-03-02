/**
 * WindowChrome — minimal overlay for fullscreen desktop mode.
 *
 * All visible chrome (grip, pin, close, resize handles, dashed border)
 * has been removed. Settings and quit live in the system tray.
 *
 * Escape (double-tap) still closes the window as a safety hatch.
 */
import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function WindowChrome() {
  const lastEscapeRef = useRef(0);

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

  return null;
}
