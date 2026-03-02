/**
 * Desktop wrapper for the web app.
 *
 * Fullscreen mode — window covers the entire primary monitor.
 * No window chrome, no border, no resize handles.
 * Settings and quit are in the system tray.
 *
 * Startup sequence:
 * 1. Rust setup: positions + sizes window to primary monitor (stays hidden)
 * 2. Frontend mounts, renders transparent canvas
 * 3. Frontend calls `frontend_ready` → Rust shows window + enables click-through
 * 4. useClickThrough poll takes over hit-testing
 *
 * Click-through state machine (fullscreen):
 * - Mouse on avatar hitbox → click-through OFF (interact with avatar)
 * - Mouse off avatar hitbox → click-through ON (interact with desktop)
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

  // Signal Rust that frontend is ready — show window + enable click-through
  useEffect(() => {
    let cancelled = false;
    const signal = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // Small delay to ensure the first frame has rendered transparent
        await new Promise((r) => setTimeout(r, 100));
        if (!cancelled) {
          await invoke('frontend_ready');
        }
      } catch {
        // Not in Tauri runtime — ignore
      }
    };
    void signal();
    return () => { cancelled = true; };
  }, []);

  // Bridge: tray "Settings" menu item calls window.__trayOpenSettings()
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

  return (
    <>
      <App
        onScene={handleScene}
        cursorPollMs={CURSOR_POLL_MS}
        externalCursorPoll
        onProjectCursor={handleProjectCursor}
        activated={hovered}
      />
      <WindowChrome />
      <Updater />
    </>
  );
}
