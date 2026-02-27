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

/**
 * Agent presence is computed from `lastAgentEventAt` on each render rather than
 * stored as state. This prevents the badge from showing a stale "active" indicator
 * long after the agent has gone idle — stored state would never transition
 * active→recent→away without a periodic timer.
 *
 * Trade-off: this re-computes on every render of StatusBadge. Given the component
 * renders infrequently (only when store fields it subscribes to change), this is fine.
 * If you need exact-time transitions (e.g. countdown), add a setInterval that
 * calls forceUpdate every 30s. Not needed for v1.1.
 */
function computePresence(lastAgentEventAt: number | null): 'active' | 'recent' | 'away' {
  if (!lastAgentEventAt) return 'away';
  const age = Date.now() - lastAgentEventAt;
  if (age < 60_000)  return 'active';
  if (age < 300_000) return 'recent';
  return 'away';
}

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
  const lastAgentEventAt = useStore((s) => s.lastAgentEventAt);
  const avatar           = useStore((s) => s.avatar);

  // Computed on render — not stored state — so it never goes stale
  const agentPresence = computePresence(lastAgentEventAt);

  const wsColor = WS_COLORS[connectionState];
  let wsLabel   = WS_LABELS[connectionState];
  if (connectionState === 'reconnecting' && reconnectAttempt > 0) {
    wsLabel = `Reconnecting (#${reconnectAttempt})`;
  }

  const presenceColor = PRESENCE_COLORS[agentPresence];
  const presenceLabel = PRESENCE_LABELS[agentPresence];

  return (
    <div style={badgeStyle}>
      <Dot color={wsColor} glow={connectionState === 'connected'} />
      <span style={{ color: 'var(--color-text-muted)' }}>{wsLabel}</span>

      {/* Agent presence only meaningful when the relay is connected */}
      {connectionState === 'connected' && (
        <>
          <div style={dividerStyle} />
          <Dot color={presenceColor} glow={agentPresence === 'active'} />
          <span style={{ color: 'var(--color-text-muted)' }}>{presenceLabel}</span>
        </>
      )}
      {import.meta.env.DEV && (
        <>
          <div style={dividerStyle} />
          <span style={{ color: 'var(--color-accent)', fontFamily: 'monospace' }}>
            {avatar.emotion} / {avatar.action}
          </span>
        </>
      )}
    </div>
  );
}
