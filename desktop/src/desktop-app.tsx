/**
 * Desktop wrapper for the web app.
 *
 * Adds a transparent window chrome layer on top of the existing web App:
 * - Hover: dashed rounded border appears
 * - Drag border edges/corners: resize the window
 * - Drag anywhere else: move the window
 * - Right-click: rotate the 3D model (OrbitControls)
 * - Context menu suppressed
 *
 * The web App runs unchanged underneath — same WebSocket, same avatar engine.
 */
import { useEffect } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { WindowChrome } from './window-chrome.tsx';

export function DesktopApp() {
  const setTheme = useStore((s) => s.setTheme);

  // Force transparent theme in desktop mode
  useEffect(() => {
    setTheme('transparent');
    document.body.style.background = 'transparent';
  }, [setTheme]);

  // Suppress right-click context menu globally (right-click = rotate)
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  return (
    <>
      <App />
      <WindowChrome />
    </>
  );
}
