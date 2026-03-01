/**
 * Status bar — bottom of the app.
 */
import { useMemo } from 'react';
import type { ClipsJson } from '../types.ts';
import { getStats } from '../state.ts';

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: 'var(--status-height)',
  padding: '0 16px',
  borderTop: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'var(--color-text-muted)',
  gap: 16,
  flexShrink: 0,
};

const dotStyle = (color: string): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: color,
  display: 'inline-block',
  marginRight: 4,
});

interface StatusBarProps {
  data: ClipsJson;
  dirty: boolean;
  lastSaved: number | null;
  saveError?: string | null;
}

export function StatusBar({ data, dirty, lastSaved, saveError }: StatusBarProps) {
  const stats = useMemo(() => getStats(data), [data]);

  return (
    <div style={barStyle}>
      <span>{stats.total} clips</span>
      <span><span style={dotStyle('var(--color-success)')} />{stats.mapped} mapped</span>
      <span><span style={dotStyle('var(--color-orphan)')} />{stats.orphans} orphans</span>
      <span>{Object.keys(data.actions).length} actions</span>
      <span>{Object.keys(data.emotions).length} emotions</span>
      <span style={{ flex: 1 }} />
      {saveError && <span style={{ color: '#e17055' }}>✕ {saveError}</span>}
      {dirty && !saveError && <span style={{ color: 'var(--color-warning)' }}>● unsaved</span>}
      {lastSaved && (
        <span>saved {new Date(lastSaved).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      )}
    </div>
  );
}
