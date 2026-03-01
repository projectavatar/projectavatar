/**
 * Props tab center panel — shows which clips use the selected prop
 * and allows editing prop bindings on clips.
 *
 * For clips already bound to this prop: shows transform editor.
 * For unbound clips: shows a button to bind the prop.
 */
import { useState, useCallback } from 'react';
import type { ClipsJson, ClipPropBinding, PropTransform } from '../types.ts';
import type { Action } from '../state.ts';

interface PropEditorProps {
  data: ClipsJson;
  selectedProp: string | null;
  dispatch: React.Dispatch<Action>;
}

const MATERIAL_OPTIONS = ['holographic', 'solid', 'ghostly'] as const;

const DEFAULT_TRANSFORM: PropTransform = {
  position: [0, 0.7, 0.3],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'auto',
  padding: 16,
};

const emptyStyle: React.CSSProperties = {
  padding: 20,
  color: 'var(--color-text-dim)',
  fontStyle: 'italic',
  fontSize: 12,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 24,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-dim)',
  marginBottom: 8,
};

const clipRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px',
  background: 'rgba(255,255,255,0.02)',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  marginBottom: 8,
};

const clipHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const clipNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
};

const vec3RowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-dim)',
  width: 60,
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  width: 70,
  padding: '4px 6px',
  fontSize: 12,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  color: 'inherit',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 'auto',
};

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'inherit',
};

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  color: '#f87171',
  borderColor: 'rgba(248,113,113,0.3)',
};

const bindButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  borderColor: 'rgba(96,165,250,0.4)',
  color: '#60a5fa',
};

const unboundClipStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  marginBottom: 4,
  fontSize: 13,
};

// ─── Vec3 Input ───────────────────────────────────────────────────────────────

function Vec3Input({ label, value, onChange }: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
}) {
  const labels = ['X', 'Y', 'Z'];
  return (
    <div style={vec3RowStyle}>
      <span style={labelStyle}>{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>{labels[i]}</span>
          <input
            type="number"
            step={label === 'scale' ? 0.1 : 0.01}
            style={inputStyle}
            value={value[i]}
            onChange={(e) => {
              const copy: [number, number, number] = [...value];
              copy[i] = parseFloat(e.target.value) || 0;
              onChange(copy);
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Clip Binding Editor ──────────────────────────────────────────────────────

function ClipBindingEditor({ clipId, binding, dispatch }: {
  clipId: string;
  binding: ClipPropBinding;
  dispatch: React.Dispatch<Action>;
}) {
  const updateTransform = useCallback((field: keyof PropTransform, value: [number, number, number]) => {
    const newBinding: ClipPropBinding = {
      ...binding,
      transform: { ...binding.transform, [field]: value },
    };
    dispatch({ type: 'UPDATE_CLIP', clipId, data: { propBinding: newBinding } });
  }, [clipId, binding, dispatch]);

  const updateMaterial = useCallback((material: ClipPropBinding['material']) => {
    const newBinding: ClipPropBinding = { ...binding, material };
    dispatch({ type: 'UPDATE_CLIP', clipId, data: { propBinding: newBinding } });
  }, [clipId, binding, dispatch]);

  const removeProp = useCallback(() => {
    dispatch({ type: 'UPDATE_CLIP', clipId, data: { propBinding: undefined } });
  }, [clipId, dispatch]);

  return (
    <div style={clipRowStyle}>
      <div style={clipHeaderStyle}>
        <span style={clipNameStyle}>{clipId}</span>
        <button style={dangerButtonStyle} onClick={removeProp}>Unbind</button>
      </div>

      <Vec3Input
        label="position"
        value={binding.transform.position}
        onChange={(v) => updateTransform('position', v)}
      />
      <Vec3Input
        label="rotation"
        value={binding.transform.rotation}
        onChange={(v) => updateTransform('rotation', v)}
      />
      <Vec3Input
        label="scale"
        value={binding.transform.scale}
        onChange={(v) => updateTransform('scale', v)}
      />

      <div style={vec3RowStyle}>
        <span style={labelStyle}>material</span>
        <select
          style={selectStyle}
          value={binding.material ?? 'holographic'}
          onChange={(e) => updateMaterial(e.target.value as ClipPropBinding['material'])}
        >
          {MATERIAL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── PropEditor ───────────────────────────────────────────────────────────────

export function PropEditor({ data, selectedProp, dispatch }: PropEditorProps) {
  const [showUnbound, setShowUnbound] = useState(false);

  if (!selectedProp) {
    return <div style={emptyStyle}>Select a prop from the list</div>;
  }

  // Find all clips bound to this prop
  const boundClips: [string, ClipPropBinding][] = [];
  const unboundClips: string[] = [];

  for (const [clipId, clip] of Object.entries(data.clips)) {
    if (clip.propBinding?.prop === selectedProp) {
      boundClips.push([clipId, clip.propBinding]);
    } else if (!clip.propBinding) {
      unboundClips.push(clipId);
    }
  }

  const bindPropToClip = (clipId: string) => {
    const binding: ClipPropBinding = {
      prop: selectedProp,
      transform: { ...DEFAULT_TRANSFORM },
      material: 'holographic',
    };
    dispatch({ type: 'UPDATE_CLIP', clipId, data: { propBinding: binding } });
  };

  return (
    <div style={containerStyle}>
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>
          Bound clips ({boundClips.length})
        </div>
        {boundClips.length === 0 ? (
          <div style={{ ...emptyStyle, padding: '8px 0' }}>
            No clips bound to "{selectedProp}" yet. Bind a clip below.
          </div>
        ) : (
          boundClips.map(([clipId, binding]) => (
            <ClipBindingEditor
              key={clipId}
              clipId={clipId}
              binding={binding}
              dispatch={dispatch}
            />
          ))
        )}
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={sectionTitleStyle}>
            Available clips ({unboundClips.length})
          </div>
          {unboundClips.length > 0 && (
            <button
              style={buttonStyle}
              onClick={() => setShowUnbound(!showUnbound)}
            >
              {showUnbound ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        {showUnbound && unboundClips.map((clipId) => (
          <div key={clipId} style={unboundClipStyle}>
            <span>{clipId}</span>
            <button style={bindButtonStyle} onClick={() => bindPropToClip(clipId)}>
              Bind
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
