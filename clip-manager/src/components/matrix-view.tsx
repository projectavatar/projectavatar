/**
 * Matrix View — Actions × Emotions grid.
 * Shows which clip plays for each combination, color-coded.
 */
import { useMemo } from 'react';
import type { ClipsJson } from '../types.ts';
import type { Action } from '../state.ts';
import { ACTIONS, EMOTIONS } from '@project-avatar/shared';

const containerStyle: React.CSSProperties = {
  height: '100%',
  overflow: 'auto',
  padding: 14,
};

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
};

const thStyle: React.CSSProperties = {
  padding: '6px 4px',
  fontWeight: 600,
  textAlign: 'center',
  color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  background: 'var(--color-bg)',
  zIndex: 1,
};

const thRowStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: 'left',
  position: 'sticky',
  left: 0,
  background: 'var(--color-bg)',
  zIndex: 2,
  minWidth: 100,
};

type CellType = 'default' | 'override' | 'layered' | 'both';

function getCellInfo(action: string, emotion: string, data: ClipsJson): { clip: string; type: CellType } {
  const actionData = data.actions[action];
  if (!actionData) return { clip: '?', type: 'default' };

  const emotionData = data.emotions[emotion];
  const hasOverride = emotionData?.overrides[action] != null;
  const hasLayers = (emotionData?.layers.length ?? 0) > 0;

  let clip = actionData.primary.clip;
  let type: CellType = 'default';

  if (hasOverride) {
    clip = emotionData!.overrides[action]!.clip;
    type = hasLayers ? 'both' : 'override';
  } else if (hasLayers) {
    type = 'layered';
  }

  return { clip, type };
}

const cellColors: Record<CellType, string> = {
  default: 'transparent',
  override: 'rgba(108, 92, 231, 0.15)',
  layered: 'rgba(46, 204, 113, 0.12)',
  both: 'rgba(241, 196, 15, 0.12)',
};

const cellBorders: Record<CellType, string> = {
  default: 'var(--color-border)',
  override: 'rgba(108, 92, 231, 0.3)',
  layered: 'rgba(46, 204, 113, 0.3)',
  both: 'rgba(241, 196, 15, 0.3)',
};

const cellStyle = (type: CellType): React.CSSProperties => ({
  padding: '4px 3px',
  border: `1px solid ${cellBorders[type]}`,
  background: cellColors[type],
  textAlign: 'center',
  cursor: 'pointer',
  maxWidth: 70,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: type === 'default' ? 'var(--color-text-dim)' : 'var(--color-text)',
  transition: 'background 0.1s',
});

const legendStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginBottom: 10,
  fontSize: 10,
  color: 'var(--color-text-muted)',
};

const legendDotStyle = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: 2,
  background: color,
  display: 'inline-block',
  marginRight: 4,
  verticalAlign: 'middle',
});

interface MatrixViewProps {
  data: ClipsJson;
  dispatch: React.Dispatch<Action>;
}

export function MatrixView({ data, dispatch }: MatrixViewProps) {
  // Filter to only emotions that have modifiers (to keep matrix manageable)
  const activeEmotions = useMemo(() =>
    EMOTIONS.filter(e => data.emotions[e] != null || e === 'idle'),
    [data.emotions],
  );

  return (
    <div style={containerStyle}>
      {/* Legend */}
      <div style={legendStyle}>
        <span><span style={legendDotStyle(cellColors.default)} /> Default</span>
        <span><span style={legendDotStyle(cellColors.override)} /> Override</span>
        <span><span style={legendDotStyle(cellColors.layered)} /> + Layer</span>
        <span><span style={legendDotStyle(cellColors.both)} /> Override + Layer</span>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thRowStyle}>Action \ Emotion</th>
            {activeEmotions.map(e => (
              <th key={e} style={thStyle}>{e}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ACTIONS.map(action => (
            <tr key={action}>
              <td style={thRowStyle}>{action}</td>
              {activeEmotions.map(emotion => {
                const { clip, type } = getCellInfo(action, emotion, data);
                const shortName = clip.length > 12 ? clip.slice(0, 12) + '…' : clip;
                return (
                  <td
                    key={emotion}
                    style={cellStyle(type)}
                    title={`${action} + ${emotion} → ${clip}`}
                    onClick={() => {
                      dispatch({ type: 'SET_PREVIEW_CLIP', clipId: clip });
                    }}
                  >
                    {shortName}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
