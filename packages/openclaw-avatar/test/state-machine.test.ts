/**
 * State machine tests.
 *
 * Tests cover: per-category cooldowns, one-shot action protection,
 * emotion priority bypass, idle timeout, session metadata threading,
 * and deferred signal coalescing.
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
        action:    signal.action    ?? current?.action    ?? 'idle',
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
  emotionCooldownMs: 200,
  actionCooldownMs: 150,
  oneShotCooldownMs: 300,
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

  // ── Basic transitions ───────────────────────────────────────────────────

  it('emits a signal immediately when state changes', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });

    expect(events(calls)).toHaveLength(1);
    expect(calls[0].event.emotion).toBe('happy');
    expect(calls[0].event.action).toBe('typing');
  });

  it('does not emit duplicate events', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });
    sm.transition({ emotion: 'happy', action: 'typing' }); // same state

    expect(events(calls)).toHaveLength(1);
  });

  it('merges partial signals onto current state', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing', prop: 'keyboard', intensity: 'high' });
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);

    sm.transition({ emotion: 'excited' });
    expect(calls[calls.length - 1].event.emotion).toBe('excited');
    expect(calls[calls.length - 1].event.action).toBe('typing');
    expect(calls[calls.length - 1].event.prop).toBe('keyboard');
    expect(calls[calls.length - 1].event.intensity).toBe('high');
  });

  // ── Emotion cooldown ──────────────────────────────────────────────────────

  it('blocks emotion changes within emotion cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });
    expect(events(calls)).toHaveLength(1);

    // Within emotion cooldown — emotion change blocked, action change allowed
    sm.transition({ emotion: 'thinking' });
    // Emotion was blocked, but since action didn't change either, no emit
    expect(events(calls)).toHaveLength(1);

    // After emotion cooldown expires, deferred signal fires
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.emotion).toBe('thinking');
  });

  it('allows emotion changes after cooldown expires', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);

    sm.transition({ emotion: 'thinking' });
    expect(calls[calls.length - 1].event.emotion).toBe('thinking');
  });

  // ── Action cooldown ───────────────────────────────────────────────────────

  it('blocks action changes within action cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'thinking', action: 'typing' });
    expect(events(calls)).toHaveLength(1);

    // Within action cooldown — action change blocked
    sm.transition({ action: 'nodding' });
    expect(events(calls)).toHaveLength(1);

    // After action cooldown, deferred signal fires
    vi.advanceTimersByTime(fastCfg.actionCooldownMs + 10);
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.action).toBe('nodding');
  });

  it('allows action changes after cooldown expires', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'thinking', action: 'typing' });
    vi.advanceTimersByTime(fastCfg.actionCooldownMs + 10);

    sm.transition({ action: 'nodding' });
    expect(calls[calls.length - 1].event.action).toBe('nodding');
  });

  // ── Independent axes ──────────────────────────────────────────────────────

  it('emotion and action cooldowns are independent', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });
    expect(events(calls)).toHaveLength(1);

    // After action cooldown but before emotion cooldown
    vi.advanceTimersByTime(fastCfg.actionCooldownMs + 10); // 160ms — action ok, emotion not yet (200ms)

    // Action change allowed, emotion change blocked
    sm.transition({ emotion: 'sad', action: 'nodding' });
    const last = calls[calls.length - 1].event;
    expect(last.action).toBe('nodding'); // action cooldown expired
    expect(last.emotion).toBe('happy');  // emotion still in cooldown (deferred)

    // After emotion cooldown, the deferred emotion fires
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs);
    const final = calls[calls.length - 1].event;
    expect(final.emotion).toBe('sad');
  });

  // ── Emotion priority bypass ───────────────────────────────────────────────

  it('high-priority emotions bypass cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });
    expect(events(calls)).toHaveLength(1);

    // Confused (priority 4) bypasses emotion cooldown
    sm.transition({ emotion: 'confused' });
    expect(calls[calls.length - 1].event.emotion).toBe('confused');
  });

  it('nervous bypasses emotion cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });
    sm.transition({ emotion: 'nervous' });
    expect(calls[calls.length - 1].event.emotion).toBe('nervous');
  });

  it('angry bypasses emotion cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });
    sm.transition({ emotion: 'angry' });
    expect(calls[calls.length - 1].event.emotion).toBe('angry');
  });

  it('surprised bypasses emotion cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });
    sm.transition({ emotion: 'surprised' });
    expect(calls[calls.length - 1].event.emotion).toBe('surprised');
  });

  it('low-priority emotions do NOT bypass cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });

    // thinking (priority 1) does NOT bypass
    sm.transition({ emotion: 'thinking' });
    expect(calls[calls.length - 1].event.emotion).toBe('happy');
  });

  // ── One-shot action protection ──────────────────────────────────────────

  it('blocks action changes during one-shot cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'celebrating' });
    expect(events(calls)).toHaveLength(1);

    // Action change within one-shot cooldown — blocked
    sm.transition({ action: 'typing' });
    expect(calls[calls.length - 1].event.action).toBe('celebrating');
  });

  it('allows action changes after one-shot cooldown expires', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'celebrating' });
    vi.advanceTimersByTime(fastCfg.oneShotCooldownMs + 10);

    sm.transition({ action: 'typing' });
    expect(calls[calls.length - 1].event.action).toBe('typing');
  });

  it('one-shot protection applies to greeting', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'greeting' });
    sm.transition({ action: 'typing' });
    expect(calls[calls.length - 1].event.action).toBe('greeting');
  });

  it('one-shot protection applies to laughing', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'laughing' });
    sm.transition({ action: 'typing' });
    expect(calls[calls.length - 1].event.action).toBe('laughing');
  });

  it('one-shot protection applies to dismissive', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'nervous', action: 'dismissive' });
    sm.transition({ action: 'typing' });
    expect(calls[calls.length - 1].event.action).toBe('dismissive');
  });

  it('emotion changes still work during one-shot action cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'celebrating' });
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);

    // Emotion change is independent of action cooldown
    sm.transition({ emotion: 'confused' }); // high-priority, bypasses cooldown
    expect(calls[calls.length - 1].event.emotion).toBe('confused');
    expect(calls[calls.length - 1].event.action).toBe('celebrating'); // action still protected
  });

  // ── Deferred signal coalescing ────────────────────────────────────────────

  it('deferred signals coalesce — last write wins', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });

    // Multiple rapid emotion changes within cooldown
    sm.transition({ emotion: 'thinking' });
    sm.transition({ emotion: 'excited' });
    sm.transition({ emotion: 'sad' });

    // Only the last one should fire when cooldown expires
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);
    expect(calls[calls.length - 1].event.emotion).toBe('sad');
  });

  // ── Idle timeout ──────────────────────────────────────────────────────────

  it('scheduleIdle fires after idleTimeoutMs', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'excited', action: 'celebrating' });
    expect(events(calls)).toHaveLength(1);

    sm.scheduleIdle();
    vi.advanceTimersByTime(fastCfg.idleTimeoutMs - 10);
    // Should not have idled yet — only initial transition
    const preIdle = calls.filter(c => c.event.emotion === 'idle');
    expect(preIdle).toHaveLength(0);

    vi.advanceTimersByTime(20);
    const postIdle = calls.filter(c => c.event.emotion === 'idle');
    expect(postIdle).toHaveLength(1);
  });

  it('scheduleIdle bypasses cooldowns and one-shot protection', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'celebrating' });
    sm.scheduleIdle();

    // Idle timer fires while one-shot celebrating is still protected
    vi.advanceTimersByTime(fastCfg.idleTimeoutMs + 10);
    expect(calls[calls.length - 1].event.emotion).toBe('idle');
    expect(calls[calls.length - 1].event.action).toBe('idle');
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

  // ── Reset ─────────────────────────────────────────────────────────────────

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

  it('reset clears all cooldown state', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'celebrating' });
    sm.reset();

    // After reset, should be able to transition immediately without cooldowns
    sm.transition({ emotion: 'excited', action: 'typing' });
    expect(calls[calls.length - 1].event.emotion).toBe('excited');
    expect(calls[calls.length - 1].event.action).toBe('typing');
  });

  it('reset sets current to idle before pushing to relay', () => {
    const calls: RelayCall[] = [];
    let currentAtPushTime: AvatarEvent | undefined;

    const relay: RelayClient = {
      push: (signal: AvatarSignal, current?: AvatarEvent, session?: SessionMeta) => {
        currentAtPushTime = sm.getCurrent();
        const ev: AvatarEvent = {
          emotion:   signal.emotion   ?? current?.emotion   ?? 'idle',
          action:    signal.action    ?? current?.action    ?? 'idle',
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

    sm.transition({ emotion: 'happy', action: 'typing' });
    sm.transition({ emotion: 'thinking' }); // deferred (emotion cooldown)

    sm.reset();
    expect(calls[calls.length - 1].event.emotion).toBe('idle');

    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 50);
    // Deferred thinking should NOT fire after reset
    expect(calls.filter(c => c.event.emotion === 'thinking')).toHaveLength(0);
  });

  // ── getCurrent ────────────────────────────────────────────────────────────

  it('getCurrent reflects the latest emitted state', () => {
    const { relay } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    expect(sm.getCurrent().emotion).toBe('idle');

    sm.transition({ emotion: 'happy', action: 'typing' });
    expect(sm.getCurrent().emotion).toBe('happy');
  });

  // ── Session metadata threading ─────────────────────────────────────────────

  it('passes session metadata through to the relay', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' }, mainSession);

    expect(calls).toHaveLength(1);
    expect(calls[0].session).toEqual(mainSession);
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
    expect(idleCall?.session).toEqual(mainSession);
  });

  it('transition without session passes undefined to relay', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' }); // no session

    expect(calls).toHaveLength(1);
    expect(calls[0].session).toBeUndefined();
  });

  // ── lastSession fallback ──────────────────────────────────────────────────

  it('transition without session inherits lastSession from a previous session-aware call', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    // First call WITH session — sets lastSession
    sm.transition({ emotion: 'thinking', action: 'looking_around' }, mainSession);
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);

    // Second call WITHOUT session — should inherit mainSession
    sm.transition({ emotion: 'happy', action: 'greeting' });

    const lastCall = calls[calls.length - 1];
    expect(lastCall.event.emotion).toBe('happy');
    expect(lastCall.session).toEqual(mainSession);
  });

  it('transition without session passes undefined when no prior session exists', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotion: 'happy', action: 'typing' });

    expect(calls).toHaveLength(1);
    expect(calls[0].session).toBeUndefined();
  });
});
