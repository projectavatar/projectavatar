/**
 * Body Part Picker — always-visible toggleable bone group chips.
 *
 * All four parts (head, torso, arms, legs) are selected by default.
 * Each chip is independently toggleable. Toggling a part off masks
 * those bones in the preview.
 */
import { useCallback } from 'react';
import { BODY_PARTS, BODY_PART_ICON, BODY_PART_COLOR } from '../body-parts.ts';

// ─── Styles ───────────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--color-text-muted)',
  marginBottom: 8,
};

const chipsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const chipStyle = (active: boolean, color: string): React.CSSProperties => ({
  padding: '5px 12px',
  borderRadius: 12,
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  border: `1.5px solid ${active ? color : 'var(--color-border)'}`,
  background: active ? `${color}18` : 'transparent',
  color: active ? color : 'var(--color-text-muted)',
  opacity: active ? 1 : 0.5,
  textDecoration: active ? 'none' : 'line-through',
  userSelect: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
});

// ─── Component ────────────────────────────────────────────────────────────────

interface BodyPartPickerProps {
  bodyParts: string[];
  onChange: (parts: string[]) => void;
}

export function BodyPartPicker({ bodyParts, onChange }: BodyPartPickerProps) {
  const isActive = useCallback(
    (part: string) => bodyParts.includes(part),
    [bodyParts],
  );

  const toggle = useCallback(
    (part: string) => {
      if (isActive(part)) {
        const remaining = bodyParts.filter((p) => p !== part);
        if (remaining.length === 0) return;
        onChange(remaining);
      } else {
        onChange([...bodyParts, part]);
      }
    },
    [bodyParts, isActive, onChange],
  );

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Body Parts</div>
      <div style={chipsStyle}>
        {BODY_PARTS.map((part) => (
          <div
            key={part}
            style={chipStyle(isActive(part), BODY_PART_COLOR[part])}
            onClick={() => toggle(part)}
          >
            {BODY_PART_ICON[part]} {part}
          </div>
        ))}
      </div>
    </div>
  );
}
