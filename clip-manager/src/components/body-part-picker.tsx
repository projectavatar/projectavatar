/**
 * Body Part Picker — collapsible section with clickable bone group chips.
 *
 * Features:
 * - Collapsed by default: shows a compact overview of selected parts
 * - Expanded: shows clickable chips for each body part + "full" option
 * - Color-coded chips matching body part groups
 * - Toggling a part adds/removes it from the clip's bodyParts array
 * - "Full" is exclusive — selecting it clears individual selections
 * - Selecting any individual part clears "full"
 */
import { useState, useCallback, useMemo } from 'react';
import { BODY_PARTS, BODY_PART_ICON, BODY_PART_COLOR } from '../body-parts.ts';
import type { BodyPart } from '../body-parts.ts';

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


const miniChipStyle = (color: string): React.CSSProperties => ({
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: 9,
  fontFamily: 'var(--font-mono)',
  color,
  border: `1px solid ${color}`,
  opacity: 0.7,
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
  userSelect: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
});

// ─── Component ────────────────────────────────────────────────────────────────

interface BodyPartPickerProps {
  /** Currently selected body parts for this clip */
  bodyParts: string[];
  /** Called when body parts change */
  onChange: (parts: string[]) => void;
}

export function BodyPartPicker({ bodyParts, onChange }: BodyPartPickerProps) {
  const [expanded, setExpanded] = useState(false);

  const isFull = useMemo(
    () => bodyParts.includes('full'),
    [bodyParts],
  );

  const isPartActive = useCallback(
    (part: string) => bodyParts.includes(part),
    [bodyParts],
  );

  const togglePart = useCallback(
    (part: string) => {
      if (part === 'full') {
        // Full is exclusive — replace everything
        if (isFull) {
          // Deselecting full → empty (user can pick individual parts)
          onChange([]);
        } else {
          onChange(['full']);
        }
        return;
      }

      // Toggling an individual part
      let next: string[];
      if (isPartActive(part)) {
        next = bodyParts.filter((p) => p !== part && p !== 'full');
      } else {
        // Remove 'full' when adding individual parts
        next = [...bodyParts.filter((p) => p !== 'full'), part];
      }

      // If all individual parts are selected, collapse to 'full'
      const allSelected = BODY_PARTS.every((bp) => next.includes(bp));
      if (allSelected) {
        next = ['full'];
      }

      onChange(next);
    },
    [bodyParts, isFull, isPartActive, onChange],
  );

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle} onClick={() => setExpanded((e) => !e)}>
        <span style={chevronStyle(expanded)}>▶</span>
        Body Parts
        {/* Collapsed overview — inline chips */}
        {!expanded && bodyParts.length > 0 && (
          <div style={{ display: 'flex', gap: 3, marginLeft: 6 }}>
            {bodyParts.map((part) => (
              <span
                key={part}
                style={miniChipStyle(BODY_PART_COLOR[part as BodyPart | 'full'] ?? 'var(--color-text-dim)')}
              >
                {BODY_PART_ICON[part as BodyPart | 'full'] ?? ''} {part}
              </span>
            ))}
          </div>
        )}
        {!expanded && bodyParts.length === 0 && (
          <span style={{ fontSize: 9, color: 'var(--color-text-dim)', fontStyle: 'italic', marginLeft: 6 }}>
            none set
          </span>
        )}
      </div>

      {expanded && (
        <div style={expandedStyle}>
          {/* Full option */}
          <div
            style={chipStyle(isFull, BODY_PART_COLOR.full)}
            onClick={() => togglePart('full')}
          >
            {BODY_PART_ICON.full} full
          </div>

          {/* Individual parts */}
          {BODY_PARTS.map((part) => (
            <div
              key={part}
              style={chipStyle(isPartActive(part), BODY_PART_COLOR[part])}
              onClick={() => togglePart(part)}
            >
              {BODY_PART_ICON[part]} {part}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
