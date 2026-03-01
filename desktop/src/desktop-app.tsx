/**
 * Desktop wrapper for the web app.
 *
 * Forces transparent theme and suppresses the right-click context menu
 * (right-click is reserved for 3D rotation via OrbitControls).
 * Window chrome (titlebar, resize handles) is overlaid by WindowChrome.
 * Auto-updater checks for new versions on launch.
 *
 * Sets --titlebar-inset CSS variable so fixed-position UI elements
 * (settings button, drawers) clear the custom titlebar.
 */
import { useEffect } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { WindowChrome, TITLEBAR_HEIGHT } from './window-chrome.tsx';
import { Updater } from './updater.tsx';

export function DesktopApp() {
  const setTheme = useStore((s) => s.setTheme);

  // Force transparent theme — desktop window has no background
  useEffect(() => {
    setTheme('transparent');
  }, [setTheme]);

  // Set --titlebar-inset so fixed UI elements clear the titlebar
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--titlebar-inset',
      `${TITLEBAR_HEIGHT}px`,
    );
    return () => {
      document.documentElement.style.removeProperty('--titlebar-inset');
    };
  }, []);

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
      <Updater />
    </>
  );
}
