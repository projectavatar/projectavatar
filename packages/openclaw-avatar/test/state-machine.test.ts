/**
 * State machine tests.
 *
 * These tests focus on the debouncing, priority, and idle-timeout logic
 * without making any HTTP calls — the relay client is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAvatarStateMachine } from '../src/state-machine.js';
import type { AvatarEvent, AvatarSignal, SessionMeta } from '../src/types.js';
import { IDLE_EVENT, DEFAULT_CONFIG } from '../src/types.js';
import type { RelayClient } from '../src/relay-client.js';

interface RelayCall {
  event: AvatarEvent;
  session: SessionMeta | undefined;
}

function makeMockRelay(): { relay: RelayClient; calls: RelayCall[] } {
  const calls: RelayCall[] = [];
  const relay: RelayClient = {
    push: (signal: AvatarSignal, current?: AvatarEvent, session?: SessionMeta) => {
      const ev: AvatarEvent = {
        emotion:   signal.emotion   ?? current?.emotion   ?? 'idle',
        action:    signal.action    ?? current?.action    ?? 'waiting',
        prop:      signal.prop      ?? current?.prop      ?? 'none',
        intensity: signal.intensity ?? current?.intensity ?? 'medium',
      };
      calls.push({ event: { ...ev }, session });
    },
  };
  return { relay, calls };
}

/** Convenience: extract just the events for assertions that don't care about session. */
function events(calls: RelayCall[]): AvatarEvent[] {
  return calls.map(c => c.event);
}

const fastCfg = {
  ...DEFAULT_CONFIG,
  debounceMs: 50,
  idleTimeoutMs: 100,
};

