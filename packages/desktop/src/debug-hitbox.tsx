/**
 * DebugHitbox — 2D overlay showing the projected hitbox on screen.
 * Green when hit, red when miss.
 */
export function DebugHitbox({ bbox }: { bbox: { left: number; top: number; width: number; height: number; hit: boolean } | null }) {
  if (!bbox) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: `${bbox.left}%`,
        top: `${bbox.top}%`,
        width: `${bbox.width}%`,
        height: `${bbox.height}%`,
        border: `2px solid ${bbox.hit ? '#00ff88' : '#ff4444'}`,
        borderRadius: 4,
        pointerEvents: 'none',
        zIndex: 99999,
        background: bbox.hit ? 'rgba(0, 255, 136, 0.06)' : 'rgba(255, 68, 68, 0.04)',
      }}
    >
      <span style={{
        position: 'absolute', top: -18, left: 0,
        fontSize: 10, fontFamily: 'monospace',
        color: bbox.hit ? '#00ff88' : '#ff4444',
        whiteSpace: 'nowrap',
        textShadow: '0 0 4px rgba(0,0,0,0.8)',
      }}>
        hitbox {bbox.hit ? '✓ HIT' : '✗ MISS'}
      </span>
    </div>
  );
}
