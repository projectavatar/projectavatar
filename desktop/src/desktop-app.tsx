/**
 * Desktop wrapper for the web app.
 *
 * Forces transparent theme and suppresses the right-click context menu
 * (right-click is reserved for 3D rotation via OrbitControls).
 * Window chrome (titlebar, resize handles) is overlaid by WindowChrome.
 */
import { useEffect } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { WindowChrome } from './window-chrome.tsx';

export function DesktopApp() {
  const setTheme = useStore((s) => s.setTheme);

  // Force transparent theme — desktop window has no background
  useEffect(() => {
    setTheme('transparent');
  }, [setTheme]);

  // Suppress right-click context menu (right-click = rotate model)
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
