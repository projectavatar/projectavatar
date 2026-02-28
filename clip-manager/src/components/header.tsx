/**
 * Header bar — model selector, save/export, unsaved indicator.
 */
import { useCallback } from 'react';
import type { ClipsJson } from '../types.ts';

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: 'var(--header-height)',
  padding: '0 16px',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  gap: 12,
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--color-accent)',
  letterSpacing: '0.3px',
};

const spacerStyle: React.CSSProperties = { flex: 1 };

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 11,
  borderRadius: 4,
};

const btnStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: 4,
  border: '1px solid var(--color-accent)',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  transition: 'opacity 0.15s',
};

const secondaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'transparent',
  color: 'var(--color-accent)',
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--color-warning)',
};

interface HeaderProps {
  dirty: boolean;
  data: ClipsJson;
  modelUrl: string;
  onModelChange: (url: string) => void;
  onSave: () => void;
  modelOptions: { id: string; url: string }[];
}

export function Header({ dirty, data, modelUrl, onModelChange, onSave, modelOptions }: HeaderProps) {
  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clips.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  return (
    <div style={headerStyle}>
      <span style={titleStyle}>Clip Manager</span>

      <div style={spacerStyle} />

      {/* Model selector */}
      <select
        style={selectStyle}
        value={modelUrl}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {modelOptions.map(m => (
          <option key={m.id} value={m.url}>{m.id}</option>
        ))}
      </select>

      {/* Unsaved indicator */}
      {dirty && <div style={dotStyle} title="Unsaved changes" />}

      {/* Save */}
      <button style={btnStyle} onClick={onSave} title="Ctrl+S">
        Save
      </button>

      {/* Export fallback */}
      <button style={secondaryBtnStyle} onClick={handleExport}>
        Export
      </button>
    </div>
  );
}
