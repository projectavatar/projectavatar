import { useState, useEffect, useCallback, useRef } from 'react';
import { ACTIONS, EMOTIONS, INTENSITIES } from '@project-avatar/shared';
import type { Action, Emotion, Intensity } from '@project-avatar/shared';
import { useStore } from '../state/store.ts';
import type { StateMachine, LayerState, ActiveClipInfo } from '@project-avatar/avatar-engine';

// ─── Styles ───────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  width: 340,
  height: '100%',
  background: 'rgba(10, 10, 15, 0.92)',
  backdropFilter: 'blur(12px)',
  borderLeft: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 200,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: 16,
  padding: '2px 6px',
  borderRadius: 4,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '0 14px 14px',
};

const sectionStyle: React.CSSProperties = {
  marginTop: 14,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--color-text-muted)',
  marginBottom: 8,
};

const gridStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 8px',
  borderRadius: 4,
  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
  background: active ? 'rgba(108, 92, 231, 0.2)' : 'transparent',
  color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  transition: 'all 0.1s',
  whiteSpace: 'nowrap',
});

const sendBtnStyle: React.CSSProperties = {
  marginTop: 10,
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid var(--color-accent)',
  background: 'var(--color-accent)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono)',
  width: '100%',
};

const toggleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 0',
  borderBottom: '1px solid rgba(42, 42, 58, 0.5)',
};

const toggleLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text)',
};

const toggleSwitchStyle = (on: boolean): React.CSSProperties => ({
  width: 32,
  height: 16,
  borderRadius: 8,
  background: on ? 'var(--color-accent)' : 'var(--color-border)',
  cursor: 'pointer',
  position: 'relative',
  transition: 'background 0.15s',
  flexShrink: 0,
});

const toggleKnobStyle = (on: boolean): React.CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: 6,
  background: '#fff',
  position: 'absolute',
  top: 2,
  left: on ? 18 : 2,
  transition: 'left 0.15s',
});

const logEntryStyle = (source: string): React.CSSProperties => ({
  padding: '4px 0',
  borderBottom: '1px solid rgba(42, 42, 58, 0.3)',
  fontSize: 10,
  color: source === 'dev-panel' ? 'var(--color-accent)' : source === 'system' ? 'var(--color-warning)' : 'var(--color-text-muted)',
});

const logTimeStyle: React.CSSProperties = {
  color: 'rgba(136, 136, 152, 0.6)',
  marginRight: 6,
};

const currentStateStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(108, 92, 231, 0.08)',
  borderRadius: 6,
  border: '1px solid rgba(108, 92, 231, 0.2)',
  marginTop: 8,
};

const stateRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '2px 0',
};

const stateLabelStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
};

const stateValueStyle: React.CSSProperties = {
  color: 'var(--color-accent)',
  fontWeight: 600,
};

// ─── Layer Labels ─────────────────────────────────────────────────────────────