const mainSession:     SessionMeta = { sessionId: 'agent:main:discord:channel-1', priority: 0 };
const subAgentSession: SessionMeta = { sessionId: 'agent:main:subagent:abc123',   priority: 1 };

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

    expect(events(calls)).toHaveLength(1);
    expect(calls[0].event.emotion).toBe('focused');
    expect(calls[0].event.action).toBe('coding');
  });

  it('debounces rapid lower-priority transitions', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });
    expect(events(calls)).toHaveLength(1);

    // thinking (priority 1) < focused (priority 2) — deferred
    sm.transition({ emotion: 'thinking', action: 'reading' });
    expect(events(calls)).toHaveLength(1);

    vi.advanceTimersByTime(fastCfg.debounceMs + 10);
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.emotion).toBe('thinking');
  });

  it('higher-priority signal preempts lower-priority pending', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });
    expect(events(calls)).toHaveLength(1);

    sm.transition({ emotion: 'thinking', action: 'reading' });
    expect(events(calls)).toHaveLength(1);

    // confused = 4 > focused = 2 — emits immediately
    sm.transition({ emotion: 'confused', action: 'error' });
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.emotion).toBe('confused');
  });

  it('higher-priority signal cancels the pending lower-priority timer', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });
    sm.transition({ emotion: 'thinking', action: 'reading' });
    expect(events(calls)).toHaveLength(1);

    sm.transition({ emotion: 'confused', action: 'error' });
    expect(events(calls)).toHaveLength(2);

    vi.advanceTimersByTime(fastCfg.debounceMs + 50);
    expect(events(calls)).toHaveLength(2); // still 2, old timer cancelled
  });

  it('deferred timer re-evaluates against current state at fire time', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });
    expect(events(calls)).toHaveLength(1);

    sm.transition({ emotion: 'thinking' }); // lower priority — deferred

    vi.advanceTimersByTime(fastCfg.debounceMs - 5);
    expect(events(calls)).toHaveLength(1);

    vi.advanceTimersByTime(10);
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.emotion).toBe('thinking');
    expect(calls[1].event.action).toBe('coding'); // carried from current
  });

  it('does not emit duplicate events', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });
    vi.advanceTimersByTime(fastCfg.debounceMs + 10);
    sm.transition({ emotion: 'focused', action: 'coding' }); // same state
    vi.advanceTimersByTime(fastCfg.debounceMs + 10);

    expect(events(calls)).toHaveLength(1);
  });

  it('scheduleIdle fires after idleTimeoutMs', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' });
    expect(events(calls)).toHaveLength(1);

    sm.scheduleIdle();
    vi.advanceTimersByTime(fastCfg.idleTimeoutMs - 10);
    expect(events(calls)).toHaveLength(1); // not yet

    vi.advanceTimersByTime(20);
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.emotion).toBe('idle');
  });

  it('scheduleIdle called twice only schedules one timer', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' });
    sm.scheduleIdle();
    sm.scheduleIdle(); // second call resets the timer

    vi.advanceTimersByTime(fastCfg.idleTimeoutMs + 10);
    expect(calls.filter(c => c.event.emotion === 'idle')).toHaveLength(1);
  });

  it('reset cancels idle timer and emits idle immediately', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' });
    sm.scheduleIdle();

    sm.reset();
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.emotion).toBe('idle');

    vi.advanceTimersByTime(fastCfg.idleTimeoutMs + 100);
    expect(events(calls)).toHaveLength(2);
  });

  it('reset sets current to idle before pushing to relay', () => {
    const calls: RelayCall[] = [];
    let currentAtPushTime: AvatarEvent | undefined;

    const relay: RelayClient = {
      push: (signal: AvatarSignal, current?: AvatarEvent, session?: SessionMeta) => {
        currentAtPushTime = sm.getCurrent();
        const ev: AvatarEvent = {
          emotion:   signal.emotion   ?? current?.emotion   ?? 'idle',
          action:    signal.action    ?? current?.action    ?? 'waiting',
          prop:      signal.prop      ?? current?.prop      ?? 'none',
          intensity: signal.intensity ?? current?.intensity ?? 'medium',
        };
        calls.push({ event: { ...ev }, session });
      },
    };
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' });
    sm.reset();

    expect(currentAtPushTime?.emotion).toBe('idle');
    expect(calls[calls.length - 1].event.emotion).toBe('idle');
  });

  it('reset cancels pending deferred timer', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' });
    sm.transition({ emotion: 'thinking', action: 'reading' }); // deferred

    sm.reset();
    expect(calls[calls.length - 1].event.emotion).toBe('idle');

    vi.advanceTimersByTime(fastCfg.debounceMs + 50);
    expect(calls.filter(c => c.event.emotion === 'thinking')).toHaveLength(0);
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

    sm.transition({ emotion: 'satisfied' });
    expect(calls[calls.length - 1].event.emotion).toBe('satisfied');
    expect(calls[calls.length - 1].event.action).toBe('coding');
    expect(calls[calls.length - 1].event.prop).toBe('keyboard');
    expect(calls[calls.length - 1].event.intensity).toBe('high');
  });

  // ── Session metadata threading ─────────────────────────────────────────────

  it('passes session metadata through to the relay', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' }, mainSession);

    expect(calls).toHaveLength(1);
    expect(calls[0].session).toEqual(mainSession);
  });

  it('passes session through deferred timer closure', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' }, mainSession);
    sm.transition({ emotion: 'thinking' }, subAgentSession); // lower priority — deferred

    vi.advanceTimersByTime(fastCfg.debounceMs + 10);

    // The deferred emit should carry the sub-agent session
    expect(calls).toHaveLength(2);
    expect(calls[1].session).toEqual(subAgentSession);
  });

  it('passes session through reset()', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' }, mainSession);
    sm.reset(mainSession);

    const idleCall = calls.find(c => c.event.emotion === 'idle');
    expect(idleCall?.session).toEqual(mainSession);
  });

  it('scheduleIdle captures and uses the provided session', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' }, mainSession);
    sm.scheduleIdle(mainSession);

    vi.advanceTimersByTime(fastCfg.idleTimeoutMs + 10);

    const idleCall = calls.find(c => c.event.emotion === 'idle');
    expect(idleCall).toBeDefined();
    // The idle push must carry the main session so the relay can apply arbitration
    expect(idleCall?.session).toEqual(mainSession);
  });

  it('transition without session passes undefined to relay', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'focused', action: 'coding' }); // no session

    expect(calls).toHaveLength(1);
    expect(calls[0].session).toBeUndefined();
  });
});
