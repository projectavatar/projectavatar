/**
 * Desktop wrapper for the web app — fullscreen mode.
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
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [avatarScene, setAvatarScene] = useState<AvatarScene | null>(null);

  const projectCursorRef = useRef<((ndcX: number, ndcY: number) => void) | null>(null);

  const handleProjectCursor = useCallback((fn: ((ndcX: number, ndcY: number) => void) | null) => {
    projectCursorRef.current = fn;
  }, []);

  const handleCursorNdc = useCallback((ndcX: number, ndcY: number) => {
    projectCursorRef.current?.(ndcX, ndcY);
  }, []);

  const { hovered } = useClickThrough(avatarScene, handleCursorNdc);

  const handleScene = useCallback((scene: AvatarScene | null) => {
    setAvatarScene(scene);
  }, []);

  useEffect(() => {
    setTheme('transparent');
    setAssetBaseUrl(import.meta.env.VITE_ASSET_BASE_URL || 'https://app.projectavatar.io');
  }, [setTheme, setAssetBaseUrl]);

  // Signal Rust that frontend is ready — show window + enable click-through
  useEffect(() => {
    let cancelled = false;
    const signal = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await new Promise((r) => setTimeout(r, 100));
        if (!cancelled) {
          await invoke('frontend_ready');
        }
      } catch { /* Not in Tauri runtime */ }
    };
    void signal();
    return () => { cancelled = true; };
  }, []);

  // Bridge: tray "Settings" menu item
  useEffect(() => {
    (window as any).__trayOpenSettings = () => {
      setSettingsOpen(true);
    };
    return () => {
      delete (window as any).__trayOpenSettings;
    };
  }, [setSettingsOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  // Cursor: grab on hover, default otherwise
  useEffect(() => {
    document.body.style.cursor = hovered ? 'grab' : 'default';
    return () => { document.body.style.cursor = ''; };
  }, [hovered]);

  // Grabbing cursor while mouse is held
  useEffect(() => {
    if (!hovered) return;
    const onDown = () => { document.body.style.cursor = 'grabbing'; };
    const onUp = () => { document.body.style.cursor = 'grab'; };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    };
  }, [hovered]);

  return (
    <>
      <div style={{
        width: '100%',
        height: '100%',
        animation: hovered ? 'avatar-pulse 2s ease-in-out infinite' : 'none',
        opacity: hovered ? 1 : 0.92,
        transition: 'opacity 0.3s ease',
      }}>
        <App
          onScene={handleScene}
          cursorPollMs={CURSOR_POLL_MS}
          externalCursorPoll
          onProjectCursor={handleProjectCursor}
          activated={hovered}
        />
      </div>
      <WindowChrome />
      <Updater />
      <style>{`
        @keyframes avatar-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.95; }
        }
      `}</style>
    </>
  );
}
