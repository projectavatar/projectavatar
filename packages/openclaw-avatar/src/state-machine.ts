/**
 * Avatar state machine (plugin-internal).
 *
 * Responsibilities:
 *  1. Merge partial signals onto current avatar state
 *  2. Debounce rapid transitions so we don't flood the relay during
 *     bursts of tool calls (e.g. 5 file reads in 200ms)
 *  3. Respect emotion priority — a high-priority signal (like "confused/error")
 *     won't get overridden by a lower-priority one within the debounce window
 *  4. Schedule idle timeout after the last event
 *  5. Pass session metadata to the relay for multi-session arbitration
 */

import type { AvatarEvent, AvatarSignal, SessionMeta, PluginConfig } from './types.js';
import { IDLE_EVENT } from './types.js';
import type { RelayClient } from './relay-client.js';

/** Higher number = higher priority. Errors and excitement beat idle/focused. */
const EMOTION_PRIORITY: Record<string, number> = {
  idle:      0,
  thinking:  1,
  focused:   2,
  satisfied: 2,
  excited:   3,
  confused:  4,
  concerned: 5,
};

function priority(emotion: string): number {
  return EMOTION_PRIORITY[emotion] ?? 1;
}

function eventsEqual(a: AvatarEvent, b: AvatarEvent): boolean {
  return (
    a.emotion === b.emotion &&
    a.action === b.action &&
    a.prop === b.prop &&
    a.intensity === b.intensity
  );
}

export type AvatarStateMachine = {
  /**
   * Merge a partial signal into current state and (debounced) push to relay.
   * @param signal   The state delta to apply
   * @param session  Optional session metadata for relay arbitration.
   *                 If omitted, the relay treats the push as a legacy push.
   */
  transition: (signal: AvatarSignal, session?: SessionMeta) => void;
  /**
   * Schedule a return to idle after idleTimeoutMs. Call after agent_end.
   * @param session  The session that triggered agent_end — captured in the timer
   *                 closure so the idle push is correctly attributed for arbitration.
   *                 Without this, a session's idle timer could bypass arbitration
   *                 and override an active lower-priority session.
   */
  scheduleIdle: (session?: SessionMeta) => void;
  /**
   * Immediately reset to idle and cancel all pending timers. Call on session_end.
   * @param session  Optional session metadata so the relay can attribute the idle push.
   */
  reset: (session?: SessionMeta) => void;
  /** Get a snapshot of current state. */
  getCurrent: () => AvatarEvent;
};

export function createAvatarStateMachine(
  cfg: PluginConfig,
  relay: RelayClient,
): AvatarStateMachine {
  let current: AvatarEvent = { ...IDLE_EVENT };
  let lastEmitTime = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last session seen from any hook — used as fallback when transition() is called without session (e.g. avatar_signal tool). */
  let lastSession: SessionMeta | undefined = undefined;

  function clearPending() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function clearIdle() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function emit(event: AvatarEvent, session?: SessionMeta) {
    current = { ...event };
    lastEmitTime = Date.now();
    relay.push(event, event, session);
  }

  function transition(signal: AvatarSignal, session?: SessionMeta): void {
    // Track the most recent session so avatar_signal (which has no hook context)
    // can inherit it. Only update when a real session is provided.
    if (session !== undefined) lastSession = session;
    const effectiveSession = session ?? lastSession;

    clearIdle();

    // Build the candidate next state
    const next: AvatarEvent = {
      emotion:   signal.emotion   ?? current.emotion,
      action:    signal.action    ?? current.action,
      prop:      signal.prop      ?? current.prop,
      intensity: signal.intensity ?? current.intensity,
    };

    // No-op if nothing changed
    if (eventsEqual(next, current)) return;

    const elapsed = Date.now() - lastEmitTime;
    // Clamp to avoid negative setTimeout (which Node treats as 0 but defeats debounce intent)
    const remaining = Math.max(0, cfg.debounceMs - elapsed);
    const inDebounce = elapsed < cfg.debounceMs;

    if (!inDebounce) {
      // Outside debounce window — emit immediately
      clearPending();
      emit(next, effectiveSession);
      return;
    }

    // Inside debounce window — check priority
    const curPri  = priority(current.emotion);
    const nextPri = priority(next.emotion);

    if (nextPri < curPri) {
      // Lower priority than current — defer until debounce window closes.
      // Capture the signal (not next) and re-merge against current state at
      // fire time. This avoids emitting a stale snapshot if state has changed
      // multiple times since the timer was scheduled.
      clearPending();
      const deferredSignal  = { ...signal };
      const deferredSession = effectiveSession;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        const deferred: AvatarEvent = {
          emotion:   deferredSignal.emotion   ?? current.emotion,
          action:    deferredSignal.action    ?? current.action,
          prop:      deferredSignal.prop      ?? current.prop,
          intensity: deferredSignal.intensity ?? current.intensity,
        };
        // Only emit if it would actually change the state
        if (!eventsEqual(current, deferred)) emit(deferred, deferredSession);
      }, remaining);
      return;
    }

    // Higher or equal priority — emit immediately, cancel any pending lower-priority
    clearPending();
    emit(next, effectiveSession);
  }

  function scheduleIdle(session?: SessionMeta): void {
    clearIdle();
    // Capture the session in the closure so the idle push is attributed to the
    // correct session. Without this, the timer fires without sessionId/priority,
    // bypasses relay arbitration, and can override an active lower-priority session.
    const idleSession = session;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!eventsEqual(current, IDLE_EVENT)) {
        emit({ ...IDLE_EVENT }, idleSession);
      }
    }, cfg.idleTimeoutMs);
  }

  function reset(session?: SessionMeta): void {
    clearPending();
    clearIdle();
    // Set current and clear lastEmitTime BEFORE emit so any downstream readers
    // (e.g. relay push handlers) see the correct post-reset state immediately.
    const wasIdle = eventsEqual(current, IDLE_EVENT);
    current = { ...IDLE_EVENT };
    lastEmitTime = 0;
    if (!wasIdle) {
      relay.push(IDLE_EVENT, IDLE_EVENT, session);
    }
  }

  function getCurrent(): AvatarEvent {
    return { ...current };
  }

  return { transition, scheduleIdle, reset, getCurrent };
}
