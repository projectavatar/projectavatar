/**
 * Action List — left panel for Actions tab.
 * Lists all actions with clip count and color indicator.
 */
import { useMemo, useState } from 'react';
import type { ClipsJson } from '../types.ts';
import type { Action } from '../state.ts';
import { ACTIONS } from '@project-avatar/shared';

// ─── Styles ───────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  borderRight: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  minWidth: 0,
};

const searchWrapStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--color-border)',
};

const searchStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 12,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
};

const itemStyle = (selected: boolean): React.CSSProperties => ({
  padding: '8px 12px',
  cursor: 'pointer',
  borderBottom: '1px solid rgba(42, 42, 58, 0.3)',
  background: selected ? 'var(--color-accent-dim)' : 'transparent',
  transition: 'background 0.1s',
});

const itemNameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const itemMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 3,
};

const dotStyle = (color: string): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
});

const badgeStyle = (color: string): React.CSSProperties => ({
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: 9,
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  color,
  border: `1px solid ${color}`,
  opacity: 0.8,
});

// ─── Component ────────────────────────────────────────────────────────────────

interface ActionListProps {
  data: ClipsJson;
  selectedAction: string | null;
  dispatch: React.Dispatch<Action>;
}

export function ActionList({ data, selectedAction, dispatch }: ActionListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredActions = useMemo(() => {
    const sorted = [...ACTIONS].sort((a, b) => a.localeCompare(b));
    if (!searchQuery) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter(name => name.includes(q));
  }, [searchQuery]);

  const getClipCount = (name: string): number => {
    return data.actions[name]?.clips.length ?? 0;
  };

  const getStatusColor = (name: string): string => {
    const action = data.actions[name];
    if (!action || action.clips.length === 0) return 'var(--color-orphan)';
    // Check if all referenced clips exist
    const allExist = action.clips.every(c => data.clips[c.clip]);
    if (!allExist) return 'var(--color-warning)';
    return 'var(--color-success)';
  };

  const getDurationLabel = (name: string): string | null => {
    const action = data.actions[name];
    if (!action) return null;
    const firstClip = action.clips[0];
    if (!firstClip) return null;
    const clipData = data.clips[firstClip.clip];
    if (clipData?.loop) return 'loop';
    if (action.durationOverride) return `${action.durationOverride}s`;
    return 'once';
  };

  return (
    <div style={panelStyle}>
      <div style={searchWrapStyle}>
        <input
          style={searchStyle}
          placeholder="Search actions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div style={listStyle}>
        {filteredActions.map(name => {
          const selected = selectedAction === name;
          const clipCount = getClipCount(name);
          const statusColor = getStatusColor(name);
          const duration = getDurationLabel(name);

          return (
            <div
              key={name}
              style={itemStyle(selected)}
              onClick={() => {
                dispatch({ type: 'EXPAND_ACTION', action: selected ? null : name });
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={dotStyle(statusColor)} />
                <div style={itemNameStyle}>{name}</div>
              </div>
              <div style={itemMetaStyle}>
                <span style={badgeStyle('var(--color-text-dim)')}>
                  {clipCount} clip{clipCount !== 1 ? 's' : ''}
                </span>
                {duration && (
                  <span style={badgeStyle('var(--color-accent)')}>{duration}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
