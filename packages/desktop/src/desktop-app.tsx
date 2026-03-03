/**
 * Desktop wrapper for the web app — fullscreen mode.
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
  const setRenderScale = useStore((s) => s.setRenderScale);

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
    // Enable scissor rendering for multi-monitor: only the region around
    // the avatar is rendered, avoiding millions of wasted pixels.
    scene?.setScissorEnabled(true);

    // Use the highest DPI across all monitors so the avatar looks crisp
    // on any screen. The scissor rect keeps actual rendering cost low.
    if (scene) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke<{ max_scale_factor: number }>('get_virtual_screen').then((vs) => {
          setRenderScale(Math.min(vs.max_scale_factor, 2));
        });
      }).catch(() => { /* Not in Tauri runtime */ });
    }
  }, [setRenderScale]);

  useEffect(() => {
    setTheme('transparent');
    setAssetBaseUrl(import.meta.env.VITE_ASSET_BASE_URL || 'https://app.projectavatar.io');
  }, [setTheme, setAssetBaseUrl]);

  // Signal Rust that frontend is ready — expand 1×1 window to span all monitors.
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

  // Monitor hot-plug: when monitors change, re-expand window to new virtual screen
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('monitors-changed', async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const vs = await invoke<{ x: number; y: number; width: number; height: number; max_scale_factor: number }>('get_virtual_screen');

          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const win = getCurrentWindow();
          await win.setPosition(new (await import('@tauri-apps/api/dpi')).PhysicalPosition(vs.x, vs.y));
          await win.setSize(new (await import('@tauri-apps/api/dpi')).PhysicalSize(vs.width, vs.height));

          // Update DPI if it changed
          setRenderScale(Math.min(vs.max_scale_factor, 2));
        } catch (e) {
          console.warn('[DesktopApp] Failed to handle monitor change:', e);
        }
      }).then((fn) => { unlisten = fn; });
    }).catch(() => { /* Not in Tauri runtime */ });
    return () => { unlisten?.(); };
  }, [setRenderScale]);

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
