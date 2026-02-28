/**
 * Action Mapping Editor — center panel tab.
 * List of all actions with expandable primary/layer clip configuration.
 */
import { useCallback } from 'react';
import type { ClipsJson, ActionData } from '../types.ts';
import type { Action } from '../state.ts';
import { ACTIONS } from '@project-avatar/shared';

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '0',
};

const actionItemStyle = (expanded: boolean): React.CSSProperties => ({
  borderBottom: '1px solid var(--color-border)',
  background: expanded ? 'var(--color-surface)' : 'transparent',
});

const actionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 14px',
  cursor: 'pointer',
  transition: 'background 0.1s',
};

const actionNameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 600,
};

const clipRefStyle: React.CSSProperties = {
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

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: 200,
  padding: '3px 6px',
  fontSize: 11,
};

const numberStyle: React.CSSProperties = {
  width: 60,
  padding: '3px 6px',
  fontSize: 11,
  textAlign: 'right',
};

const sliderStyle: React.CSSProperties = {
  width: 80,
  accentColor: 'var(--color-accent)',
};

const layerRowStyle: React.CSSProperties = {
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

const previewBtnStyle: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: 4,
  border: '1px solid var(--color-accent)',
  color: 'var(--color-accent)',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  background: 'transparent',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--color-text-dim)',
  marginTop: 8,
  marginBottom: 4,
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ActionEditorProps {
  data: ClipsJson;
  expandedAction: string | null;
  dispatch: React.Dispatch<Action>;
}

export function ActionEditor({ data, expandedAction, dispatch }: ActionEditorProps) {
  const clipIds = Object.keys(data.clips).sort();

  const updateAction = useCallback((name: string, partial: Partial<ActionData>) => {
    dispatch({ type: 'UPDATE_ACTION', action: name, data: partial });
  }, [dispatch]);

  return (
    <div style={containerStyle}>
      {ACTIONS.map(name => {
        const action = data.actions[name];
        if (!action) return null;
        const expanded = expandedAction === name;

        return (
          <div key={name} style={actionItemStyle(expanded)}>
            {/* Header */}
            <div
              style={actionHeaderStyle}
              onClick={() => dispatch({ type: 'EXPAND_ACTION', action: expanded ? null : name })}
            >
              <div>
                <span style={actionNameStyle}>{expanded ? '▾ ' : '▸ '}{name}</span>
              </div>
              <span style={clipRefStyle}>{action.primary.clip}</span>
            </div>

            {/* Expanded body */}
            {expanded && (
              <div style={bodyStyle}>
                {/* Primary clip */}
                <div style={sectionLabel}>Primary Clip</div>
                <div style={rowStyle}>
                  <span style={labelStyle}>Clip</span>
                  <select
                    style={selectStyle}
                    value={action.primary.clip}
                    onChange={(e) => updateAction(name, {
                      primary: { ...action.primary, clip: e.target.value },
                    })}
                  >
                    {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                </div>

                <div style={rowStyle}>
                  <span style={labelStyle}>Weight</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="range"
                      min={0} max={1} step={0.05}
                      value={action.primary.weight}
                      style={sliderStyle}
                      onChange={(e) => updateAction(name, {
                        primary: { ...action.primary, weight: parseFloat(e.target.value) },
                      })}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', width: 30 }}>
                      {action.primary.weight.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div style={rowStyle}>
                  <span style={labelStyle}>Duration Override</span>
                  <input
                    type="number"
                    style={numberStyle}
                    value={action.durationOverride ?? ''}
                    placeholder="auto"
                    step={0.1}
                    min={0}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : parseFloat(e.target.value);
                      updateAction(name, { durationOverride: val });
                    }}
                  />
                </div>

                {/* Layers */}
                <div style={sectionLabel}>Layers ({action.layers.length})</div>
                {action.layers.map((layer, i) => (
                  <div key={i} style={layerRowStyle}>
                    <select
                      style={{ ...selectStyle, maxWidth: 150 }}
                      value={layer.clip}
                      onChange={(e) => {
                        const layers = [...action.layers];
                        layers[i] = { ...layer, clip: e.target.value };
                        updateAction(name, { layers });
                      }}
                    >
                      {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <input
                      type="range"
                      min={0} max={1} step={0.05}
                      value={layer.weight}
                      style={{ ...sliderStyle, width: 60 }}
                      onChange={(e) => {
                        const layers = [...action.layers];
                        layers[i] = { ...layer, weight: parseFloat(e.target.value) };
                        updateAction(name, { layers });
                      }}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', width: 25 }}>
                      {layer.weight.toFixed(2)}
                    </span>
                    <button style={removeBtnStyle} onClick={() => {
                      const layers = action.layers.filter((_, idx) => idx !== i);
                      updateAction(name, { layers });
                    }}>✕</button>
                  </div>
                ))}
                <button style={addBtnStyle} onClick={() => {
                  const layers = [...action.layers, { clip: clipIds[0] ?? '', weight: 0.2 }];
                  updateAction(name, { layers });
                }}>+ Add Layer</button>

                {/* Preview button */}
                <div style={{ marginTop: 10 }}>
                  <button
                    style={previewBtnStyle}
                    onClick={() => {
                      dispatch({ type: 'SET_PREVIEW_CLIP', clipId: action.primary.clip });
                    }}
                  >
                    ▶ Preview Primary
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
