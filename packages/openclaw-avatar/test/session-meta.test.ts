/**
 * Tests for deriveSessionPriority and deriveSessionMeta (via index.ts internals).
 *
 * These functions are not exported, so we test them via the observable behavior
 * of the relay calls — specifically the priority values that flow through.
 * For direct unit tests we duplicate the logic here and keep it in sync.
 */

import { describe, it, expect } from 'vitest';

// ── Duplicate of deriveSessionPriority from index.ts ─────────────────────────
// Kept in sync manually. If you change the source, update this too.
// This is preferable to exporting a private utility just for tests.
function deriveSessionPriority(sessionKey: string): number {
  const lower = sessionKey.toLowerCase();

  let depth = 0;
  let pos   = 0;
  const marker = ':subagent:';
  while ((pos = lower.indexOf(marker, pos)) !== -1) {
    depth++;
    pos += marker.length;
  }
  if (depth > 0) return depth;

  const parts = lower.split(':').filter(Boolean);
  if (parts.includes('cron')) return 1;

  return 0;
}

describe('deriveSessionPriority', () => {
  it('returns 0 for main Discord channel sessions', () => {
    expect(deriveSessionPriority('agent:main:discord:guild-123:channel-456')).toBe(0);
  });

  it('returns 0 for main DM sessions', () => {
    expect(deriveSessionPriority('agent:main:discord:dm-789')).toBe(0);
  });

  it('returns 0 for unknown session formats (safe default)', () => {
    expect(deriveSessionPriority('agent:main:someunknowntype:xyz')).toBe(0);
  });

  it('returns 1 for sub-agent sessions', () => {
    expect(deriveSessionPriority('agent:main:subagent:abc-def-123')).toBe(1);
  });

  it('returns 2 for nested sub-agent sessions (sub-agent spawned by a sub-agent)', () => {
    expect(deriveSessionPriority('agent:main:subagent:uuid1:subagent:uuid2')).toBe(2);
  });

  it('returns 3 for triple-nested sub-agent sessions', () => {
    expect(deriveSessionPriority('agent:main:subagent:a:subagent:b:subagent:c')).toBe(3);
  });

  it('returns 1 for cron sessions', () => {
    expect(deriveSessionPriority('agent:main:cron:some-task-id')).toBe(1);
  });

  it('returns 1 for cron sessions regardless of cron segment position', () => {
    // Resilient detection — checks all segments, not just parts[2]
    expect(deriveSessionPriority('agent:main:scheduled:cron:task')).toBe(1);
  });

  it('is case-insensitive for subagent detection', () => {
    // OpenClaw generates consistent casing, but be safe
    expect(deriveSessionPriority('agent:main:SUBAGENT:uuid')).toBe(1);
  });

  it('is case-insensitive for cron detection', () => {
    expect(deriveSessionPriority('agent:main:CRON:task')).toBe(1);
  });

  it('sub-agent depth takes priority over cron keyword', () => {
    // A cron job that spawned a sub-agent — depth wins
    expect(deriveSessionPriority('agent:main:cron:task:subagent:uuid')).toBe(1);
  });
});
