/**
 * Preview Panel — right side of the clip manager.
 * Renders a VRM model and plays FBX clips on it.
 * Body part masking is driven by the clip's bodyParts from ClipDetail.
 */
import { useRef, useEffect, useCallback, useState } from 'react';
import { ClipPreview } from './clip-preview.ts';
import type { ClipInfo } from './clip-preview.ts';
import { getBonesForParts } from '../body-parts.ts';

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--color-surface)',
  borderLeft: '1px solid var(--color-border)',
};

const canvasWrapStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
  minHeight: 0,
};

const controlsStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderTop: '1px solid var(--color-border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const transportStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text)',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  transition: 'border-color 0.15s',
};

const activeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  borderColor: 'var(--color-accent)',
  color: 'var(--color-accent)',
  background: 'var(--color-accent-dim)',
};

const timeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--color-text-muted)',
  minWidth: 90,
  textAlign: 'center',
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  accentColor: 'var(--color-accent)',
};

const clipNameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--color-accent)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const noClipStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--color-text-dim)',
  fontStyle: 'italic',
};

const speedRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--color-text-muted)',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface PreviewPanelProps {
  /** FBX clip path to play (relative to web/public/) */
  clipPath: string | null;
  /** VRM model URL to use */
  modelUrl: string;
  /** Body parts active for the current clip — drives bone masking */
  clipBodyParts?: string[];
  /** Called when preview is ready */
  onReady?: () => void;
}

const SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.0];

export function PreviewPanel({ clipPath, modelUrl, clipBodyParts, onReady }: PreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ClipPreview | null>(null);
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null);
  const [looping, setLooping] = useState(true);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [modelLoaded, setModelLoaded] = useState(false);

  // Serialize body parts for stable dependency tracking.
  // Avoids Set identity issues and eslint-disable for exhaustive-deps.
  const partsKey = clipBodyParts ? [...clipBodyParts].sort().join(',') : 'none';

  // Initialize preview engine
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const preview = new ClipPreview(el);
    preview.onFrame = (info) => setClipInfo(info);
    preview.onClipEnd = () => setPaused(true);
    previewRef.current = preview;

    return () => {
      preview.dispose();
      previewRef.current = null;
    };
  }, []);

  // Load model
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !modelUrl) return;

    setModelLoaded(false);
    preview.loadModel(modelUrl).then(() => {
      setModelLoaded(true);
      onReady?.();
    }).catch(err => {
      console.error('[PreviewPanel] Failed to load model:', err);
    });
  }, [modelUrl, onReady]);

  // Play clip when clipPath or body parts change
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !modelLoaded || !clipPath) return;

    const boneMask = clipBodyParts ? getBonesForParts(clipBodyParts) : null;
    preview.setBoneMask(boneMask);
    setPaused(false);

    preview.looping = looping;
    preview.playClip(clipPath, looping).catch(err => {
      console.error('[PreviewPanel] Failed to play clip:', err);
    });
  }, [clipPath, modelLoaded, looping, partsKey, clipBodyParts]);

  const handleTogglePause = useCallback(() => {
    const preview = previewRef.current;
    if (!preview) return;
    preview.togglePause();
    setPaused(p => !p);
  }, []);

  const handleStop = useCallback(() => {
    const preview = previewRef.current;
    if (!preview) return;
    preview.stop();
    setClipInfo(null);
    setPaused(false);
  }, []);

  const handleToggleLoop = useCallback(() => {
    setLooping(l => {
      const next = !l;
      if (previewRef.current) previewRef.current.looping = next;
      return next;
    });
  }, []);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s);
    previewRef.current?.setSpeed(s);
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    previewRef.current?.seek(time);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
  };

  return (
    <div style={containerStyle}>
      <div ref={containerRef} style={canvasWrapStyle} />

      <div style={controlsStyle}>
        {/* Clip name */}
        {clipInfo ? (
          <div style={clipNameStyle} title={clipInfo.name}>
            ▶ {clipInfo.name}
          </div>
        ) : (
          <div style={noClipStyle}>No clip loaded — click a clip to preview</div>
        )}

        {/* Timeline */}
        {clipInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={timeStyle}>{formatTime(clipInfo.time)}</span>
            <input
              type="range"
              min={0}
              max={clipInfo.duration}
              step={0.01}
              value={clipInfo.time}
              onChange={handleSeek}
              style={sliderStyle}
            />
            <span style={timeStyle}>{formatTime(clipInfo.duration)}</span>
          </div>
        )}

        {/* Transport */}
        <div style={transportStyle}>
          <button
            style={paused ? activeBtnStyle : btnStyle}
            onClick={handleTogglePause}
            disabled={!clipInfo}
          >
            {paused ? '▶' : '⏸'}
          </button>
          <button style={btnStyle} onClick={handleStop} disabled={!clipInfo}>
            ⏹
          </button>
          <button
            style={looping ? activeBtnStyle : btnStyle}
            onClick={handleToggleLoop}
          >
            🔁
          </button>

          <div style={{ flex: 1 }} />

          {/* Speed */}
          <div style={speedRowStyle}>
            {SPEEDS.map(s => (
              <button
                key={s}
                style={speed === s ? activeBtnStyle : btnStyle}
                onClick={() => handleSpeedChange(s)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
