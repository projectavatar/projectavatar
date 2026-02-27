/**
 * State machine tests.
 *
 * These tests focus on the debouncing, priority, and idle-timeout logic
 * without making any HTTP calls — the relay client is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAvatarStateMachine } from '../src/state-machine.js';
import type { AvatarEvent, AvatarSignal } from '../src/types.js';
import { IDLE_EVENT, DEFAULT_CONFIG } from '../src/types.js';
import type { RelayClient } from '../src/relay-client.js';

function makeMockRelay(): { relay: RelayClient; calls: AvatarEvent[] } {
  const calls: AvatarEvent[] = [];
  const relay: RelayClient = {
    push: (signal: AvatarSignal, current?: AvatarEvent) => {
      // Simulate what relay-client does: merge signal onto current
      const ev: AvatarEvent = {
        emotion:   signal.emotion   ?? current?.emotion   ?? 'idle',
        action:    signal.action    ?? current?.action    ?? 'waiting',
        prop:      signal.prop      ?? current?.prop      ?? 'none',
        intensity: signal.intensity ?? current?.intensity ?? 'medium',
      };
      calls.push({ ...ev });
    },
  };
  return { relay, calls };
}

const fastCfg = {
  ...DEFAULT_CONFIG,
  debounceMs: 50,
  idleTimeoutMs: 100,
};

describe('AvatarStateMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a signal immediately when outside debounce window', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });

    expect(calls).toHaveLength(1);
    expect(calls[0].emotion).toBe('focused');
    expect(calls[0].action).toBe('coding');
  });

  it('debounces rapid lower-priority transitions', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    // First transition — emits immediately (outside debounce window)
    sm.transition({ emotion: 'focused', action: 'coding' });
    expect(calls).toHaveLength(1);

    // Second transition immediately after — within debounce window
    sm.transition({ emotion: 'thinking', action: 'reading' }); // priority 1 < focused 2
    // Should NOT emit yet — lower priority, deferred
    expect(calls).toHaveLength(1);

    // Fast-forward past debounce window
    vi.advanceTimersByTime(fastCfg.debounceMs + 10);
    // Now the deferred transition should have fired
    expect(calls).toHaveLength(2);
    expect(calls[1].emotion).toBe('thinking');
  });

  it('higher-priority signal preempts lower-priority pending', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });
    expect(calls).toHaveLength(1);

    // Within debounce: lower priority pending
    sm.transition({ emotion: 'thinking', action: 'reading' });
    expect(calls).toHaveLength(1);

    // Still within debounce: higher priority (confused = 4 > focused = 2)
    sm.transition({ emotion: 'confused', action: 'error' });
    // Should emit immediately — higher priority than current
    expect(calls).toHaveLength(2);
    expect(calls[1].emotion).toBe('confused');
  });

  it('does not emit duplicate events', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });
    vi.advanceTimersByTime(fastCfg.debounceMs + 10);
    sm.transition({ emotion: 'focused', action: 'coding' }); // same state
    vi.advanceTimersByTime(fastCfg.debounceMs + 10);

    // Only 1 emit, not 2
    expect(calls).toHaveLength(1);
  });

  it('scheduleIdle fires after idleTimeoutMs', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' });
    expect(calls).toHaveLength(1);

    sm.scheduleIdle();
    vi.advanceTimersByTime(fastCfg.idleTimeoutMs - 10);
    expect(calls).toHaveLength(1); // not yet

    vi.advanceTimersByTime(20);
    expect(calls).toHaveLength(2);
    expect(calls[1].emotion).toBe('idle');
  });

  it('reset cancels idle timer and emits idle immediately', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' });
    sm.scheduleIdle();

    sm.reset();
    // Should emit idle immediately (state was not idle)
    expect(calls).toHaveLength(2);
    expect(calls[1].emotion).toBe('idle');

    // Timer should be cleared — no additional emit after timeout
    vi.advanceTimersByTime(fastCfg.idleTimeoutMs + 100);
    expect(calls).toHaveLength(2);
  });

  it('getCurrent reflects the latest emitted state', () => {
    const { relay } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    expect(sm.getCurrent().emotion).toBe('idle');

    sm.transition({ emotion: 'focused', action: 'coding' });
    expect(sm.getCurrent().emotion).toBe('focused');
  });

  it('merges partial signals onto current state', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding', prop: 'keyboard', intensity: 'high' });
    vi.advanceTimersByTime(fastCfg.debounceMs + 10);

    // Partial update — only change emotion
    sm.transition({ emotion: 'satisfied' });
    expect(calls[calls.length - 1].emotion).toBe('satisfied');
    expect(calls[calls.length - 1].action).toBe('coding');    // unchanged
    expect(calls[calls.length - 1].prop).toBe('keyboard');    // unchanged
    expect(calls[calls.length - 1].intensity).toBe('high');   // unchanged
  });
});
