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
 */

import type { AvatarEvent, AvatarSignal, PluginConfig } from './types.js';
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
  /** Merge a partial signal into current state and (debounced) push to relay. */
  transition: (signal: AvatarSignal) => void;
  /** Schedule a return to idle after idleTimeoutMs. Call after agent_end. */
  scheduleIdle: () => void;
  /** Immediately reset to idle and cancel all pending timers. Call on session_end. */
  reset: () => void;
  /** Get a snapshot of current state (for relay-client merge). */
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

  function emit(event: AvatarEvent) {
    current = { ...event };
    lastEmitTime = Date.now();
    relay.push(event, event); // pass both so relay-client just uses the event directly
  }

  function transition(signal: AvatarSignal): void {
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
    const inDebounce = elapsed < cfg.debounceMs;

    if (!inDebounce) {
      // Outside debounce window — emit immediately
      clearPending();
      emit(next);
      return;
    }

    // Inside debounce window — check priority
    const curPri  = priority(current.emotion);
    const nextPri = priority(next.emotion);

    if (nextPri < curPri) {
      // Lower priority than what's current — defer it
      // If there's already a pending lower-priority event, replace it
      clearPending();
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        // Re-check: if state has changed since we scheduled, skip
        if (!eventsEqual(current, next)) emit(next);
      }, cfg.debounceMs - elapsed);
      return;
    }

    // Higher or equal priority — emit immediately, cancel any pending lower-priority
    clearPending();
    emit(next);
  }

  function scheduleIdle(): void {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!eventsEqual(current, IDLE_EVENT)) {
        emit({ ...IDLE_EVENT });
      }
    }, cfg.idleTimeoutMs);
  }

  function reset(): void {
    clearPending();
    clearIdle();
    if (!eventsEqual(current, IDLE_EVENT)) {
      emit({ ...IDLE_EVENT });
    }
    current = { ...IDLE_EVENT };
    lastEmitTime = 0;
  }

  function getCurrent(): AvatarEvent {
    return { ...current };
  }

  return { transition, scheduleIdle, reset, getCurrent };
}
