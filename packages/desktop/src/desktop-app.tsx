/**
 * Desktop wrapper for the web app — small draggable window mode.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { useEscapeClose } from './window-chrome.tsx';
import { Updater } from './updater.tsx';
import { useClickThrough, CURSOR_POLL_MS } from './use-click-through.ts';
import type { AvatarScene } from '@project-avatar/avatar-engine';

export function DesktopApp() {
  const setTheme = useStore((s) => s.setTheme);
  const setAssetBaseUrl = useStore((s) => s.setAssetBaseUrl);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [avatarScene, setAvatarScene] = useState<AvatarScene | null>(null);

  const projectCursorRef = useRef<((ndcX: number, ndcY: number) => void) | null>(null);

  const handleProjectCursor = useCallback((fn: ((ndcX: number, ndcY: number) => void) | null) => {
    projectCursorRef.current = fn;
  }, []);

  const handleCursorNdc = useCallback((ndcX: number, ndcY: number) => {
    projectCursorRef.current?.(ndcX, ndcY);
  }, []);

  const { hovered } = useClickThrough(avatarScene, handleCursorNdc, settingsOpen);

  const handleScene = useCallback((scene: AvatarScene | null) => {
    setAvatarScene(scene);
  }, []);

  useEffect(() => {
    setTheme('transparent');
    setAssetBaseUrl(import.meta.env.VITE_ASSET_BASE_URL || 'https://app.projectavatar.io');
  }, [setTheme, setAssetBaseUrl]);

  // Signal Rust that frontend is ready — set small window at bottom-right.
  // The 200ms delay ensures:
  // 1. First transparent frame is rendered (no flash)
  // 2. useClickThrough hook has initialized and set click-through ON
  useEffect(() => {
    let cancelled = false;
    const signal = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await new Promise((r) => setTimeout(r, 200));
        if (!cancelled) {
          await invoke('frontend_ready');
        }
      } catch { /* Not in Tauri runtime */ }
    };
    void signal();
    return () => { cancelled = true; };
  }, []);

  // Auto-resize window to fit avatar (always square, centered, single snap)
  useEffect(() => {
    if (!avatarScene) return;
    const MIN_SIZE = 400;
    const POLL_MS = 500;
    const THRESHOLD = 20;
    const FILL_RATIO = 0.9;
    const REF = 1000;

    let lastPhysSize = 0;
    let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
    let tauriWin: { scaleFactor(): Promise<number>; outerPosition(): Promise<{ x: number; y: number }>; outerSize(): Promise<{ width: number; height: number }> } | null = null;

    const ensureTauri = async () => {
      if (tauriInvoke) return true;
      try {
        const core = await import('@tauri-apps/api/core');
        const winMod = await import('@tauri-apps/api/window');
        tauriInvoke = core.invoke;
        tauriWin = winMod.getCurrentWindow() as unknown as typeof tauriWin;
        return true;
      } catch { return false; }
    };

    const poll = async () => {
      const bounds = avatarScene.getAvatarBounds();
      if (!bounds || !(await ensureTauri()) || !tauriInvoke || !tauriWin) return;

      const needed = Math.max((bounds.ndcW / 2) * REF, (bounds.ndcH / 2) * REF);
      const cssSize = Math.max(MIN_SIZE, Math.ceil(needed / FILL_RATIO));
      const scale = await tauriWin.scaleFactor();
      const newPhysSize = Math.round(cssSize * scale);

      if (Math.abs(newPhysSize - lastPhysSize) < THRESHOLD * scale) return;

      const pos = await tauriWin.outerPosition();
      const size = await tauriWin.outerSize();
      const dx = Math.round((size.width - newPhysSize) / 2);
      const dy = Math.round((size.height - newPhysSize) / 2);

      await tauriInvoke('set_window_rect', {
        x: pos.x + dx, y: pos.y + dy,
        width: newPhysSize, height: newPhysSize,
      });
      lastPhysSize = newPhysSize;
    };

    const id = setInterval(poll, POLL_MS);
    const initialId = setTimeout(poll, 2000);

    return () => {
      clearInterval(id);
      clearTimeout(initialId);
    };
  }, [avatarScene]);

  // Listen for tray "Settings" menu event from Rust
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('tray-open-settings', () => {
        setSettingsOpen(true);
      }).then((fn) => { unlisten = fn; });
    }).catch(() => { /* Not in Tauri runtime */ });
    return () => { unlisten?.(); };
  }, [setSettingsOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  // Double-tap Escape to close
  useEscapeClose();

  // Cursor: grab on hover (but not when settings is open)
  useEffect(() => {
    document.body.style.cursor = (hovered && !settingsOpen) ? 'grab' : 'default';
    return () => { document.body.style.cursor = ''; };
  }, [hovered, settingsOpen]);

  return (
    <>
      <App
        onScene={handleScene}
        cursorPollMs={CURSOR_POLL_MS}
        externalCursorPoll
        onProjectCursor={handleProjectCursor}
        activated={hovered}
        hideSettings
      />
      <Updater />
    </>
  );
}
