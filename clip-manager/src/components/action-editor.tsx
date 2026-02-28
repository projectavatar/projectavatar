/**
 * Action Detail Editor — center panel for the selected action.
 * v3: Animation groups displayed as accordion sections.
 * First group is expanded by default and previewed on action select.
 * Each group has a rarity slider and clip layers inside.
 */
import { useCallback, useState, useEffect } from 'react';
import type { ClipsJson, ActionData, AnimationGroup, ClipLayer } from '../types.ts';
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

// ─── Group accordion styles ───────────────────────────────────────────────────

const groupStyle = (expanded: boolean): React.CSSProperties => ({
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  marginBottom: 8,
  overflow: 'hidden',
  background: expanded ? 'var(--color-surface)' : 'transparent',
});

const groupHeaderStyle = (expanded: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background 0.1s',
  background: expanded ? 'rgba(100, 108, 255, 0.06)' : 'transparent',
});

const chevronStyle = (expanded: boolean): React.CSSProperties => ({
  fontSize: 10,
  color: 'var(--color-text-muted)',
  transition: 'transform 0.15s',
  transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
  flexShrink: 0,
});

const groupLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 600,
  flex: 1,
};

const rarityLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  color: 'var(--color-text-muted)',
  flexShrink: 0,
};

const raritySliderStyle: React.CSSProperties = {
  width: 80,
  height: 4,
  accentColor: 'var(--color-accent)',
  flexShrink: 0,
};

const groupBodyStyle: React.CSSProperties = {
  padding: '8px 12px 12px',
  borderTop: '1px solid var(--color-border)',
};

