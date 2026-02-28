/**
 * Clip Library — left panel.
 * Lists all clips with search, filter, status indicators.
 */
import { useMemo } from 'react';
import type { ClipsJson } from '../types.ts';
import { getClipStatus } from '../state.ts';
import type { Action } from '../state.ts';

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

const filterRowStyle: React.CSSProperties = {
  padding: '6px 12px',
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
  borderBottom: '1px solid var(--color-border)',
};

const filterChipStyle = (active: boolean): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 10,
  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
  background: active ? 'var(--color-accent-dim)' : 'transparent',
  color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'nowrap',
});

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

const dotStyle = (color: string): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
});

const tagChipStyle: React.CSSProperties = {
  padding: '0 5px',
  borderRadius: 6,
  fontSize: 9,
  color: 'var(--color-text-dim)',
  background: 'var(--color-surface-2)',
};

const CATEGORIES = ['idle', 'gesture', 'reaction', 'emotion', 'continuous'];
const ENERGIES = ['low', 'medium', 'high'];

// ─── Component ────────────────────────────────────────────────────────────────

interface ClipLibraryProps {
  data: ClipsJson;
  selectedClip: string | null;
  searchQuery: string;
  categoryFilter: string | null;
  energyFilter: string | null;
  dispatch: React.Dispatch<Action>;
}

export function ClipLibrary({
  data, selectedClip, searchQuery, categoryFilter, energyFilter, dispatch,
}: ClipLibraryProps) {
  const clips = useMemo(() => {
    let entries = Object.entries(data.clips);

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter(([id, clip]) =>
        id.includes(q) ||
        clip.tags.some(t => t.includes(q)) ||
        clip.category.includes(q),
      );
    }

    // Category filter
    if (categoryFilter) {
      entries = entries.filter(([, clip]) => clip.category === categoryFilter);
    }

    // Energy filter
    if (energyFilter) {
      entries = entries.filter(([, clip]) => clip.energy === energyFilter);
    }

    // Sort: mapped first, then orphans, alphabetical within
    return entries.sort(([aId], [bId]) => {
      const aStatus = getClipStatus(aId, data);
      const bStatus = getClipStatus(bId, data);
      if (aStatus !== bStatus) {
        if (aStatus === 'mapped') return -1;
        if (bStatus === 'mapped') return 1;
      }
      return aId.localeCompare(bId);
    });
  }, [data, searchQuery, categoryFilter, energyFilter]);

  const statusColor = (id: string): string => {
    const s = getClipStatus(id, data);
    if (s === 'orphan') return 'var(--color-orphan)';
    if (s === 'unregistered') return 'var(--color-unregistered)';
    return 'var(--color-success)';
  };

  const energyColor = (e: string) => {
    if (e === 'low') return 'var(--color-text-dim)';
    if (e === 'high') return 'var(--color-warning)';
    return 'var(--color-text-muted)';
  };

  return (
    <div style={panelStyle}>
      {/* Search */}
      <div style={searchWrapStyle}>
        <input
          style={searchStyle}
          placeholder="Search clips..."
          value={searchQuery}
          onChange={(e) => dispatch({ type: 'SET_SEARCH', query: e.target.value })}
        />
      </div>

      {/* Filters */}
      <div style={filterRowStyle}>
        {CATEGORIES.map(c => (
          <button
            key={c}
            style={filterChipStyle(categoryFilter === c)}
            onClick={() => dispatch({ type: 'SET_CATEGORY_FILTER', category: categoryFilter === c ? null : c })}
          >
            {c}
          </button>
        ))}
        <span style={{ width: 1, background: 'var(--color-border)', margin: '0 2px' }} />
        {ENERGIES.map(e => (
          <button
            key={e}
            style={filterChipStyle(energyFilter === e)}
            onClick={() => dispatch({ type: 'SET_ENERGY_FILTER', energy: energyFilter === e ? null : e })}
          >
            {e}
          </button>
        ))}
      </div>

      {/* Clip list */}
      <div style={listStyle}>
        {clips.map(([id, clip]) => (
          <div
            key={id}
            style={itemStyle(selectedClip === id)}
            onClick={() => {
              dispatch({ type: 'SELECT_CLIP', clipId: id });
              dispatch({ type: 'SET_PREVIEW_CLIP', clipId: id });
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={dotStyle(statusColor(id))} title={getClipStatus(id, data)} />
              <div style={itemNameStyle} title={id}>{id}</div>
            </div>
            <div style={itemMetaStyle}>
              <span style={badgeStyle(energyColor(clip.energy))}>{clip.energy}</span>
              <span style={badgeStyle('var(--color-text-dim)')}>{clip.category}</span>
              {clip.loop && <span style={badgeStyle('var(--color-accent)')}>loop</span>}
              {clip.tags.slice(0, 2).map(t => (
                <span key={t} style={tagChipStyle}>{t}</span>
              ))}
            </div>
          </div>
        ))}
        {clips.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-dim)', fontStyle: 'italic', fontSize: 12 }}>
            No clips match filters
          </div>
        )}
      </div>
    </div>
  );
}
