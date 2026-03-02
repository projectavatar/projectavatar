/**
 * Desktop wrapper for the web app.
 *
 * Forces transparent theme and suppresses the right-click context menu
 * (right-click is reserved for 3D rotation via OrbitControls).
 * Window chrome (titlebar, resize handles) is overlaid by WindowChrome.
 * Auto-updater checks for new versions on launch.
 *
 * Click-through: the window is click-through on transparent areas.
 * Only the avatar model captures cursor events. UI chrome (border, buttons)
 * appears on hover and hides 1s after the cursor leaves.
 */
import { useEffect, useState, useCallback } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { WindowChrome } from './window-chrome.tsx';
import { Updater } from './updater.tsx';
import { useClickThrough } from './use-click-through.ts';
import { DebugHitbox } from './debug-hitbox.tsx';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Cursor poll rate for desktop — 5fps for both tracking and hit-testing. */
const CURSOR_POLL_MS = 200;

/** Enable hitbox debug overlay — set to true during development. */
const DEBUG_HITBOX = import.meta.env.DEV;

export function DesktopApp() {
  const setTheme = useStore((s) => s.setTheme);
  const setAssetBaseUrl = useStore((s) => s.setAssetBaseUrl);
  const [avatarScene, setAvatarScene] = useState<AvatarScene | null>(null);

  // Click-through: polls cursor at 5fps, tests against VRM bounding box
  const { hovered, debugBbox } = useClickThrough(avatarScene, DEBUG_HITBOX);

  const handleScene = useCallback((scene: AvatarScene | null) => {
    setAvatarScene(scene);
  }, []);

  // Force transparent theme — desktop window has no background
  // Set remote asset base URL — desktop fetches assets from web CDN
  useEffect(() => {
    setTheme('transparent');
    setAssetBaseUrl(import.meta.env.VITE_ASSET_BASE_URL || 'https://app.projectavatar.io');
  }, [setTheme, setAssetBaseUrl]);

  // Suppress right-click context menu (right-click = rotate model)
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  return (
    <>
      <App onScene={handleScene} cursorPollMs={CURSOR_POLL_MS} />
      <WindowChrome hovered={hovered} />
      <Updater />
      {DEBUG_HITBOX && <DebugHitbox bbox={debugBbox} />}
    </>
  );
}
