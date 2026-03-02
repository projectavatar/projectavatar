/**
 * Emotion List — left panel for Emotions tab.
 * Lists all emotions with override/layer count and color indicator.
 */
import { useMemo, useState } from 'react';
import type { ClipsJson } from '../types.ts';
import type { Action } from '../state.ts';
import { PRIMARY_EMOTIONS } from '@project-avatar/shared';

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

interface EmotionListProps {
  data: ClipsJson;
  selectedEmotion: string | null;
  dispatch: React.Dispatch<Action>;
}

export function EmotionList({ data, selectedEmotion, dispatch }: EmotionListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEmotions = useMemo(() => {
    const sorted = [...PRIMARY_EMOTIONS].sort((a, b) => a.localeCompare(b));
    if (!searchQuery) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter(name => name.includes(q));
  }, [searchQuery]);
  return (
    <div style={panelStyle}>
      <div style={searchWrapStyle}>
        <input
          style={searchStyle}
          placeholder="Search emotions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div style={listStyle}>
        {filteredEmotions.map(name => {
          const emotion = data.emotions[name];
          const selected = selectedEmotion === name;
          const overrideCount = emotion ? Object.keys(emotion.overrides).length : 0;
          const layerCount = emotion?.layers.length ?? 0;
          const hasConfig = emotion != null;
          const totalMappings = overrideCount + layerCount;

          // Color: green if configured, gray if not, orange if configured but empty
          const statusColor = !hasConfig
            ? 'var(--color-text-dim)'
            : totalMappings > 0
              ? 'var(--color-success)'
              : 'var(--color-orphan)';

          const weightScale = emotion?.weightScale ?? 1.0;

          return (
            <div
              key={name}
              style={itemStyle(selected)}
              onClick={() => {
                dispatch({ type: 'EXPAND_EMOTION', emotion: selected ? null : name });
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={dotStyle(statusColor)} />
                <div style={itemNameStyle}>{name}</div>
              </div>
              <div style={itemMetaStyle}>
                {overrideCount > 0 && (
                  <span style={badgeStyle('var(--color-accent)')}>
                    {overrideCount} override{overrideCount !== 1 ? 's' : ''}
                  </span>
                )}
                {layerCount > 0 && (
                  <span style={badgeStyle('var(--color-text-muted)')}>
                    {layerCount} layer{layerCount !== 1 ? 's' : ''}
                  </span>
                )}
                {weightScale !== 1.0 && (
                  <span style={badgeStyle('var(--color-warning)')}>
                    ×{weightScale.toFixed(1)}
                  </span>
                )}
                {!hasConfig && (
                  <span style={{ fontSize: 9, color: 'var(--color-text-dim)', fontStyle: 'italic' }}>
                    not configured
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
