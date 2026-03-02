/**
 * DebugHitbox — renders the click-through bounding box as a visible overlay.
 * Green border when cursor is inside, red when outside.
 * Only rendered when debug=true.
 */
import type { DebugBbox } from './use-click-through.ts';

export function DebugHitbox({ bbox }: { bbox: DebugBbox | null }) {
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
        transition: 'border-color 0.1s',
        // Subtle fill so the box is visible on any background
        background: bbox.hit
          ? 'rgba(0, 255, 136, 0.06)'
          : 'rgba(255, 68, 68, 0.04)',
      }}
    >
      {/* Label */}
      <span
        style={{
          position: 'absolute',
          top: -18,
          left: 0,
          fontSize: 10,
          fontFamily: 'monospace',
          color: bbox.hit ? '#00ff88' : '#ff4444',
          whiteSpace: 'nowrap',
          textShadow: '0 0 4px rgba(0,0,0,0.8)',
        }}
      >
        hitbox {bbox.hit ? '✓ HIT' : '✗ MISS'}
      </span>
    </div>
  );
}
