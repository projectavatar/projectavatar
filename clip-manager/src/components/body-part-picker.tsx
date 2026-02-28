/**
 * Body Part Picker — collapsible section with toggleable bone group chips.
 *
 * All four parts (head, torso, arms, legs) are selected by default.
 * Each chip is independently toggleable. Toggling a part off masks
 * those bones in the preview — the clip only plays on active parts.
 *
 * No "full" option — if all four are on, that IS full body.
 */
import { useState, useCallback } from 'react';
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
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  userSelect: 'none',
  gap: 6,
};

const chevronStyle = (expanded: boolean): React.CSSProperties => ({
  fontSize: 9,
  transition: 'transform 0.15s ease',
  transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
  color: 'var(--color-text-dim)',
});

const miniChipStyle = (active: boolean, color: string): React.CSSProperties => ({
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: 9,
  fontFamily: 'var(--font-mono)',
  color: active ? color : 'var(--color-text-dim)',
  border: `1px solid ${active ? color : 'var(--color-border)'}`,
  opacity: active ? 0.8 : 0.4,
  textDecoration: active ? 'none' : 'line-through',
});

const expandedStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  padding: '4px 0',
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
  /** Currently active body parts (all 4 = full body) */
  bodyParts: string[];
  /** Called when body parts change */
  onChange: (parts: string[]) => void;
}

export function BodyPartPicker({ bodyParts, onChange }: BodyPartPickerProps) {
  const [expanded, setExpanded] = useState(false);

  const isActive = useCallback(
    (part: string) => bodyParts.includes(part),
    [bodyParts],
  );

  const toggle = useCallback(
    (part: string) => {
      if (isActive(part)) {
        // Don't allow deselecting the last part
        const remaining = bodyParts.filter((p) => p !== part);
        if (remaining.length === 0) return;
        onChange(remaining);
      } else {
        onChange([...bodyParts, part]);
      }
    },
    [bodyParts, isActive, onChange],
  );

  // Count for collapsed summary
  const activeCount = BODY_PARTS.filter((p) => bodyParts.includes(p)).length;
  const allActive = activeCount === BODY_PARTS.length;

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle} onClick={() => setExpanded((e) => !e)}>
        <span style={chevronStyle(expanded)}>▶</span>
        Body Parts
        {/* Collapsed overview */}
        {!expanded && (
          <div style={{ display: 'flex', gap: 3, marginLeft: 6 }}>
            {allActive ? (
              <span style={{
                fontSize: 9,
                color: 'var(--color-text-dim)',
                fontFamily: 'var(--font-mono)',
              }}>
                all
              </span>
            ) : (
              BODY_PARTS.map((part) => (
                <span
                  key={part}
                  style={miniChipStyle(
                    isActive(part),
                    BODY_PART_COLOR[part],
                  )}
                >
                  {BODY_PART_ICON[part]} {part}
                </span>
              ))
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div style={expandedStyle}>
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
      )}
    </div>
  );
}
