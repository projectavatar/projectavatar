/**
 * Emotion Detail Editor — center panel for the selected emotion.
 * Shows weight scale, action overrides, and extra layers.
 */
import { useCallback } from 'react';
import type { ClipsJson, EmotionData } from '../types.ts';
import type { Action } from '../state.ts';
import { ACTIONS } from '@project-avatar/shared';

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '16px',
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 16,
};

const emptyStyle: React.CSSProperties = {
  padding: 20,
  color: 'var(--color-text-dim)',
  fontStyle: 'italic',
  fontSize: 12,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 0',
  borderBottom: '1px solid rgba(42, 42, 58, 0.3)',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--color-text-dim)',
  marginTop: 16,
  marginBottom: 8,
};

const overrideRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
};

const addBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: 4,
  border: '1px dashed var(--color-border)',
  color: 'var(--color-text-dim)',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  marginTop: 4,
  background: 'transparent',
  width: '100%',
  textAlign: 'center',
};

const removeBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  fontSize: 10,
  cursor: 'pointer',
  background: 'transparent',
  fontFamily: 'var(--font-mono)',
};

const selectStyle: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface EmotionEditorProps {
  data: ClipsJson;
  selectedEmotion: string | null;
  dispatch: React.Dispatch<Action>;
}

export function EmotionEditor({ data, selectedEmotion, dispatch }: EmotionEditorProps) {
  const clipIds = Object.keys(data.clips).sort();

  const updateEmotion = useCallback((name: string, partial: Partial<EmotionData>) => {
    dispatch({ type: 'UPDATE_EMOTION', emotion: name, data: partial });
  }, [dispatch]);

  if (!selectedEmotion) {
    return <div style={emptyStyle}>Select an emotion from the list</div>;
  }

  const emotion = data.emotions[selectedEmotion];

  if (!emotion) {
    return (
      <div style={containerStyle}>
        <div style={titleStyle}>{selectedEmotion}</div>
        <div style={{ color: 'var(--color-text-dim)', fontStyle: 'italic', fontSize: 11, marginBottom: 12 }}>
          No modifier defined for this emotion.
        </div>
        <button style={addBtnStyle} onClick={() => {
          dispatch({ type: 'CREATE_EMOTION', emotion: selectedEmotion });
        }}>
          Create Modifier
        </button>
      </div>
    );
  }

  const overrideCount = Object.keys(emotion.overrides).length;
  const layerCount = emotion.layers.length;

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>{selectedEmotion}</div>

      {/* Weight Scale */}
      <div style={rowStyle}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>Weight Scale</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0.5} max={1.5} step={0.05}
            value={emotion.weightScale}
            style={{ width: 100, accentColor: 'var(--color-accent)' }}
            onChange={(e) => updateEmotion(selectedEmotion, { weightScale: parseFloat(e.target.value) })}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', width: 40 }}>
            ×{emotion.weightScale.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Overrides */}
      <div style={sectionLabel}>Action Overrides ({overrideCount})</div>
      {Object.entries(emotion.overrides).map(([action, ref]) => (
        <div key={action} style={overrideRowStyle}>
          <select
            style={{ ...selectStyle, width: 120 }}
            value={action}
            onChange={(e) => {
              const overrides = { ...emotion.overrides };
              const clipRef = overrides[action]!;
              delete overrides[action];
              overrides[e.target.value] = clipRef;
              updateEmotion(selectedEmotion, { overrides });
            }}
          >
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <span style={{ color: 'var(--color-text-dim)', fontSize: 10 }}>→</span>
          <select
            style={{ ...selectStyle, flex: 1 }}
            value={ref.clip}
            onChange={(e) => {
              const overrides = { ...emotion.overrides };
              overrides[action] = { ...ref, clip: e.target.value };
              updateEmotion(selectedEmotion, { overrides });
            }}
          >
            {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <button style={removeBtnStyle} onClick={() => {
            const overrides = { ...emotion.overrides };
            delete overrides[action];
            updateEmotion(selectedEmotion, { overrides });
          }}>✕</button>
        </div>
      ))}
      <button style={addBtnStyle} onClick={() => {
        const used = new Set(Object.keys(emotion.overrides));
        const available = ACTIONS.find(a => !used.has(a)) ?? ACTIONS[0];
        const overrides = { ...emotion.overrides, [available]: { clip: clipIds[0] ?? '', weight: 1.0 } };
        updateEmotion(selectedEmotion, { overrides });
      }}>+ Add Override</button>

      {/* Layers */}
      <div style={sectionLabel}>Extra Layers ({layerCount})</div>
      {emotion.layers.map((layer, i) => (
        <div key={i} style={overrideRowStyle}>
          <select
            style={{ ...selectStyle, flex: 1 }}
            value={layer.clip}
            onChange={(e) => {
              const layers = [...emotion.layers];
              layers[i] = { ...layer, clip: e.target.value };
              updateEmotion(selectedEmotion, { layers });
            }}
          >
            {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <input
            type="range"
            min={0} max={1} step={0.05}
            value={layer.weight}
            style={{ width: 80, accentColor: 'var(--color-accent)' }}
            onChange={(e) => {
              const layers = [...emotion.layers];
              layers[i] = { ...layer, weight: parseFloat(e.target.value) };
              updateEmotion(selectedEmotion, { layers });
            }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', width: 30 }}>
            {layer.weight.toFixed(2)}
          </span>
          <button style={removeBtnStyle} onClick={() => {
            const layers = emotion.layers.filter((_, idx) => idx !== i);
            updateEmotion(selectedEmotion, { layers });
          }}>✕</button>
        </div>
      ))}
      <button style={addBtnStyle} onClick={() => {
        const layers = [...emotion.layers, { clip: clipIds[0] ?? '', weight: 0.15 }];
        updateEmotion(selectedEmotion, { layers });
      }}>+ Add Layer</button>
    </div>
  );
}
