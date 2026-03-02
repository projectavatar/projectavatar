/**
 * useEscapeClose — double-tap Escape to close the window.
 * Safety hatch for fullscreen mode.
 */
import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useEscapeClose() {
  const lastEscapeRef = useRef(0);

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
}
