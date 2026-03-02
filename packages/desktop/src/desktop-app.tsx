/**
 * Desktop wrapper for the web app — fullscreen mode.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { App } from '../../web/src/app.tsx';
import { useStore } from '../../web/src/state/store.ts';
import { WindowChrome } from './window-chrome.tsx';
import { Updater } from './updater.tsx';
import { useClickThrough, CURSOR_POLL_MS } from './use-click-through.ts';
import type { HitboxHull } from './use-click-through.ts';
import type { AvatarScene } from '@project-avatar/avatar-engine';

/** Debug overlay — visualizes the 2D convex hull hitbox as a polygon. */
function HitboxDebug({ hull, hovered }: { hull: HitboxHull | null; hovered: boolean }) {
  if (!hull || hull.length < 3) return null;

  // Convert NDC (-1..1) to SVG viewBox percentages (0..100)
  const points = hull.map((p) => {
    const x = ((p.x + 1) / 2) * 100;
    const y = ((1 - p.y) / 2) * 100; // flip Y
    return `${x},${y}`;
  }).join(' ');

  const color = hovered ? 'rgba(108, 92, 231, 0.8)' : 'rgba(231, 76, 60, 0.6)';
  const labelColor = hovered ? 'rgba(108, 92, 231, 0.9)' : 'rgba(231, 76, 60, 0.8)';

  // Find top-left point for label
  const topPoint = hull.reduce((best, p) =>
    (1 - p.y) / 2 < (1 - best.y) / 2 ? p : best
  );
  const labelX = ((topPoint.x + 1) / 2) * 100;
  const labelY = ((1 - topPoint.y) / 2) * 100 - 1.5;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 9998,
    }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%' }}
      >
        <polygon
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="0.15"
          strokeDasharray="0.5,0.3"
        />
      </svg>
      <span style={{
        position: 'absolute',
        left: `${labelX}%`,
        top: `${labelY}%`,
        fontSize: 10,
        fontFamily: 'monospace',
        color: labelColor,
        background: 'rgba(0,0,0,0.6)',
        padding: '1px 4px',
        borderRadius: 3,
        transform: 'translateX(-50%)',
        whiteSpace: 'nowrap',
      }}>
        hitbox {hovered ? '(active)' : '(pass-through)'} [{hull.length} pts]
      </span>
    </div>
  );
}

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

  const { hovered, hitboxHull } = useClickThrough(avatarScene, handleCursorNdc);

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

  return (
    <>
      <App
        onScene={handleScene}
        cursorPollMs={CURSOR_POLL_MS}
        externalCursorPoll
        onProjectCursor={handleProjectCursor}
        activated={hovered}
      />
      <HitboxDebug hull={hitboxHull} hovered={hovered} />
      <WindowChrome />
      <Updater />
    </>
  );
}
