/**
 * Action Detail Editor — center panel for the selected action.
 *
 * Shows the clip layers for the selected action with:
 * - Clip selector (dropdown)
 * - Weight slider (0–1)
 * - Body part on/off chips (head, torso, arms, legs)
 * - Remove button
 *
 * Changes dispatch immediately → preview updates live.
 */
import { useCallback } from 'react';
import type { ClipsJson, ActionData, ClipLayer } from '../types.ts';
import type { Action } from '../state.ts';
import { BODY_PARTS } from '@project-avatar/avatar-engine';

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

const clipCardStyle: React.CSSProperties = {
  background: 'var(--color-surface-2)',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 8,
  border: '1px solid var(--color-border)',
};

const clipHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: 220,
  padding: '4px 6px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
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

const weightRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-mono)',
  minWidth: 45,
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  accentColor: 'var(--color-accent)',
};

const weightValueStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--color-text-muted)',
  width: 35,
  textAlign: 'right',
};

const bodyPartRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 10px',
  borderRadius: 12,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.12s',
  border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
  background: active ? 'var(--color-accent-dim)' : 'transparent',
  color: active ? 'var(--color-accent)' : 'var(--color-text-dim)',
});

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

const durationRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 12,
  paddingTop: 12,
  borderTop: '1px solid var(--color-border)',
};

const numberStyle: React.CSSProperties = {
  width: 60,
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
        <div key={i} style={clipCardStyle}>
          <div style={clipHeaderStyle}>
            <select
              style={selectStyle}
              value={layer.clip}
              onChange={(e) => updateClipLayer(selectedAction, action.clips, i, { clip: e.target.value })}
            >
              {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
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

          <div style={weightRowStyle}>
            <span style={labelStyle}>Weight</span>
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
          </div>

          <div style={bodyPartRowStyle}>
            <span style={labelStyle}>Body</span>
            {BODY_PARTS.map(part => (
              <button
                key={part}
                style={chipStyle(layer.bodyParts.includes(part))}
                onClick={() => toggleBodyPart(selectedAction, action.clips, i, part)}
              >
                {part}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button
        style={addBtnStyle}
        onClick={() => {
          const newClips = [
            ...action.clips,
            { clip: clipIds[0] ?? '', weight: 0.5, bodyParts: ['head', 'torso', 'arms', 'legs'] },
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
