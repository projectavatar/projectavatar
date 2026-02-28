/**
 * Preview Panel — right side of the clip manager.
 *
 * Two modes:
 * 1. Clip preview: plays a single FBX (Clips tab)
 * 2. Action preview: plays blended action through full engine (Actions tab)
 *    — supports previewing specific animation groups
 *
 * Layer toggles available in both modes when engine is active.
 */
import { useRef, useEffect, useCallback, useState } from 'react';
import { ClipPreview } from './clip-preview.ts';
import type { ClipInfo } from './clip-preview.ts';
import { getBonesForParts } from '@project-avatar/avatar-engine';
import { LAYER_LABELS } from '@project-avatar/avatar-engine';
import type { LayerState, ClipsJsonData } from '@project-avatar/avatar-engine';
import type { Action as ActionName } from '@project-avatar/shared';

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

const layerSectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--color-border)',
  padding: '8px 0 0',
};

const layerTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  color: 'var(--color-text-muted)',
  marginBottom: 6,
};

const layerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '3px 0',
};

const layerLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text)',
};

const toggleSwitchStyle = (on: boolean): React.CSSProperties => ({
  width: 28,
  height: 14,
  borderRadius: 7,
  background: on ? 'var(--color-accent)' : 'var(--color-border)',
  cursor: 'pointer',
  position: 'relative',
  transition: 'background 0.15s',
  flexShrink: 0,
});

const toggleKnobStyle = (on: boolean): React.CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: 5,
  background: '#fff',
  position: 'absolute',
  top: 2,
  left: on ? 16 : 2,
  transition: 'left 0.15s',
});

// ─── Component ────────────────────────────────────────────────────────────────

interface PreviewPanelProps {
  /** FBX clip path to play — single clip mode (Clips tab) */
  clipPath: string | null;
  /** VRM model URL to use */
  modelUrl: string;
  /** Body parts active for the current clip — drives bone masking */
  clipBodyParts?: string[];
  /** clips.json data — passed to enable the full animation engine */
  clipsData?: ClipsJsonData;
  /** Action name to preview via engine (Actions tab — blended preview) */
  previewAction?: string | null;
  /** Group index to preview (Actions tab — specific group) */
  previewGroupIndex?: number;
  /** Called when preview is ready */
  onReady?: () => void;
}

const SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.0];