const LAYER_LABELS: Record<keyof LayerState, string> = {
  fbxClips: 'FBX Clips',
  idleNoise: 'Idle Noise',
  expressions: 'Expressions',
  headOffset: 'Head Offset',
  blink: 'Blink',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface DevPanelProps {
  stateMachine: StateMachine | null;
}

export function DevPanel({ stateMachine }: DevPanelProps) {
  const devPanelOpen = useStore((s) => s.devPanelOpen);
  const setDevPanelOpen = useStore((s) => s.setDevPanelOpen);
  const avatar = useStore((s) => s.avatar);

  const [selectedEmotion, setSelectedEmotion] = useState<Emotion>('idle');
  const [selectedAction, setSelectedAction] = useState<Action>('idle');
  const [selectedIntensity, setSelectedIntensity] = useState<Intensity>('medium');
  const [eventLogVersion, setEventLogVersion] = useState(0);
  void eventLogVersion; // triggers re-render on event log update
  const [layers, setLayers] = useState<LayerState>({
    fbxClips: true,
    idleNoise: true,
    expressions: true,
    headOffset: true,
    blink: true,
  });

  const logRef = useRef<HTMLDivElement>(null);

  // Active clips state — polled every frame via rAF
  const [activeClips, setActiveClips] = useState<ActiveClipInfo[]>([]);
  const clipsPollRef = useRef<number>(0);

  // Poll active clips at ~10fps (every 6 frames) for performance
  useEffect(() => {
    if (!stateMachine || !devPanelOpen) return;
    let frameCount = 0;
    const poll = () => {
      frameCount++;
      if (frameCount % 6 === 0) {
        setActiveClips(stateMachine.getActiveClips());
      }
      clipsPollRef.current = requestAnimationFrame(poll);
    };
    clipsPollRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(clipsPollRef.current);
  }, [stateMachine, devPanelOpen]);

  // Subscribe to event log updates
  useEffect(() => {
    if (!stateMachine) return;
    stateMachine.onEventLog = () => setEventLogVersion((v) => v + 1);
    // Sync initial layer state
    setLayers({ ...stateMachine.layerState });
    return () => { stateMachine.onEventLog = undefined; };  // eslint-disable-line react-hooks/exhaustive-deps
  }, [stateMachine]);

  const handleSend = useCallback(() => {
    if (!stateMachine) return;
    stateMachine.handleEvent({
      emotion: selectedEmotion,
      action: selectedAction,
      intensity: selectedIntensity,
    }, 'dev-panel');
  }, [stateMachine, selectedEmotion, selectedAction, selectedIntensity]);

  const handleLayerToggle = useCallback((layer: keyof LayerState) => {
    if (!stateMachine) return;
    const newValue = !layers[layer];
    stateMachine.setLayer(layer, newValue);
    setLayers((prev) => ({ ...prev, [layer]: newValue }));
  }, [stateMachine, layers]);

  // Keyboard shortcut: backtick to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't toggle if user is typing in an input
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        setDevPanelOpen(!devPanelOpen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [devPanelOpen, setDevPanelOpen]);

  if (!devPanelOpen) return null;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>🔧 Dev Panel</span>
        <button style={closeBtnStyle} onClick={() => setDevPanelOpen(false)} title="Close (`)">
          ✕
        </button>
      </div>

      <div style={bodyStyle}>
        {/* Current State */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Current State</div>
          <div style={currentStateStyle}>
            <div style={stateRowStyle}>
              <span style={stateLabelStyle}>emotion</span>
              <span style={stateValueStyle}>{avatar.emotion}</span>
            </div>
            <div style={stateRowStyle}>
              <span style={stateLabelStyle}>action</span>
              <span style={stateValueStyle}>{avatar.action}</span>
            </div>
            <div style={stateRowStyle}>
              <span style={stateLabelStyle}>intensity</span>
              <span style={stateValueStyle}>{avatar.intensity}</span>
            </div>
            <div style={stateRowStyle}>
              <span style={stateLabelStyle}>prop</span>
              <span style={stateValueStyle}>{avatar.prop}</span>
            </div>
          </div>
        </div>

        {/* Active Clips */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Active Clips</div>
          {activeClips.length === 0 && (
            <div style={{ color: "var(--color-text-muted)", fontStyle: "italic", fontSize: 10 }}>
              No clips playing
            </div>
          )}
          {activeClips.map((clip) => (
            <div key={clip.name} style={{
              padding: "5px 8px",
              marginBottom: 3,
              borderRadius: 4,
              border: `1px solid ${clip.isPrimary ? "var(--color-accent)" : "var(--color-border)"}`,
              background: clip.isPrimary ? "rgba(108, 92, 231, 0.08)" : "transparent",
              fontSize: 10,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{
                  fontWeight: clip.isPrimary ? 600 : 400,
                  color: clip.isPrimary ? "var(--color-accent)" : "var(--color-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 180,
                }} title={clip.name}>
                  {clip.isPrimary ? "▶ " : "  "}{clip.name.replace(".fbx", "")}
                </span>
                <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>
                  {clip.isLooping ? "🔁" : "⏹"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 3, color: "var(--color-text-muted)" }}>
                <span>w:{clip.weight.toFixed(2)}</span>
                <span>ts:{clip.timeScale.toFixed(2)}</span>
                <span>{clip.time.toFixed(1)}s / {clip.duration.toFixed(1)}s</span>
              </div>
              {/* Weight bar */}
              <div style={{
                marginTop: 3,
                height: 2,
                borderRadius: 1,
                background: "var(--color-border)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(clip.weight * 100, 100)}%`,
                  background: clip.isPrimary ? "var(--color-accent)" : "var(--color-text-muted)",
                  borderRadius: 1,
                  transition: "width 0.1s",
                }} />
              </div>
            </div>
          ))}
        </div>
        {/* Send Event */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Emotion</div>
          <div style={gridStyle}>
            {EMOTIONS.map((e) => (
              <button
                key={e}
                style={chipStyle(selectedEmotion === e)}
                onClick={() => setSelectedEmotion(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Action</div>
          <div style={gridStyle}>
            {ACTIONS.map((a) => (
              <button
                key={a}
                style={chipStyle(selectedAction === a)}
                onClick={() => setSelectedAction(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Intensity</div>
          <div style={gridStyle}>
            {INTENSITIES.map((i) => (
              <button
                key={i}
                style={chipStyle(selectedIntensity === i)}
                onClick={() => setSelectedIntensity(i)}
              >
                {i}
              </button>
            ))}
          </div>
        </div>

        <button style={sendBtnStyle} onClick={handleSend} disabled={!stateMachine}>
          Send Event
        </button>

        {/* Layer Toggles */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Layers</div>
          {(Object.keys(LAYER_LABELS) as (keyof LayerState)[]).map((layer) => (
            <div key={layer} style={toggleRowStyle}>
              <span style={toggleLabelStyle}>{LAYER_LABELS[layer]}</span>
              <div
                style={toggleSwitchStyle(layers[layer])}
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

        {/* Event Log */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Event Log ({stateMachine?.eventLog.length ?? 0})</div>
          <div ref={logRef} style={{ maxHeight: 200, overflowY: 'auto' }}>
            {(stateMachine?.eventLog.length ?? 0) === 0 && (
              <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 10 }}>
                No events yet
              </div>
            )}
            {(stateMachine?.eventLog ?? []).map((entry, i) => (
              <div key={i} style={logEntryStyle(entry.source)}>
                <span style={logTimeStyle}>
                  {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span>{entry.emotion}/{entry.action}</span>
                {entry.intensity && entry.intensity !== 'medium' && (
                  <span style={{ marginLeft: 4, opacity: 0.6 }}>({entry.intensity})</span>
                )}
                <span style={{ marginLeft: 6, opacity: 0.4 }}>
                  {entry.source === 'dev-panel' ? '⚡' : entry.source === 'system' ? '⏱' : '📡'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
