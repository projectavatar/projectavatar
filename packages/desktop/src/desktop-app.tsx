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

  // Signal Rust that frontend is ready, then restore saved monitor.
  // Sequential: frontend_ready (primary) → restore saved monitor (if any).
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // Wait for first transparent frame to render
        await new Promise((r) => setTimeout(r, 200));
        if (cancelled) return;

        // Step 1: expand to primary monitor
        await invoke('frontend_ready');

        // Step 2: restore saved monitor (if available)
        const saved = localStorage.getItem('desktop-monitor');
        if (saved) {
          const { name } = JSON.parse(saved);
          if (name) {
            const { availableMonitors } = await import('@tauri-apps/api/window');
            const monitors = await availableMonitors();
            const target = monitors.find(m => m.name === name);
            if (target && !cancelled) {
              await invoke('move_to_monitor', {
                x: target.position.x, y: target.position.y,
                width: target.size.width, height: target.size.height,
              });
            }
          }
        }
      } catch (e) {
        console.error('[desktop] init failed:', e);
      }
    };
    void init();
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
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('move-to-monitor', async (event) => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const target = event.payload as { x: number; y: number; width: number; height: number; name: string };

          // Proportional pan transfer using live pan state
          if (avatarScene) {
            const canvas = avatarScene.renderer.domElement;
            const oldW = canvas.width;
            const oldH = canvas.height;
            if (oldW > 0 && oldH > 0) {
              const pan = avatarScene.getPan();
              avatarScene.setPan(
                pan.x * (target.width / oldW),
                pan.y * (target.height / oldH),
              );
            }
          }

          await invoke('move_to_monitor', { x: target.x, y: target.y, width: target.width, height: target.height });
          localStorage.setItem('desktop-monitor', JSON.stringify({ name: target.name }));
        } catch (e) {
          console.error('[desktop] move-to-monitor failed:', e);
        }
      }).then((fn) => { unlisten = fn; });
    }).catch((e) => console.error('[desktop] event listen failed:', e));
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
