/**
 * Desktop wrapper for the web app — small auto-sizing window mode.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { useEscapeClose } from './window-chrome.tsx';
import { Updater } from './updater.tsx';
import { useClickThrough, CURSOR_POLL_MS } from './use-click-through.ts';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Minimum window size (CSS pixels). */
const MIN_WIDTH = 300;
const MIN_HEIGHT = 400;
/** How often to check avatar bounds for auto-resize (ms). */
const RESIZE_POLL_MS = 500;
/** Minimum size change (px) before triggering a resize. */
const RESIZE_THRESHOLD = 30;

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

    // Desktop: dragging moves the window, not the avatar inside it.
    // We cache position/invoke to avoid async overhead at 60fps.
    if (scene) {
      let cachedX = 0;
      let cachedY = 0;
      let cachedW = 0;
      let cachedH = 0;
      let invokeRef: ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null = null;
      let dragging = false;

      // Pre-load Tauri APIs
      Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/window'),
      ]).then(([{ invoke }, { getCurrentWindow }]) => {
        invokeRef = invoke;
        const win = getCurrentWindow();
        // Refresh cached position before each drag starts
        scene.setOnPan((dx, dy) => {
          if (!invokeRef) return;
          if (!dragging) {
            dragging = true;
            // Sync cache on drag start (one async call)
            win.outerPosition().then((pos) => { cachedX = pos.x; cachedY = pos.y; });
            win.outerSize().then((size) => { cachedW = size.width; cachedH = size.height; });
          }
          const scale = window.devicePixelRatio || 1;
          cachedX += Math.round(dx * scale);
          cachedY += Math.round(dy * scale);
          void invokeRef('set_window_rect', {
            x: cachedX, y: cachedY, width: cachedW, height: cachedH,
          });
        });
        // Reset dragging flag on pointerup
        window.addEventListener('pointerup', () => { dragging = false; });
      }).catch(() => { /* Not in Tauri */ });
    }
  }, []);

  useEffect(() => {
    setTheme('transparent');
    setAssetBaseUrl(import.meta.env.VITE_ASSET_BASE_URL || 'https://app.projectavatar.io');
  }, [setTheme, setAssetBaseUrl]);

  // Signal Rust that frontend is ready — set small default window.
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

  // Auto-resize window to fit avatar bounds
  useEffect(() => {
    if (!avatarScene) return;
    let lastW = 0;
    let lastH = 0;

    const poll = async () => {
      const bounds = avatarScene.getAvatarBounds();
      if (!bounds) return;

      const targetW = Math.max(MIN_WIDTH, bounds.width);
      const targetH = Math.max(MIN_HEIGHT, bounds.height);

      // Only resize if change exceeds threshold (avoids jitter)
      if (Math.abs(targetW - lastW) < RESIZE_THRESHOLD && Math.abs(targetH - lastH) < RESIZE_THRESHOLD) return;

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const scale = window.devicePixelRatio || 1;
        // Convert CSS pixels to physical pixels for Tauri
        const physW = Math.round(targetW * scale);
        const physH = Math.round(targetH * scale);

        // Get current position to keep window in place
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const pos = await win.outerPosition();

        await invoke('set_window_rect', {
          x: pos.x,
          y: pos.y,
          width: physW,
          height: physH,
        });

        lastW = targetW;
        lastH = targetH;
      } catch { /* Not in Tauri runtime */ }
    };

    const id = setInterval(poll, RESIZE_POLL_MS);
    // Run once immediately after a short delay for model to load
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
