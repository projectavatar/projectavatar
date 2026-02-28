/**
 * Emotion Modifier Editor — center panel tab.
 */
import { useCallback } from 'react';
import type { ClipsJson, EmotionData } from '../types.ts';
import type { Action } from '../state.ts';
import { EMOTIONS, ACTIONS } from '@project-avatar/shared';

const containerStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
};

const itemStyle = (expanded: boolean): React.CSSProperties => ({
  borderBottom: '1px solid var(--color-border)',
  background: expanded ? 'var(--color-surface)' : 'transparent',
});

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 14px',
  cursor: 'pointer',
};

const nameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 600,
};

const metaStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--color-text-muted)',
};

const bodyStyle: React.CSSProperties = {
  padding: '0 14px 12px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 0',
  borderBottom: '1px solid rgba(42, 42, 58, 0.3)',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--color-text-dim)',
  marginTop: 10,
  marginBottom: 4,
};

const overrideRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
};

const addBtnStyle: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: 4,
  border: '1px dashed var(--color-border)',
  color: 'var(--color-text-dim)',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  marginTop: 4,
};

const removeBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  fontSize: 10,
  cursor: 'pointer',
  background: 'transparent',
};

interface EmotionEditorProps {
  data: ClipsJson;
  expandedEmotion: string | null;
  dispatch: React.Dispatch<Action>;
}

export function EmotionEditor({ data, expandedEmotion, dispatch }: EmotionEditorProps) {
  const clipIds = Object.keys(data.clips).sort();

  const updateEmotion = useCallback((name: string, partial: Partial<EmotionData>) => {
    dispatch({ type: 'UPDATE_EMOTION', emotion: name, data: partial });
  }, [dispatch]);

  return (
    <div style={containerStyle}>
      {EMOTIONS.map(name => {
        const emotion = data.emotions[name];
        const expanded = expandedEmotion === name;
        const overrideCount = emotion ? Object.keys(emotion.overrides).length : 0;
        const layerCount = emotion?.layers.length ?? 0;

        return (
          <div key={name} style={itemStyle(expanded)}>
            <div
              style={headerStyle}
              onClick={() => dispatch({ type: 'EXPAND_EMOTION', emotion: expanded ? null : name })}
            >
              <span style={nameStyle}>{expanded ? '▾ ' : '▸ '}{name}</span>
              <span style={metaStyle}>
                {emotion ? `${overrideCount} overrides, ${layerCount} layers, ×${emotion.weightScale.toFixed(2)}` : 'no modifier'}
              </span>
            </div>

            {expanded && emotion && (
              <div style={bodyStyle}>
                {/* Weight Scale */}
                <div style={rowStyle}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Weight Scale</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="range"
                      min={0.5} max={1.5} step={0.05}
                      value={emotion.weightScale}
                      style={{ width: 80, accentColor: 'var(--color-accent)' }}
                      onChange={(e) => updateEmotion(name, { weightScale: parseFloat(e.target.value) })}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', width: 35 }}>
                      ×{emotion.weightScale.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Overrides */}
                <div style={sectionLabel}>Action Overrides ({overrideCount})</div>
                {Object.entries(emotion.overrides).map(([action, ref]) => (
                  <div key={action} style={overrideRowStyle}>
                    <select
                      style={{ padding: '3px 6px', fontSize: 11, width: 110 }}
                      value={action}
                      onChange={(e) => {
                        const overrides = { ...emotion.overrides };
                        const clipRef = overrides[action]!;
                        delete overrides[action];
                        overrides[e.target.value] = clipRef;
                        updateEmotion(name, { overrides });
                      }}
                    >
                      {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <span style={{ color: 'var(--color-text-dim)', fontSize: 10 }}>→</span>
                    <select
                      style={{ padding: '3px 6px', fontSize: 11, flex: 1 }}
                      value={ref.clip}
                      onChange={(e) => {
                        const overrides = { ...emotion.overrides };
                        overrides[action] = { ...ref, clip: e.target.value };
                        updateEmotion(name, { overrides });
                      }}
                    >
                      {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <button style={removeBtnStyle} onClick={() => {
                      const overrides = { ...emotion.overrides };
                      delete overrides[action];
                      updateEmotion(name, { overrides });
                    }}>✕</button>
                  </div>
                ))}
                <button style={addBtnStyle} onClick={() => {
                  // Find first action not already overridden
                  const used = new Set(Object.keys(emotion.overrides));
                  const available = ACTIONS.find(a => !used.has(a)) ?? ACTIONS[0];
                  const overrides = { ...emotion.overrides, [available]: { clip: clipIds[0] ?? '', weight: 1.0 } };
                  updateEmotion(name, { overrides });
                }}>+ Add Override</button>

                {/* Layers */}
                <div style={sectionLabel}>Extra Layers ({layerCount})</div>
                {emotion.layers.map((layer, i) => (
                  <div key={i} style={overrideRowStyle}>
                    <select
                      style={{ padding: '3px 6px', fontSize: 11, flex: 1 }}
                      value={layer.clip}
                      onChange={(e) => {
                        const layers = [...emotion.layers];
                        layers[i] = { ...layer, clip: e.target.value };
                        updateEmotion(name, { layers });
                      }}
                    >
                      {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <input
                      type="range"
                      min={0} max={1} step={0.05}
                      value={layer.weight}
                      style={{ width: 60, accentColor: 'var(--color-accent)' }}
                      onChange={(e) => {
                        const layers = [...emotion.layers];
                        layers[i] = { ...layer, weight: parseFloat(e.target.value) };
                        updateEmotion(name, { layers });
                      }}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', width: 25 }}>
                      {layer.weight.toFixed(2)}
                    </span>
                    <button style={removeBtnStyle} onClick={() => {
                      const layers = emotion.layers.filter((_, idx) => idx !== i);
                      updateEmotion(name, { layers });
                    }}>✕</button>
                  </div>
                ))}
                <button style={addBtnStyle} onClick={() => {
                  const layers = [...emotion.layers, { clip: clipIds[0] ?? '', weight: 0.15 }];
                  updateEmotion(name, { layers });
                }}>+ Add Layer</button>
              </div>
            )}

            {/* Emotions with no modifier defined yet */}
            {expanded && !emotion && (
              <div style={{ ...bodyStyle, color: 'var(--color-text-dim)', fontStyle: 'italic', fontSize: 11 }}>
                No modifier defined for this emotion.
                <button style={{ ...addBtnStyle, display: 'block', marginTop: 8 }} onClick={() => {
                  dispatch({ type: 'CREATE_EMOTION', emotion: name });
                }}>
                  Create Modifier
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
