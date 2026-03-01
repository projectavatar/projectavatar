/**
 * Clip Detail editor — shows when a clip is selected.
 * Edit tags, playback settings, see where the clip is used.
 */
import { useMemo, useCallback } from 'react';
import type { ClipsJson, ClipData, ClipPropBinding, PropTransform } from '../types.ts';
import type { AvailableProp } from '../hooks/use-scan-props.ts';
import { getClipUsage, getClipStatus } from '../state.ts';
import type { Action } from '../state.ts';
import { BodyPartPicker } from './body-part-picker.tsx';
import { normalizeBodyParts } from '@project-avatar/avatar-engine';

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  padding: 14,
  overflowY: 'auto',
  height: '100%',
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 16,
  fontWeight: 700,
  color: '#fff',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--color-text-muted)',
  marginBottom: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 0',
  borderBottom: '1px solid rgba(42, 42, 58, 0.3)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text)',
};

const toggleStyle = (on: boolean): React.CSSProperties => ({
  width: 32,
  height: 16,
  borderRadius: 8,
  background: on ? 'var(--color-accent)' : 'var(--color-border)',
  cursor: 'pointer',
  position: 'relative',
  transition: 'background 0.15s',
  flexShrink: 0,
});

const knobStyle = (on: boolean): React.CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: 6,
  background: '#fff',
  position: 'absolute',
  top: 2,
  left: on ? 18 : 2,
  transition: 'left 0.15s',
});

const selectStyle: React.CSSProperties = {
  padding: '3px 6px',
  fontSize: 11,
  minWidth: 100,
};

const numberStyle: React.CSSProperties = {
  width: 60,
  padding: '3px 6px',
  fontSize: 11,
  textAlign: 'right',
};

const tagInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 11,
};

const usageChipStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 10,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  marginRight: 4,
  marginBottom: 4,
};

const statusBadgeStyle = (status: string): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 10,
  fontSize: 10,
  fontWeight: 700,
  fontFamily: 'var(--font-mono)',
  color: status === 'mapped' ? 'var(--color-success)' : 'var(--color-orphan)',
  border: `1px solid ${status === 'mapped' ? 'var(--color-success)' : 'var(--color-orphan)'}`,
});

const CATEGORIES = ['idle', 'gesture', 'reaction', 'emotion', 'continuous'] as const;
const MATERIAL_OPTIONS = ['holographic', 'solid', 'ghostly'] as const;

const DEFAULT_TRANSFORM: PropTransform = {
  position: [0, 0.7, 0.3],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};
const ENERGIES = ['low', 'medium', 'high'] as const;

// ─── Component ────────────────────────────────────────────────────────────────

interface ClipDetailProps {
  clipId: string;
  data: ClipsJson;
  dispatch: React.Dispatch<Action>;
  availableProps: AvailableProp[];
}

export function ClipDetail({ clipId, data, dispatch, availableProps }: ClipDetailProps) {
  const clip = data.clips[clipId];
  if (!clip) return null;

  const status = getClipStatus(clipId, data);
  const usage = useMemo(() => getClipUsage(clipId, data), [clipId, data]);

  const update = useCallback(
    (partial: Partial<ClipData>) => {
      dispatch({ type: 'UPDATE_CLIP', clipId, data: partial });
    },
    [dispatch, clipId],
  );

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={titleStyle}>{clipId}</div>
        <span style={statusBadgeStyle(status)}>{status}</span>
      </div>

      {/* Playback */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Playback</div>

        <div style={rowStyle}>
          <span style={labelStyle}>Loop</span>
          <div style={toggleStyle(clip.loop)} onClick={() => update({ loop: !clip.loop })}>
            <div style={knobStyle(clip.loop)} />
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Fade In</span>
          <input
            type="number"
            style={numberStyle}
            value={clip.fadeIn}
            step={0.05}
            min={0}
            max={2}
            onChange={(e) => update({ fadeIn: parseFloat(e.target.value) || 0 })}
          />
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Fade Out</span>
          <input
            type="number"
            style={numberStyle}
            value={clip.fadeOut}
            step={0.05}
            min={0}
            max={2}
            onChange={(e) => update({ fadeOut: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>

      {/* Categorization */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Categorization</div>

        <div style={rowStyle}>
          <span style={labelStyle}>Category</span>
          <select
            style={selectStyle}
            value={clip.category}
            onChange={(e) => update({ category: e.target.value as ClipData['category'] })}
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Energy</span>
          <select
            style={selectStyle}
            value={clip.energy}
            onChange={(e) => update({ energy: e.target.value as ClipData['energy'] })}
          >
            {ENERGIES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Hand Gesture</span>
          <select
            style={selectStyle}
            value={clip.handGesture ?? 'relaxed'}
            onChange={(e) => update({ handGesture: e.target.value as ClipData['handGesture'] })}
          >
            <option value="relaxed">relaxed</option>
            <option value="fist">fist</option>
            <option value="pointing">pointing</option>
            <option value="none">none</option>
          </select>
        </div>
      </div>

      {/* Tags */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Tags</div>
        <input
          style={tagInputStyle}
          value={clip.tags.join(', ')}
          placeholder="comma-separated tags"
          onChange={(e) => {
            const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
            update({ tags });
          }}
        />
      </div>

      {/* Body Parts */}
      <BodyPartPicker
        bodyParts={normalizeBodyParts(clip.bodyParts)}
        onChange={(bodyParts) => update({ bodyParts })}
      />

      {/* Prop Binding */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Prop</div>
        <div style={rowStyle}>
          <span style={labelStyle}>Model</span>
          <select
            style={{ ...selectStyle, minWidth: 120 }}
            value={clip.propBinding?.prop ?? ''}
            onChange={(e) => {
              const propId = e.target.value;
              if (!propId) {
                update({ propBinding: undefined });
              } else {
                const existing = clip.propBinding;
                update({
                  propBinding: {
                    prop: propId,
                    transform: existing?.transform ?? { ...DEFAULT_TRANSFORM },
                    material: existing?.material ?? 'holographic',
                  },
                });
              }
            }}
          >
            <option value="">None</option>
            {availableProps.map(p => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>
        </div>
        {clip.propBinding && (
          <>
            <div style={rowStyle}>
              <span style={labelStyle}>Material</span>
              <select
                style={selectStyle}
                value={clip.propBinding.material ?? 'holographic'}
                onChange={(e) => {
                  update({
                    propBinding: {
                      ...clip.propBinding!,
                      material: e.target.value as ClipPropBinding['material'],
                    },
                  });
                }}
              >
                {MATERIAL_OPTIONS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-dim)', marginTop: 4, fontStyle: 'italic' }}>
              Use the gizmo in the preview to position the prop.
            </div>
          </>
        )}
      </div>

      {/* Usage */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Used By</div>
        {usage.actions.length === 0 && usage.emotions.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-dim)', fontStyle: 'italic' }}>
            Not used by any action or emotion
          </div>
        ) : (
          <div>
            {usage.actions.map(a => (
              <span key={a} style={usageChipStyle}>action: {a}</span>
            ))}
            {usage.emotions.map(e => (
              <span key={e} style={usageChipStyle}>emotion: {e}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
