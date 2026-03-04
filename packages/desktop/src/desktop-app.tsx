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

  // Restore saved monitor on launch (after frontend_ready sets primary).
  useEffect(() => {
    const restore = async () => {
      try {
        const saved = localStorage.getItem('desktop-monitor');
        if (!saved) return;
        const { name } = JSON.parse(saved);
        if (!name) return;

        const { invoke } = await import('@tauri-apps/api/core');
        const { availableMonitors } = await import('@tauri-apps/api/window');
        const monitors = await availableMonitors();
        const target = monitors.find(m => m.name === name);

        if (target) {
          const pos = target.position;
          const size = target.size;
          await invoke('move_to_monitor', {
            x: pos.x, y: pos.y, width: size.width, height: size.height,
          });
        }
        // If not found, stay on primary (frontend_ready already set it)
      } catch { /* skip */ }
    };
    // Delay to let frontend_ready run first
    const timer = setTimeout(restore, 500);
    return () => clearTimeout(timer);
  }, []);

  // Signal Rust that frontend is ready — expand 1×1 window to fullscreen.
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

  // Listen for tray "Move to Screen" event — proportional pan transfer + save
  useEffect(() => {
    if (!avatarScene) return;
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('move-to-monitor', async (event) => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const winMod = await import('@tauri-apps/api/window');
          const win = winMod.getCurrentWindow() as unknown as {
            outerSize(): Promise<{ width: number; height: number }>;
            scaleFactor(): Promise<number>;
          };

          const target = event.payload as { x: number; y: number; width: number; height: number; name: string };
          const oldSize = await win.outerSize();
          const oldScale = await win.scaleFactor();
          const oldW = oldSize.width / oldScale;
          const oldH = oldSize.height / oldScale;
          const newW = target.width / oldScale; // approximate
          const newH = target.height / oldScale;

          // Proportional pan transfer: scale panX/panY by size ratio
          if (avatarScene && oldW > 0 && oldH > 0) {
            const cam = avatarScene.camera;
            // Read current pan from saved state
            const saved = localStorage.getItem('avatar-camera');
            if (saved) {
              try {
                const state = JSON.parse(saved);
                if (typeof state.panX === 'number' && typeof state.panY === 'number') {
                  state.panX = state.panX * (target.width / oldSize.width);
                  state.panY = state.panY * (target.height / oldSize.height);
                  localStorage.setItem('avatar-camera', JSON.stringify(state));
                }
              } catch { /* skip */ }
            }
          }

          await invoke('move_to_monitor', { x: target.x, y: target.y, width: target.width, height: target.height });

          // Save which monitor she's on
          localStorage.setItem('desktop-monitor', JSON.stringify({ name: target.name }));
        } catch { /* skip */ }
      }).then((fn) => { unlisten = fn; });
    }).catch(() => { /* Not in Tauri runtime */ });
    return () => { unlisten?.(); };
  }, [avatarScene]);

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
