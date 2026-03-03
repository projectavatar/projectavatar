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

  // Auto-resize window to fit avatar (always square, centered, smooth lerp)
  useEffect(() => {
    if (!avatarScene) return;
    const MIN_SIZE = 400;
    const BOUNDS_POLL_MS = 500;
    const LERP_SPEED = 0.08; // ~12 frames to 90% of target at 60fps
    const SNAP_THRESHOLD = 1; // snap when within 1px

    let targetSize = 0;
    let currentSize = 0;
    let animating = false;
    let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
    let tauriWin: { scaleFactor(): Promise<number>; outerPosition(): Promise<{ x: number; y: number }>; outerSize(): Promise<{ width: number; height: number }> } | null = null;

    // Lazy-load Tauri APIs once
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

    // Poll bounds at low frequency to update target.
    // Uses NDC span (window-independent) to compute ideal window size.
    // ndcW/ndcH are in [0..2] range. Divide by 2 to get fraction of window.
    // We want the avatar to fill ~70% of the window → size = refPixels / 0.7
    const FILL_RATIO = 0.7;
    const pollBounds = () => {
      const bounds = avatarScene.getAvatarBounds();
      if (!bounds) return;
      // NDC span → how many CSS pixels the avatar needs at a given window size
      // At windowSize W, avatar takes (ndcSpan/2)*W pixels.
      // We want (ndcSpan/2)*W / W = FILL_RATIO → W = doesn't help.
      // Instead: the avatar's world-space angular size is fixed by zoom.
      // ndcSpan/2 = fraction of any window it fills.
      // To fill FILL_RATIO: windowSize = avatarNeedsPixels / FILL_RATIO
      // avatarNeedsPixels at ref 1000px = (ndcSpan/2) * 1000
      const REF = 1000;
      const avatarW = (bounds.ndcW / 2) * REF;
      const avatarH = (bounds.ndcH / 2) * REF;
      const needed = Math.max(avatarW, avatarH);
      const newTarget = Math.max(MIN_SIZE, Math.ceil(needed / FILL_RATIO));
      if (newTarget !== targetSize) {
        targetSize = newTarget;
        if (currentSize === 0) currentSize = targetSize;
        if (!animating) startLerp();
      }
    };

    // Smooth lerp loop via requestAnimationFrame
    let rafId = 0;
    const lerpFrame = async () => {
      if (Math.abs(currentSize - targetSize) < SNAP_THRESHOLD) {
        currentSize = targetSize;
        animating = false;
      }

      const prevSize = Math.round(currentSize);
      currentSize += (targetSize - currentSize) * LERP_SPEED;
      const newSize = Math.round(currentSize);

      if (newSize !== prevSize && tauriInvoke && tauriWin) {
        try {
          const scale = await tauriWin.scaleFactor();
          const pos = await tauriWin.outerPosition();
          const size = await tauriWin.outerSize();
          const newPhysSize = Math.round(newSize * scale);
          const dx = Math.round((size.width - newPhysSize) / 2);
          const dy = Math.round((size.height - newPhysSize) / 2);
          await tauriInvoke('set_window_rect', {
            x: pos.x + dx, y: pos.y + dy,
            width: newPhysSize, height: newPhysSize,
          });
        } catch { /* skip frame */ }
      }

      if (animating) rafId = requestAnimationFrame(lerpFrame);
    };

    const startLerp = async () => {
      if (!(await ensureTauri())) return;
      animating = true;
      rafId = requestAnimationFrame(lerpFrame);
    };

    const boundsId = setInterval(pollBounds, BOUNDS_POLL_MS);
    const initialId = setTimeout(pollBounds, 2000);

    return () => {
      clearInterval(boundsId);
      clearTimeout(initialId);
      animating = false;
      cancelAnimationFrame(rafId);
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
