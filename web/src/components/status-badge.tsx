import { useStore } from '../state/store.ts';
import type { ConnectionState } from '../state/store.ts';

const badgeStyle: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 500,
  background: 'rgba(10, 10, 15, 0.75)',
  backdropFilter: 'blur(8px)',
  border: '1px solid var(--color-border)',
  zIndex: 100,
  userSelect: 'none',
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
};

const COLORS: Record<ConnectionState, string> = {
  connected: 'var(--color-success)',
  connecting: 'var(--color-warning)',
  reconnecting: 'var(--color-warning)',
  disconnected: 'var(--color-danger)',
};

const LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
};

export function StatusBadge() {
  const connectionState = useStore((s) => s.connectionState);
  const reconnectAttempt = useStore((s) => s.reconnectAttempt);

  const color = COLORS[connectionState];
  let label = LABELS[connectionState];

  if (connectionState === 'reconnecting' && reconnectAttempt > 0) {
    label = `Reconnecting (#${reconnectAttempt})`;
  }

  return (
    <div style={badgeStyle}>
      <div
        style={{
          ...dotStyle,
          background: color,
          boxShadow: connectionState === 'connected' ? `0 0 6px ${color}` : 'none',
        }}
      />
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  );
}
