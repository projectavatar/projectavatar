import { useStore } from '../state/store.ts';
import type { ConnectionState } from '../state/store.ts';

const badgeStyle: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
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
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 12,
  background: 'var(--color-border)',
  flexShrink: 0,
};

const WS_COLORS: Record<ConnectionState, string> = {
  connected:    'var(--color-success)',
  connecting:   'var(--color-warning)',
  reconnecting: 'var(--color-warning)',
  disconnected: 'var(--color-danger)',
};

const WS_LABELS: Record<ConnectionState, string> = {
  connected:    'Connected',
  connecting:   'Connecting...',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
};

const PRESENCE_COLORS: Record<'active' | 'recent' | 'away', string> = {
  active: 'var(--color-success)',
  recent: 'var(--color-warning)',
  away:   'var(--color-text-muted)',
};

const PRESENCE_LABELS: Record<'active' | 'recent' | 'away', string> = {
  active: 'Agent active',
  recent: 'Agent idle',
  away:   'Agent away',
};

function Dot({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <div
      style={{
        ...dotStyle,
        background: color,
        boxShadow: glow ? `0 0 5px ${color}` : 'none',
      }}
    />
  );
}

export function StatusBadge() {
  const connectionState  = useStore((s) => s.connectionState);
  const reconnectAttempt = useStore((s) => s.reconnectAttempt);
  const agentPresence    = useStore((s) => s.agentPresence);

  const wsColor = WS_COLORS[connectionState];
  let wsLabel   = WS_LABELS[connectionState];
  if (connectionState === 'reconnecting' && reconnectAttempt > 0) {
    wsLabel = `Reconnecting (#${reconnectAttempt})`;
  }

  const presenceColor = PRESENCE_COLORS[agentPresence];
  const presenceLabel = PRESENCE_LABELS[agentPresence];

  return (
    <div style={badgeStyle}>
      {/* WebSocket connection status */}
      <Dot color={wsColor} glow={connectionState === 'connected'} />
      <span style={{ color: 'var(--color-text-muted)' }}>{wsLabel}</span>

      {/* Divider — only show agent presence when connected */}
      {connectionState === 'connected' && (
        <>
          <div style={dividerStyle} />
          <Dot color={presenceColor} glow={agentPresence === 'active'} />
          <span style={{ color: 'var(--color-text-muted)' }}>{presenceLabel}</span>
        </>
      )}
    </div>
  );
}
