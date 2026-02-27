/**
 * Tests for deriveSessionPriority (session-utils.ts).
 *
 * Imports the real implementation — not a copy — so these tests will catch
 * regressions in the actual code rather than a drift between two versions.
 */

import { describe, it, expect } from 'vitest';
import { deriveSessionPriority } from '../src/session-utils.js';

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
    expect(deriveSessionPriority('agent:main:SUBAGENT:uuid')).toBe(1);
  });

  it('is case-insensitive for cron detection', () => {
    expect(deriveSessionPriority('agent:main:CRON:task')).toBe(1);
  });

  it('sub-agent depth takes priority over cron keyword', () => {
    // A cron job that spawned a sub-agent — depth wins (1 subagent segment = depth 1)
    expect(deriveSessionPriority('agent:main:cron:task:subagent:uuid')).toBe(1);
  });
});
