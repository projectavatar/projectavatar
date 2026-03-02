/**
 * State machine tests — v2 (EmotionBlend format).
 *
 * Tests cover: per-category cooldowns, one-shot action protection,
 * idle timeout, session metadata threading, and deferred signal coalescing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAvatarStateMachine } from '../src/state-machine.js';
import type { AvatarEvent, AvatarSignal, EmotionBlend, SessionMeta } from '../src/types.js';
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
        emotions:  signal.emotions  ?? current?.emotions  ?? {},
        action:    signal.action    ?? current?.action    ?? 'idle',
        prop:      signal.prop      ?? current?.prop      ?? 'none',
        intensity: signal.intensity ?? current?.intensity ?? 'medium',
        color:     signal.color     ?? current?.color,
      };
      calls.push({ event: { ...ev }, session });
    },
  };
  return { relay, calls };
}

function events(calls: RelayCall[]): AvatarEvent[] {
  return calls.map(c => c.event);
}

function hasEmotions(event: AvatarEvent): boolean {
  return Object.keys(event.emotions).length > 0;
}

const JOY_HIGH: EmotionBlend = { joy: 'high' };
const INTEREST_HIGH: EmotionBlend = { interest: 'high' };
const SADNESS_MED: EmotionBlend = { sadness: 'medium' };
const FEAR_MED: EmotionBlend = { fear: 'medium' };

const fastCfg = {
  ...DEFAULT_CONFIG,
  idleTimeoutMs: 100,
  emotionCooldownMs: 200,
  actionCooldownMs: 150,
  oneShotCooldownMs: 300,
};

const mainSession: SessionMeta = { sessionId: 'agent:main:discord:channel-1', priority: 0 };

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

    sm.transition({ emotions: JOY_HIGH, action: 'typing' });

    expect(events(calls)).toHaveLength(1);
    expect(calls[0].event.emotions).toEqual(JOY_HIGH);
    expect(calls[0].event.action).toBe('typing');
  });

  it('does not emit duplicate events', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'typing' });
    sm.transition({ emotions: JOY_HIGH, action: 'typing' });

    expect(events(calls)).toHaveLength(1);
  });

  it('merges partial signals onto current state', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'typing', prop: 'keyboard', intensity: 'high' });
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);

    sm.transition({ emotions: INTEREST_HIGH });
    expect(calls[calls.length - 1].event.emotions).toEqual(INTEREST_HIGH);
    expect(calls[calls.length - 1].event.action).toBe('typing');
    expect(calls[calls.length - 1].event.prop).toBe('keyboard');
    expect(calls[calls.length - 1].event.intensity).toBe('high');
  });

  // ── Emotion blend cooldown ────────────────────────────────────────────────

  it('blocks emotion changes within emotion cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'typing' });
    expect(events(calls)).toHaveLength(1);

    sm.transition({ emotions: INTEREST_HIGH });
    expect(events(calls)).toHaveLength(1);

    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.emotions).toEqual(INTEREST_HIGH);
  });

  it('allows emotion changes after cooldown expires', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'typing' });
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);

    sm.transition({ emotions: SADNESS_MED });
    expect(calls[calls.length - 1].event.emotions).toEqual(SADNESS_MED);
  });

  // ── Action cooldown ───────────────────────────────────────────────────────

  it('blocks action changes within action cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: INTEREST_HIGH, action: 'typing' });
    expect(events(calls)).toHaveLength(1);

    sm.transition({ action: 'nodding' });
    expect(events(calls)).toHaveLength(1);

    vi.advanceTimersByTime(fastCfg.actionCooldownMs + 10);
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.action).toBe('nodding');
  });

  // ── One-shot action protection ──────────────────────────────────────────

  it('blocks action changes during one-shot cooldown', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'celebrating' });
    expect(events(calls)).toHaveLength(1);

    sm.transition({ action: 'typing' });
    expect(calls[calls.length - 1].event.action).toBe('celebrating');
  });

  it('allows action changes after one-shot cooldown expires', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'celebrating' });
    vi.advanceTimersByTime(fastCfg.oneShotCooldownMs + 10);

    sm.transition({ action: 'typing' });
    expect(calls[calls.length - 1].event.action).toBe('typing');
  });

  // ── Deferred signal coalescing ────────────────────────────────────────────

  it('deferred signals coalesce — last write wins', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'typing' });

    sm.transition({ emotions: INTEREST_HIGH });
    sm.transition({ emotions: FEAR_MED });
    sm.transition({ emotions: SADNESS_MED });

    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);
    expect(calls[calls.length - 1].event.emotions).toEqual(SADNESS_MED);
  });

  // ── Idle timeout ──────────────────────────────────────────────────────────

  it('scheduleIdle fires after idleTimeoutMs', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'celebrating' });
    sm.scheduleIdle();

    vi.advanceTimersByTime(fastCfg.idleTimeoutMs - 10);
    const preIdle = calls.filter(c => !hasEmotions(c.event) && c.event.action === 'idle');
    expect(preIdle).toHaveLength(0);

    vi.advanceTimersByTime(20);
    const postIdle = calls.filter(c => !hasEmotions(c.event) && c.event.action === 'idle');
    expect(postIdle).toHaveLength(1);
  });

  it('scheduleIdle bypasses cooldowns and one-shot protection', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'celebrating' });
    sm.scheduleIdle();

    vi.advanceTimersByTime(fastCfg.idleTimeoutMs + 10);
    const last = calls[calls.length - 1].event;
    expect(Object.keys(last.emotions)).toHaveLength(0);
    expect(last.action).toBe('idle');
  });

  // ── Reset ─────────────────────────────────────────────────────────────────

  it('reset cancels idle timer and emits idle immediately', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'celebrating' });
    sm.scheduleIdle();

    sm.reset();
    expect(events(calls)).toHaveLength(2);
    expect(calls[1].event.action).toBe('idle');

    vi.advanceTimersByTime(fastCfg.idleTimeoutMs + 100);
    expect(events(calls)).toHaveLength(2);
  });

  it('reset clears all cooldown state', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'celebrating' });
    sm.reset();

    sm.transition({ emotions: INTEREST_HIGH, action: 'typing' });
    expect(calls[calls.length - 1].event.emotions).toEqual(INTEREST_HIGH);
    expect(calls[calls.length - 1].event.action).toBe('typing');
  });

  it('reset cancels pending deferred timer', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'typing' });
    sm.transition({ emotions: INTEREST_HIGH }); // deferred

    sm.reset();
    expect(calls[calls.length - 1].event.action).toBe('idle');

    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 50);
    expect(calls.filter(c => c.event.emotions.interest === 'high')).toHaveLength(0);
  });

  // ── getCurrent ────────────────────────────────────────────────────────────

  it('getCurrent reflects the latest emitted state', () => {
    const { relay } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    expect(Object.keys(sm.getCurrent().emotions)).toHaveLength(0);

    sm.transition({ emotions: JOY_HIGH, action: 'typing' });
    expect(sm.getCurrent().emotions).toEqual(JOY_HIGH);
  });

  // ── Session metadata threading ─────────────────────────────────────────────

  it('passes session metadata through to the relay', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'typing' }, mainSession);
    expect(calls).toHaveLength(1);
    expect(calls[0].session).toEqual(mainSession);
  });

  it('passes session through reset()', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'celebrating' }, mainSession);
    sm.reset(mainSession);

    const idleCall = calls.find(c => c.event.action === 'idle');
    expect(idleCall?.session).toEqual(mainSession);
  });

  it('scheduleIdle captures and uses the provided session', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'celebrating' }, mainSession);
    sm.scheduleIdle(mainSession);

    vi.advanceTimersByTime(fastCfg.idleTimeoutMs + 10);

    const idleCall = calls.find(c => c.event.action === 'idle' && !hasEmotions(c.event));
    expect(idleCall).toBeDefined();
    expect(idleCall?.session).toEqual(mainSession);
  });

  it('transition without session inherits lastSession', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: INTEREST_HIGH, action: 'searching' }, mainSession);
    vi.advanceTimersByTime(fastCfg.emotionCooldownMs + 10);

    sm.transition({ emotions: JOY_HIGH, action: 'greeting' });

    const lastCall = calls[calls.length - 1];
    expect(lastCall.event.emotions).toEqual(JOY_HIGH);
    expect(lastCall.session).toEqual(mainSession);
  });

  // ── Color support ─────────────────────────────────────────────────────────

  it('passes color through to the relay', () => {
    const { relay, calls } = makeMockRelay();
    const sm = createAvatarStateMachine(fastCfg, relay);

    sm.transition({ emotions: JOY_HIGH, action: 'idle', color: 'hotpink' });
    expect(calls[calls.length - 1].event.color).toBe('hotpink');
  });
});
