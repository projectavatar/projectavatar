/**
 * Avatar state machine (plugin-internal).
 *
 * Responsibilities:
 *  1. Merge partial signals onto current avatar state
 *  2. Per-category cooldowns: emotion and action changes are rate-limited
 *     independently so one axis can update without the other fighting it
 *  3. One-shot action protection: celebrating/greeting/laughing/dismissive
 *     get a longer cooldown — once one fires, action changes are blocked
 *     until the cooldown expires
 *  4. Emotion priority: higher-priority emotions (confused, nervous, angry)
 *     bypass cooldowns to ensure errors/alerts always show
 *  5. Schedule idle timeout after the last event
 *  6. Pass session metadata to the relay for multi-session arbitration
 *
 * Design philosophy: the agent's avatar_signal tool calls are the PRIMARY
 * source of truth. Lifecycle hooks (tool calls, message_received) are
 * secondary — they only fire for high-signal tools. The state machine
 * ensures rapid signals from either source don't produce visual jitter.
 */

import type { AvatarEvent, AvatarSignal, SessionMeta, PluginConfig } from './types.js';
import { IDLE_EVENT, ONE_SHOT_ACTIONS } from './types.js';
import type { RelayClient } from './relay-client.js';

/** Higher number = higher priority. Errors and excitement beat idle/thinking. */
const EMOTION_PRIORITY: Record<string, number> = {
  idle:      0,
  thinking:  1,
  happy:     2,
  bashful:   2,
  excited:   3,
  sad:       3,
  confused:  4,
  surprised: 4,
  nervous:   5,
  angry:     5,
};

/** Emotions at or above this threshold bypass cooldowns entirely. */
const PRIORITY_BYPASS_THRESHOLD = 4; // confused, surprised, nervous, angry

