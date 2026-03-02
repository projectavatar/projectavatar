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

const pillStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 14px',
  background: 'rgba(10, 10, 15, 0.85)',
  backdropFilter: 'blur(8px)',
  border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
  borderRadius: 20,
  fontSize: 11,
  fontFamily: 'var(--font-mono, monospace)',
  letterSpacing: '0.03em',
  color: 'rgba(232, 232, 240, 0.8)',
  whiteSpace: 'nowrap' as const,
};

const barTrackStyle: React.CSSProperties = {
  width: 120,
  height: 3,
  borderRadius: 2,
  background: 'rgba(255,255,255,0.1)',
  overflow: 'hidden',
  flexShrink: 0,
};

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
        if (!cancelled) {
          console.warn('[Updater] Check failed:', err);
        }
      }
    }

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
      top: 48,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10000,
      pointerEvents: 'auto',
    }}>
      <div data-no-drag style={pillStyle}>
        {state.status === 'available' && (
          <span>update v{state.version} found...</span>
        )}

        {state.status === 'downloading' && (
          <>
            <span>downloading update...</span>
            <div style={barTrackStyle}>
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
                borderRadius: 10,
                padding: '3px 10px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              restart
            </button>
          </>
        )}

        {state.status === 'error' && (
          <span style={{ color: 'rgba(231, 76, 60, 0.8)' }}>
            update failed
          </span>
        )}
      </div>
    </div>
  );
}
