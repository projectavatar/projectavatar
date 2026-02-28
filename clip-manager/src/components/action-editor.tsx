/**
 * Action Detail Editor — center panel for the selected action.
 * Single-row layout: [dropdown | weight | body parts | delete]
 */
import { useCallback } from 'react';
import type { ClipsJson, ActionData, ClipLayer } from '../types.ts';
import type { Action } from '../state.ts';
import { BODY_PARTS } from '@project-avatar/avatar-engine';
import { BODY_PART_ICON, BODY_PART_COLOR } from '../constants.ts';

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

const clipRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 40,
  padding: '8px 0',
  borderBottom: '1px solid rgba(42, 42, 58, 0.3)',
};

const selectStyle: React.CSSProperties = {
  width: 180,
  padding: '3px 6px',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  flexShrink: 0,
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  accentColor: 'var(--color-accent)',
};

const weightValueStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--color-text-muted)',
  width: 28,
  textAlign: 'right',
  flexShrink: 0,
};

const chipStyle = (active: boolean, color: string): React.CSSProperties => ({
  padding: '2px 7px',
  borderRadius: 10,
  fontSize: 9,
  fontFamily: 'var(--font-mono)',
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  transition: 'all 0.12s ease',
  border: `1.5px solid ${active ? color : 'var(--color-border)'}`,
  background: active ? `${color}18` : 'transparent',
  color: active ? color : 'var(--color-text-muted)',
  opacity: active ? 1 : 0.5,
  textDecoration: active ? 'none' : 'line-through',
  userSelect: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  flexShrink: 0,
});

const removeBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  fontSize: 9,
  cursor: 'pointer',
  background: 'transparent',
  fontFamily: 'var(--font-mono)',
  flexShrink: 0,
};

const addBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: 4,
  border: '1px dashed var(--color-border)',
  color: 'var(--color-text-dim)',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  marginTop: 8,
  background: 'transparent',
  width: '100%',
  textAlign: 'center',
};

const durationRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 40,
  marginTop: 12,
  paddingTop: 12,
  borderTop: '1px solid var(--color-border)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-mono)',
  minWidth: 45,
};

const numberStyle: React.CSSProperties = {
  flex: 1,
  padding: '3px 6px',
  fontSize: 11,
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ActionEditorProps {
  data: ClipsJson;
  selectedAction: string | null;
  dispatch: React.Dispatch<Action>;
}

export function ActionEditor({ data, selectedAction, dispatch }: ActionEditorProps) {
  const clipIds = Object.keys(data.clips).sort();

  const updateAction = useCallback((name: string, partial: Partial<ActionData>) => {
    dispatch({ type: 'UPDATE_ACTION', action: name, data: partial });
  }, [dispatch]);

  const updateClipLayer = useCallback((actionName: string, clips: ClipLayer[], index: number, update: Partial<ClipLayer>) => {
    const newClips = [...clips];
    newClips[index] = { ...newClips[index]!, ...update };
    updateAction(actionName, { clips: newClips });
  }, [updateAction]);

  const toggleBodyPart = useCallback((actionName: string, clips: ClipLayer[], index: number, part: string) => {
    const layer = clips[index]!;
    const currentParts = layer.bodyParts;
    const newParts = currentParts.includes(part)
      ? currentParts.filter(p => p !== part)
      : [...currentParts, part];
    if (newParts.length === 0) return;
    updateClipLayer(actionName, clips, index, { bodyParts: newParts });
  }, [updateClipLayer]);

  if (!selectedAction) {
    return <div style={emptyStyle}>Select an action from the list</div>;
  }

  const action = data.actions[selectedAction];
  if (!action) {
    return <div style={emptyStyle}>Action not found: {selectedAction}</div>;
  }

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>{selectedAction}</div>

      {action.clips.map((layer, i) => (
        <div key={i} style={clipRowStyle}>
          <select
            style={selectStyle}
            value={layer.clip}
            onChange={(e) => {
              const newClipId = e.target.value;
              const newClipData = data.clips[newClipId];
              updateClipLayer(selectedAction, action.clips, i, {
                clip: newClipId,
                bodyParts: newClipData?.bodyParts ?? layer.bodyParts,
              });
            }}
          >
            {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>

          <input
            type="range"
            min={0} max={1} step={0.05}
            value={layer.weight}
            style={sliderStyle}
            onChange={(e) => updateClipLayer(selectedAction, action.clips, i, {
              weight: parseFloat(e.target.value),
            })}
          />
          <span style={weightValueStyle}>{layer.weight.toFixed(2)}</span>

          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {BODY_PARTS.map(part => (
              <button
                key={part}
                style={chipStyle(layer.bodyParts.includes(part), BODY_PART_COLOR[part])}
                onClick={() => toggleBodyPart(selectedAction, action.clips, i, part)}
              >
                {BODY_PART_ICON[part]} {part}
              </button>
            ))}
          </div>

          {action.clips.length > 1 && (
            <button
              style={removeBtnStyle}
              onClick={() => {
                const newClips = action.clips.filter((_, idx) => idx !== i);
                updateAction(selectedAction, { clips: newClips });
              }}
            >
              ✕
            </button>
          )}
        </div>
      ))}

      <button
        style={addBtnStyle}
        onClick={() => {
          const newClips = [
            ...action.clips,
            {
              clip: clipIds[0] ?? '',
              weight: 0.5,
              bodyParts: data.clips[clipIds[0] ?? '']?.bodyParts ?? ['head', 'torso', 'arms', 'legs'],
            },
          ];
          updateAction(selectedAction, { clips: newClips });
        }}
      >
        + Add Clip
      </button>

      <div style={durationRowStyle}>
        <span style={labelStyle}>Duration</span>
        <input
          type="number"
          style={numberStyle}
          value={action.durationOverride ?? ''}
          placeholder="auto"
          step={0.1}
          min={0}
          onChange={(e) => {
            const val = e.target.value === '' ? null : parseFloat(e.target.value);
            updateAction(selectedAction, { durationOverride: val });
          }}
        />
      </div>
    </div>
  );
}
