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
import type { HitboxNdc } from './use-click-through.ts';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Debug overlay — visualizes the 2D projected hitbox as a dashed rectangle. */
function HitboxDebug({ hitbox, hovered }: { hitbox: HitboxNdc | null; hovered: boolean }) {
  if (!hitbox) return null;

  // Convert NDC (-1..1) to CSS percentages (0..100)
  // NDC: -1 = left/bottom, +1 = right/top
  // CSS: 0% = left/top, 100% = right/bottom
  const left   = ((hitbox.minX + 1) / 2) * 100;
  const right  = ((hitbox.maxX + 1) / 2) * 100;
  const top    = ((1 - hitbox.maxY) / 2) * 100; // flip Y
  const bottom = ((1 - hitbox.minY) / 2) * 100; // flip Y

  return (
    <div
      style={{
        position: 'fixed',
        left: `${left}%`,
        top: `${top}%`,
        width: `${right - left}%`,
        height: `${bottom - top}%`,
        border: `2px dashed ${hovered ? 'rgba(108, 92, 231, 0.8)' : 'rgba(231, 76, 60, 0.6)'}`,
        borderRadius: 4,
        pointerEvents: 'none',
        zIndex: 9998,
        transition: 'border-color 0.15s',
      }}
    >
      <span style={{
        position: 'absolute',
        top: -18,
        left: 0,
        fontSize: 10,
        fontFamily: 'monospace',
        color: hovered ? 'rgba(108, 92, 231, 0.9)' : 'rgba(231, 76, 60, 0.8)',
        background: 'rgba(0,0,0,0.6)',
        padding: '1px 4px',
        borderRadius: 3,
      }}>
        hitbox {hovered ? '(active)' : '(pass-through)'}
      </span>
    </div>
  );
}

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
  const { hovered, hitbox } = useClickThrough(avatarScene, handleCursorNdc);

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
      <HitboxDebug hitbox={hitbox} hovered={hovered} />
      <WindowChrome />
      <Updater />
    </>
  );
}