const groupDeleteBtnStyle: React.CSSProperties = {
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

// ─── Clip row styles ──────────────────────────────────────────────────────────

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

const addGroupBtnStyle: React.CSSProperties = {
  ...addBtnStyle,
  marginTop: 12,
  borderColor: 'var(--color-accent)',
  color: 'var(--color-accent)',
  opacity: 0.7,
};

const durationRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 40,
  marginTop: 16,
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

  // Track which group is expanded (by index). First group expanded by default.
  const [expandedGroup, setExpandedGroup] = useState<number>(0);

  // Reset expanded group when action changes
  useEffect(() => {
    setExpandedGroup(0);
    if (selectedAction) {
      dispatch({ type: 'SET_PREVIEW_GROUP_INDEX', index: 0 });
    }
  }, [selectedAction, dispatch]);

  const updateAction = useCallback((name: string, partial: Partial<ActionData>) => {
    dispatch({ type: 'UPDATE_ACTION', action: name, data: partial });
  }, [dispatch]);

  const updateGroup = useCallback((actionName: string, groups: AnimationGroup[], groupIdx: number, update: Partial<AnimationGroup>) => {
    const newGroups = [...groups];
    newGroups[groupIdx] = { ...newGroups[groupIdx]!, ...update };
    updateAction(actionName, { groups: newGroups });
  }, [updateAction]);

  const updateClipLayer = useCallback((actionName: string, groups: AnimationGroup[], groupIdx: number, clipIdx: number, update: Partial<ClipLayer>) => {
    const group = groups[groupIdx]!;
    const newClips = [...group.clips];
    newClips[clipIdx] = { ...newClips[clipIdx]!, ...update };
    const newGroups = [...groups];
    newGroups[groupIdx] = { ...group, clips: newClips };
    updateAction(actionName, { groups: newGroups });
  }, [updateAction]);

  const toggleBodyPart = useCallback((actionName: string, groups: AnimationGroup[], groupIdx: number, clipIdx: number, part: string) => {
    const layer = groups[groupIdx]!.clips[clipIdx]!;
    const currentParts = layer.bodyParts;
    const newParts = currentParts.includes(part)
      ? currentParts.filter(p => p !== part)
      : [...currentParts, part];
    if (newParts.length === 0) return;
    updateClipLayer(actionName, groups, groupIdx, clipIdx, { bodyParts: newParts });
  }, [updateClipLayer]);

  const handleExpandGroup = useCallback((index: number) => {
    const newExpanded = expandedGroup === index ? -1 : index;
    setExpandedGroup(newExpanded);
    if (newExpanded >= 0 && selectedAction) {
      dispatch({ type: 'SET_PREVIEW_GROUP_INDEX', index: newExpanded });
    }
  }, [expandedGroup, selectedAction, dispatch]);

  if (!selectedAction) {
    return <div style={emptyStyle}>Select an action from the list</div>;
  }

  const action = data.actions[selectedAction];
  if (!action) {
    return <div style={emptyStyle}>Action not found: {selectedAction}</div>;
  }

  // Compute normalized rarity percentages for display
  const totalRarity = action.groups.reduce((sum, g) => sum + g.rarity, 0);

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>{selectedAction}</div>

      {action.groups.map((group, gi) => {
        const expanded = expandedGroup === gi;
        const rarityPct = totalRarity > 0
          ? Math.round((group.rarity / totalRarity) * 100)
          : 0;

        return (
          <div key={gi} style={groupStyle(expanded)}>
            {/* Group header — accordion toggle */}
            <div
              style={groupHeaderStyle(expanded)}
              onClick={() => handleExpandGroup(gi)}
            >
              <span style={chevronStyle(expanded)}>▶</span>
              <span style={groupLabelStyle}>
                Group {gi + 1}
                <span style={{ fontWeight: 400, color: 'var(--color-text-dim)', marginLeft: 6 }}>
                  ({group.clips.length} clip{group.clips.length !== 1 ? 's' : ''})
                </span>
              </span>

              {/* Rarity slider in header */}
              <span style={rarityLabelStyle}>{rarityPct}%</span>
              <input
                type="range"
                min={0} max={1} step={0.01}
                value={group.rarity}
                style={raritySliderStyle}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  updateGroup(selectedAction, action.groups, gi, {
                    rarity: parseFloat(e.target.value),
                  });
                }}
              />

              {action.groups.length > 1 && (
                <button
                  style={groupDeleteBtnStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                    const newGroups = action.groups.filter((_, idx) => idx !== gi);
                    updateAction(selectedAction, { groups: newGroups });
                    if (expandedGroup >= newGroups.length) {
                      setExpandedGroup(Math.max(0, newGroups.length - 1));
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Group body — clip layers (shown when expanded) */}
            {expanded && (
              <div style={groupBodyStyle}>
                {group.clips.map((layer, ci) => (
                  <div key={ci} style={clipRowStyle}>
                    <select
                      style={selectStyle}
                      value={layer.clip}
                      onChange={(e) => {
                        const newClipId = e.target.value;
                        const newClipData = data.clips[newClipId];
                        updateClipLayer(selectedAction, action.groups, gi, ci, {
                          clip: newClipId,
                          bodyParts: newClipData?.bodyParts ?? layer.bodyParts,
                        });
                      }}
                    >
                      {!layer.clip && <option value="" disabled>— select clip —</option>}
                      {clipIds.map(id => <option key={id} value={id}>{id}</option>)}
                    </select>

                    <input
                      type="range"
                      min={0} max={1} step={0.05}
                      value={layer.weight}
                      style={sliderStyle}
                      onChange={(e) => updateClipLayer(selectedAction, action.groups, gi, ci, {
                        weight: parseFloat(e.target.value),
                      })}
                    />
                    <span style={weightValueStyle}>{layer.weight.toFixed(2)}</span>

                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {BODY_PARTS.map(part => (
                        <button
                          key={part}
                          style={chipStyle(layer.bodyParts.includes(part), BODY_PART_COLOR[part])}
                          onClick={() => toggleBodyPart(selectedAction, action.groups, gi, ci, part)}
                        >
                          {BODY_PART_ICON[part]} {part}
                        </button>
                      ))}
                    </div>

                    {group.clips.length > 1 && (
                      <button
                        style={removeBtnStyle}
                        onClick={() => {
                          const newClips = group.clips.filter((_, idx) => idx !== ci);
                          updateGroup(selectedAction, action.groups, gi, { clips: newClips });
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
                      ...group.clips,
                      {
                        clip: '',
                        weight: 0.5,
                        bodyParts: ['head', 'torso', 'arms', 'legs', 'feet'],
                      },
                    ];
                    updateGroup(selectedAction, action.groups, gi, { clips: newClips });
                  }}
                >
                  + Add Clip
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Add new group button */}
      <button
        style={addGroupBtnStyle}
        onClick={() => {
          const newGroups = [
            ...action.groups,
            {
              rarity: 0.5,
              clips: [{
                clip: '',
                weight: 1,
                bodyParts: ['head', 'torso', 'arms', 'legs', 'feet'],
              }],
            },
          ];
          updateAction(selectedAction, { groups: newGroups });
          const newIdx = newGroups.length - 1;
          setExpandedGroup(newIdx);
          dispatch({ type: 'SET_PREVIEW_GROUP_INDEX', index: newIdx });
        }}
      >
        + Add Group
      </button>

      {/* Duration override */}
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
