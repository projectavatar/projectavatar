/**
 * VFX Editor — reusable component for configuring VFX bindings.
 * Used in both EmotionEditor and ActionEditor.
 */
import type { VfxBinding } from '../types.ts';

const VFX_TYPES = [
  'particle-aura',
  'thought-bubbles',
  'sparkles',
  'soft-glow',
  'rain',
  'embers',
  'confetti',
] as const;

const VFX_COLORS: Record<string, string> = {
  'particle-aura': '#4d99ff',
  'thought-bubbles': '#88ccff',
  'sparkles': '#ffdd44',
  'soft-glow': '#ffcc66',
  'rain': '#6699cc',
  'embers': '#ff6622',
  'confetti': '#ffdd44',
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--color-text-dim)',
  marginTop: 16,
  marginBottom: 8,
};

const vfxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderBottom: '1px solid rgba(42, 42, 58, 0.2)',
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

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  width: 60,
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

// ─── Component ────────────────────────────────────────────────────────────────

interface VfxEditorProps {
  vfx: VfxBinding[];
  onChange: (vfx: VfxBinding[]) => void;
}

export function VfxEditor({ vfx, onChange }: VfxEditorProps) {
  const updateVfx = (index: number, partial: Partial<VfxBinding>) => {
    const updated = [...vfx];
    updated[index] = { ...updated[index]!, ...partial };
    onChange(updated);
  };

  const removeVfx = (index: number) => {
    onChange(vfx.filter((_, i) => i !== index));
  };

  const addVfx = () => {
    const type = 'sparkles';
    onChange([...vfx, { type, color: VFX_COLORS[type], intensity: 1.0 }]);
  };

  return (
    <>
      <div style={sectionLabel}>VFX ({vfx.length})</div>
      {vfx.map((binding, i) => (
        <div key={i} style={vfxRowStyle}>
          {/* Type selector */}
          <select
            style={{ ...selectStyle, flex: 1 }}
            value={binding.type}
            onChange={(e) => {
              const type = e.target.value;
              updateVfx(i, { type, color: binding.color ?? VFX_COLORS[type] });
            }}
          >
            {VFX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Color picker */}
          <input
            type="color"
            value={binding.color ?? VFX_COLORS[binding.type] ?? '#ffffff'}
            style={{ width: 28, height: 24, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
            onChange={(e) => updateVfx(i, { color: e.target.value })}
          />

          {/* Intensity */}
          <input
            type="number"
            min={0.1} max={3.0} step={0.1}
            value={binding.intensity ?? 1.0}
            style={inputStyle}
            title="Intensity"
            onChange={(e) => updateVfx(i, { intensity: parseFloat(e.target.value) || 1.0 })}
          />

          {/* Offset Y */}
          <input
            type="number"
            min={-1} max={2} step={0.1}
            value={binding.offsetY ?? 0}
            style={{ ...inputStyle, width: 50 }}
            title="Y Offset"
            onChange={(e) => updateVfx(i, { offsetY: parseFloat(e.target.value) || 0 })}
          />

          <button style={removeBtnStyle} onClick={() => removeVfx(i)}>✕</button>
        </div>
      ))}
      <button style={addBtnStyle} onClick={addVfx}>+ Add VFX</button>
    </>
  );
}