export function PreviewPanel({
  clipPath, modelUrl, clipBodyParts, clipsData, previewAction, previewGroupIndex = 0, onReady,
}: PreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ClipPreview | null>(null);
  const clipsDataRef = useRef(clipsData);
  clipsDataRef.current = clipsData;

  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null);
  const [looping, setLooping] = useState(true);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerState>({
    fbxClips: true,
    expressions: true,
    blink: true,
    idleLayer: true,
  });

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
    setEngineReady(false);

    preview.loadModel(modelUrl).then(async () => {
      setModelLoaded(true);
      onReady?.();

      const data = clipsDataRef.current;
      if (data) {
        try {
          await preview.enableEngine(data as ClipsJsonData);
          setEngineReady(true);
        } catch (err) {
          console.warn('[PreviewPanel] Engine init failed:', err);
        }
      }
    }).catch(err => {
      console.error('[PreviewPanel] Failed to load model:', err);
    });
  }, [modelUrl, onReady]);

  // Play single clip when clipPath changes (Clips tab)
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !modelLoaded || !clipPath) return;
    if (previewAction) return; // Action preview takes priority

    setActionLabel(null);
    const boneMask = clipBodyParts ? getBonesForParts(clipBodyParts) : null;
    preview.setBoneMask(boneMask);
    setPaused(false);

    preview.looping = looping;
    preview.playClip(clipPath, looping).catch(err => {
      console.error('[PreviewPanel] Failed to play clip:', err);
    });
  }, [clipPath, modelLoaded, looping, previewAction]);

  // Update bone mask when body parts change (Clips tab)
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !modelLoaded || !clipPath || previewAction) return;

    const boneMask = clipBodyParts ? getBonesForParts(clipBodyParts) : null;
    preview.setBoneMask(boneMask);
    preview.playClip(clipPath, preview.looping).catch(err => {
      console.error('[PreviewPanel] Failed to replay clip with new mask:', err);
    });
  }, [partsKey]);

  // Play blended action through engine (Actions tab) — responds to group index changes
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !modelLoaded || !previewAction) return;

    const data = clipsDataRef.current;
    if (!data) return;

    // Check if the selected group has valid clips — if not, stop preview
    const actionData = data.actions[previewAction];
    const group = actionData?.groups[previewGroupIndex];
    const hasValidClips = group?.clips.some(c => c.clip && data.clips[c.clip]);

    if (!hasValidClips) {
      preview.stop();
      setActionLabel(null);
      return;
    }

    const playAction = async () => {
      if (!preview.engineActive) {
        try {
          await preview.enableEngine(data as ClipsJsonData);
          setEngineReady(true);
        } catch (err) {
          console.warn('[PreviewPanel] Engine init failed for action preview:', err);
          return;
        }
      } else {
        preview.updateEngineData(data as ClipsJsonData);
      }

      preview.playEngineAction(previewAction as ActionName, previewGroupIndex);
      setActionLabel(previewAction);
    };

    void playAction();
  }, [previewAction, previewGroupIndex, modelLoaded, clipsData]);


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
    setActionLabel(null);
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

  const handleLayerToggle = useCallback((layer: keyof LayerState) => {
    const preview = previewRef.current;
    if (!preview) return;
    const newValue = !layers[layer];
    preview.setLayer(layer, newValue);
    setLayers(prev => ({ ...prev, [layer]: newValue }));
  }, [layers]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
  };

  const showingAction = previewAction && actionLabel;

  return (
    <div style={containerStyle}>
      <div ref={containerRef} style={canvasWrapStyle} />

      <div style={controlsStyle}>
        {/* Label */}
        {showingAction ? (
          <div style={clipNameStyle}>▶ Action: {actionLabel} (group {previewGroupIndex + 1})</div>
        ) : clipInfo ? (
          <div style={clipNameStyle} title={clipInfo.name}>▶ {clipInfo.name}</div>
        ) : (
          <div style={noClipStyle}>No clip loaded — select a clip or expand an action</div>
        )}

        {/* Timeline (clip mode only) */}
        {clipInfo && !showingAction && (
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
            disabled={!clipInfo && !showingAction}
          >
            {paused ? '▶' : '⏸'}
          </button>
          <button style={btnStyle} onClick={handleStop} disabled={!clipInfo && !showingAction}>
            ⏹
          </button>
          {!showingAction && (
            <button
              style={looping ? activeBtnStyle : btnStyle}
              onClick={handleToggleLoop}
            >
              🔁
            </button>
          )}

          <div style={{ flex: 1 }} />

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

        {/* Layer Toggles */}
        <div style={layerSectionStyle}>
          <div style={layerTitleStyle}>
            Layers {!engineReady && <span style={{ fontWeight: 400, opacity: 0.5 }}>(loading…)</span>}
          </div>
          {(Object.keys(LAYER_LABELS) as (keyof LayerState)[]).map(layer => (
            <div key={layer} style={layerRowStyle}>
              <span style={{ ...layerLabelStyle, opacity: engineReady ? 1 : 0.4 }}>
                {LAYER_LABELS[layer]}
              </span>
              <div
                style={{
                  ...toggleSwitchStyle(layers[layer]),
                  opacity: engineReady ? 1 : 0.4,
                  pointerEvents: engineReady ? 'auto' : 'none',
                }}
                onClick={() => handleLayerToggle(layer)}
                role="switch"
                aria-checked={layers[layer]}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLayerToggle(layer); }}
              >
                <div style={toggleKnobStyle(layers[layer])} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
