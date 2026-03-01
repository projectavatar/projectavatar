/**
 * Auto-updater — checks for updates on launch and shows a minimal
 * notification if one is available. Downloads + installs in background,
 * then prompts to restart.
 */
import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; progress: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

export function Updater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;

    async function checkForUpdate() {
      try {
        const update = await check();
        if (!update || cancelled) return;

        setState({ status: 'available', version: update.version });

        let downloaded = 0;
        let total = 0;

        await update.downloadAndInstall((event) => {
          if (cancelled) return;
          switch (event.event) {
            case 'Started':
              total = event.data.contentLength ?? 0;
              setState({ status: 'downloading', progress: 0 });
              break;
            case 'Progress':
              downloaded += event.data.chunkLength;
              setState({
                status: 'downloading',
                progress: total > 0 ? downloaded / total : 0,
              });
              break;
            case 'Finished':
              break;
          }
        });

        if (!cancelled) {
          setState({ status: 'ready', version: update.version });
        }
      } catch (err) {
        // Silently log — updater errors are not actionable for the user
        if (!cancelled) {
          console.warn('[Updater] Check failed:', err);
        }
      }
    }

    // Delay check by 3s so the app loads first
    const timer = setTimeout(checkForUpdate, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (state.status === 'idle') return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 12,
      left: 12,
      right: 12,
      zIndex: 10000,
      pointerEvents: 'auto',
    }}>
      <div
        data-no-drag
        style={{
          background: 'rgba(10, 10, 15, 0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(108, 92, 231, 0.4)',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: '0.8rem',
          color: 'rgba(232, 232, 240, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        {state.status === 'available' && (
          <span>Update v{state.version} found...</span>
        )}

        {state.status === 'downloading' && (
          <>
            <span>Downloading update...</span>
            <div style={{
              flex: 1,
              maxWidth: 120,
              height: 4,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.round(state.progress * 100)}%`,
                height: '100%',
                background: 'var(--color-accent, #6c5ce7)',
                borderRadius: 2,
                transition: 'width 0.2s ease',
              }} />
            </div>
          </>
        )}

        {state.status === 'ready' && (
          <>
            <span>v{state.version} ready</span>
            <button
              onClick={() => relaunch()}
              style={{
                background: 'var(--color-accent, #6c5ce7)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '4px 12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Restart
            </button>
          </>
        )}

        {state.status === 'error' && (
          <span style={{ color: 'rgba(231, 76, 60, 0.8)' }}>
            Update failed: {state.message}
          </span>
        )}
      </div>
    </div>
  );
}
