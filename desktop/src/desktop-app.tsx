/**
 * Desktop wrapper for the web app.
 *
 * Forces transparent theme and suppresses the right-click context menu
 * (right-click is reserved for 3D rotation via OrbitControls).
 * Window chrome (titlebar, resize handles) is overlaid by WindowChrome.
 * Auto-updater checks for new versions on launch.
 */
import { useEffect } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { WindowChrome } from './window-chrome.tsx';
import { Updater } from './updater.tsx';

// Autostart opt-in — user enables via Settings → General
// (first-launch auto-enable removed to avoid dark pattern)

export function DesktopApp() {
  const setTheme = useStore((s) => s.setTheme);
  const setAssetBaseUrl = useStore((s) => s.setAssetBaseUrl);

  // Force transparent theme — desktop window has no background
  // Set remote asset base URL — desktop fetches assets from web CDN
  useEffect(() => {
    setTheme('transparent');
    setAssetBaseUrl('https://app.projectavatar.io');
  }, [setTheme, setAssetBaseUrl]);

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
