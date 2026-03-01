/**
 * Props tab left panel — lists all available prop models from /props/ folder.
 * Shows which clips reference each prop.
 */
import type { ClipsJson } from '../types.ts';
import type { AvailableProp } from '../hooks/use-scan-props.ts';
import type { Action } from '../state.ts';

interface PropListProps {
  data: ClipsJson;
  availableProps: AvailableProp[];
  selectedProp: string | null;
  dispatch: React.Dispatch<Action>;
}

function getClipsUsingProp(propId: string, data: ClipsJson): string[] {
  const clips: string[] = [];
  for (const [clipId, clip] of Object.entries(data.clips)) {
    if (clip.propBinding?.prop === propId) {
      clips.push(clipId);
    }
  }
  return clips;
}

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '12px 16px 8px',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-dim)',
  borderBottom: '1px solid var(--color-border)',
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: 13,
  borderBottom: '1px solid var(--color-border)',
  transition: 'background 0.1s',
};

const selectedItemStyle: React.CSSProperties = {
  ...itemStyle,
  background: 'var(--color-bg-selected, rgba(255,255,255,0.08))',
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--color-text-dim)',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: 4,
  padding: '2px 6px',
};

const emptyStyle: React.CSSProperties = {
  padding: '20px 16px',
  color: 'var(--color-text-dim)',
  fontStyle: 'italic',
  fontSize: 12,
  lineHeight: 1.6,
};

export function PropList({ data, availableProps, selectedProp, dispatch }: PropListProps) {
  return (
    <div style={listStyle}>
      <div style={headerStyle}>
        Props ({availableProps.length})
      </div>
      <div style={scrollStyle}>
        {availableProps.length === 0 ? (
          <div style={emptyStyle}>
            No .glb files found in <code>/props/</code>.<br />
            Drop GLB prop models into <code>web/public/props/</code> to get started.
          </div>
        ) : (
          availableProps.map((prop) => {
            const usedBy = getClipsUsingProp(prop.id, data);
            const isSelected = selectedProp === prop.id;
            return (
              <div
                key={prop.id}
                style={isSelected ? selectedItemStyle : itemStyle}
                onClick={() => dispatch({ type: 'SELECT_PROP', propId: prop.id })}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = '';
                }}
              >
                <span>{prop.id}</span>
                {usedBy.length > 0 && (
                  <span style={badgeStyle}>{usedBy.length} clip{usedBy.length !== 1 ? 's' : ''}</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
