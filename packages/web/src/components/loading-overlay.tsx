/**
 * LoadingOverlay — minimal progress bar for asset loading.
 *
 * Centered at the bottom of the viewport. Shows current phase label
 * and a smooth animated progress bar. Fades out when complete.
 */
import { useEffect, useState } from 'react';

export interface LoadingState {
  /** Current phase label, e.g. "Loading model..." */
  label: string;
  /** Progress 0–1. null = indeterminate. */
  progress: number | null;
  /** Whether loading is complete (triggers fade-out). */
  done: boolean;
}

const FADE_OUT_MS = 400;

export function LoadingOverlay({ state }: { state: LoadingState }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (state.done) {
      const timer = setTimeout(() => setVisible(false), FADE_OUT_MS);
      return () => clearTimeout(timer);
    }
    setVisible(true);
  }, [state.done]);

  if (!visible) return null;

  const pct = state.progress != null ? Math.round(state.progress * 100) : null;

  return (
    <div style={{
      position: 'absolute',
      bottom: 32,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      opacity: state.done ? 0 : 1,
      transition: `opacity ${FADE_OUT_MS}ms ease`,
      pointerEvents: 'none',
      zIndex: 10,
    }}>
      {/* Label */}
      <div style={{
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: 11,
        fontFamily: 'var(--font-mono, monospace)',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        {state.label}{pct != null ? ` ${pct}%` : ''}
      </div>

      {/* Progress bar track */}
      <div style={{
        width: 180,
        height: 3,
        borderRadius: 2,
        background: 'rgba(255, 255, 255, 0.1)',
        overflow: 'hidden',
      }}>
        {/* Fill */}
        <div style={{
          height: '100%',
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.6)',
          transition: 'width 0.15s ease-out',
          width: pct != null ? `${pct}%` : '30%',
          // Indeterminate: shimmer animation
          ...(pct == null ? {
            animation: 'loading-shimmer 1.2s ease-in-out infinite',
          } : {}),
        }} />
      </div>

      {/* Keyframes for indeterminate mode */}
      <style>{`
        @keyframes loading-shimmer {
          0%   { transform: translateX(-100%); width: 30%; }
          50%  { width: 60%; }
          100% { transform: translateX(350%); width: 30%; }
        }
      `}</style>
    </div>
  );
}