function emotionPriority(emotion: string): number {
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
   * Merge a partial signal into current state and push to relay,
   * respecting per-category cooldowns and one-shot action protection.
   * Blocked fields are deferred and coalesced (last-write-wins).
   */
  transition: (signal: AvatarSignal, session?: SessionMeta) => void;
  /**
   * Schedule a return to idle after idleTimeoutMs. Bypasses all cooldowns.
   * Captures the session in the closure so the idle push is correctly attributed.
   */
  scheduleIdle: (session?: SessionMeta) => void;
  /**
   * Immediately reset to idle and cancel all pending timers/cooldowns.
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
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSession: SessionMeta | undefined = undefined;

  // ── Per-category cooldown tracking ──────────────────────────────────────

  let lastEmotionChangeTime = 0;
  let lastActionChangeTime  = 0;

  /** When a one-shot action is active, this is the timestamp it was emitted. */
  let oneShotActiveTime = 0;

  /** Pending coalesced signal — accumulated during cooldown, emitted when cooldown expires. */
  let pendingSignal: AvatarSignal | null = null;
  let pendingSession: SessionMeta | undefined = undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPending() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingSignal = null;
  }

  function clearIdle() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function emit(event: AvatarEvent, session?: SessionMeta) {
    const now = Date.now();
    if (event.emotion !== current.emotion) lastEmotionChangeTime = now;
    if (event.action !== current.action)   lastActionChangeTime = now;
    if (ONE_SHOT_ACTIONS.has(event.action) && event.action !== current.action) {
      oneShotActiveTime = now;
    }
    current = { ...event };
    relay.push(event, event, session);
  }

  /**
   * Apply cooldown filtering to a signal. Returns the filtered signal
   * (fields that are blocked by cooldown are removed) and the earliest
   * time at which the blocked fields could be retried.
   */
  function applyCooldowns(signal: AvatarSignal, now: number): {
    allowed: AvatarSignal;
    blocked: AvatarSignal;
    retryAfterMs: number;
  } {
    const allowed: AvatarSignal = {};
    const blocked: AvatarSignal = {};
    let retryAfterMs = 0;

    // ── Emotion cooldown ────────────────────────────────────────────────
    if (signal.emotion !== undefined && signal.emotion !== current.emotion) {
      const emotionElapsed = now - lastEmotionChangeTime;
      const pri = emotionPriority(signal.emotion);

      if (pri >= PRIORITY_BYPASS_THRESHOLD || emotionElapsed >= cfg.emotionCooldownMs) {
        allowed.emotion = signal.emotion;
      } else {
        blocked.emotion = signal.emotion;
        retryAfterMs = Math.max(retryAfterMs, cfg.emotionCooldownMs - emotionElapsed);
      }
    } else if (signal.emotion !== undefined) {
      allowed.emotion = signal.emotion;
    }

    // ── Action cooldown ─────────────────────────────────────────────────
    if (signal.action !== undefined && signal.action !== current.action) {
      const actionElapsed = now - lastActionChangeTime;
      const oneShotElapsed = now - oneShotActiveTime;

      if (oneShotActiveTime > 0 && oneShotElapsed < cfg.oneShotCooldownMs) {
        blocked.action = signal.action;
        retryAfterMs = Math.max(retryAfterMs, cfg.oneShotCooldownMs - oneShotElapsed);
      } else if (actionElapsed >= cfg.actionCooldownMs) {
        allowed.action = signal.action;
      } else {
        blocked.action = signal.action;
        retryAfterMs = Math.max(retryAfterMs, cfg.actionCooldownMs - actionElapsed);
      }
    } else if (signal.action !== undefined) {
      allowed.action = signal.action;
    }

    // ── Prop and intensity — no cooldown ─────────────────────────────────
    if (signal.prop !== undefined)       allowed.prop = signal.prop;
    if (signal.intensity !== undefined)  allowed.intensity = signal.intensity;

    return { allowed, blocked, retryAfterMs };
  }

  function schedulePendingFlush(retryAfterMs: number, session?: SessionMeta) {
    // Always update session — a newer signal may carry a different session context
    pendingSession = session;
    if (pendingTimer !== null) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (pendingSignal === null) return;

      const sig = { ...pendingSignal };
      const ses = pendingSession;
      pendingSignal = null;

      transition(sig, ses);
    }, retryAfterMs);
  }

  function transition(signal: AvatarSignal, session?: SessionMeta): void {
    if (session !== undefined) lastSession = session;
    const effectiveSession = session ?? lastSession;

    clearIdle();

    const now = Date.now();
    const { allowed, blocked, retryAfterMs } = applyCooldowns(signal, now);

    const next: AvatarEvent = {
      emotion:   allowed.emotion   ?? current.emotion,
      action:    allowed.action    ?? current.action,
      prop:      allowed.prop      ?? current.prop,
      intensity: allowed.intensity ?? current.intensity,
    };

    if (retryAfterMs > 0) {
      if (pendingSignal === null) pendingSignal = {};
      if (blocked.emotion !== undefined) pendingSignal.emotion = blocked.emotion;
      if (blocked.action !== undefined)  pendingSignal.action  = blocked.action;
      if (signal.prop !== undefined)       pendingSignal.prop = signal.prop;
      if (signal.intensity !== undefined)  pendingSignal.intensity = signal.intensity;

      schedulePendingFlush(retryAfterMs, effectiveSession);
    }

    if (!eventsEqual(next, current)) {
      emit(next, effectiveSession);
    }
  }

  function scheduleIdle(session?: SessionMeta): void {
    clearIdle();
    const idleSession = session;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!eventsEqual(current, IDLE_EVENT)) {
        clearPending();
        oneShotActiveTime = 0;
        emit({ ...IDLE_EVENT }, idleSession);
      }
    }, cfg.idleTimeoutMs);
  }

  function reset(session?: SessionMeta): void {
    clearPending();
    clearIdle();
    const wasIdle = eventsEqual(current, IDLE_EVENT);
    current = { ...IDLE_EVENT };
    lastEmotionChangeTime = 0;
    lastActionChangeTime = 0;
    oneShotActiveTime = 0;
    if (!wasIdle) {
      relay.push(IDLE_EVENT, IDLE_EVENT, session);
    }
  }

  function getCurrent(): AvatarEvent {
    return { ...current };
  }

  return { transition, scheduleIdle, reset, getCurrent };
}
