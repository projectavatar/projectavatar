/**
 * Desktop wrapper for the web app.
 *
 * Click-through state machine:
 * - Mouse outside window (1s) → click-through ON, UI hidden
 * - Mouse inside window, outside hitbox → click-through ON
 * - Mouse enters hitbox → activated — click-through OFF, chrome + UI visible
 * - Stays activated until mouse leaves window (+ 1s timeout)
 */
import { useEffect, useState, useCallback } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { WindowChrome } from './window-chrome.tsx';
import { Updater } from './updater.tsx';
import { useClickThrough } from './use-click-through.ts';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Cursor poll rate for desktop — 5fps for both tracking and hit-testing. */
const CURSOR_POLL_MS = 200;

export function DesktopApp() {
  const setTheme = useStore((s) => s.setTheme);
  const setAssetBaseUrl = useStore((s) => s.setAssetBaseUrl);
  const [avatarScene, setAvatarScene] = useState<AvatarScene | null>(null);

  const { hovered } = useClickThrough(avatarScene);

  const handleScene = useCallback((scene: AvatarScene | null) => {
    setAvatarScene(scene);
  }, []);

  useEffect(() => {
    setTheme('transparent');
    setAssetBaseUrl(import.meta.env.VITE_ASSET_BASE_URL || 'https://app.projectavatar.io');
  }, [setTheme, setAssetBaseUrl]);

  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  return (
    <>
      <App onScene={handleScene} cursorPollMs={CURSOR_POLL_MS} activated={hovered} />
      <WindowChrome hovered={hovered} />
      <Updater />
    </>
  );
}
