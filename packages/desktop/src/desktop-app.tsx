/**
 * Desktop wrapper for the web app.
 *
 * Click-through state machine:
 * - Mouse outside window (1s) → click-through ON, UI hidden
 * - Mouse inside window, outside hitbox → click-through ON
 * - Mouse hovers hitbox 0.5s → activated — click-through OFF, chrome + UI visible
 * - Stays activated until mouse leaves window (+ 1s timeout)
 *
 * useClickThrough drives both hit-testing AND cursor tracking (single poll).
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { WindowChrome } from './window-chrome.tsx';
import { Updater } from './updater.tsx';
import { useClickThrough, CURSOR_POLL_MS } from './use-click-through.ts';
import type { AvatarScene } from '@project-avatar/avatar-engine';

export function DesktopApp() {
  const setTheme = useStore((s) => s.setTheme);
  const setAssetBaseUrl = useStore((s) => s.setAssetBaseUrl);
  const [avatarScene, setAvatarScene] = useState<AvatarScene | null>(null);

  // projectCursor ref — set by AvatarCanvas, called by useClickThrough
  const projectCursorRef = useRef<((ndcX: number, ndcY: number) => void) | null>(null);

  const handleProjectCursor = useCallback((fn: ((ndcX: number, ndcY: number) => void) | null) => {
    projectCursorRef.current = fn;
  }, []);

  const handleCursorNdc = useCallback((ndcX: number, ndcY: number) => {
    projectCursorRef.current?.(ndcX, ndcY);
  }, []);

  // Click-through: single 5fps poll drives both hit-testing and cursor tracking
  const { hovered } = useClickThrough(avatarScene, handleCursorNdc);

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
      <App
        onScene={handleScene}
        cursorPollMs={CURSOR_POLL_MS}
        externalCursorPoll
        onProjectCursor={handleProjectCursor}
        activated={hovered}
      />
      <WindowChrome hovered={hovered} />
      <Updater />
    </>
  );
}
