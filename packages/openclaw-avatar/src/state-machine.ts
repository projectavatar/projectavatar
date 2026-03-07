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
 *  4. Schedule idle timeout after the last event
 *  5. Pass session metadata to the relay for multi-session arbitration
 *
 * v2: Emotion blend format — emotions is a dict of primary emotions → word
 * intensities instead of a single string. Color override support added.
 */

import type { AvatarEvent, AvatarSignal, EmotionBlend, SessionMeta, PluginConfig } from './types.js';
import { IDLE_EVENT, ONE_SHOT_ACTIONS } from './types.js';
import type { RelayClient } from './relay-client.js';

function emotionsEqual(a: EmotionBlend, b: EmotionBlend): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}

function eventsEqual(a: AvatarEvent, b: AvatarEvent): boolean {
  return (
    emotionsEqual(a.emotions, b.emotions) &&
    a.action === b.action &&
    a.prop === b.prop &&
    a.intensity === b.intensity &&
    (a.color ?? undefined) === (b.color ?? undefined) &&
    (a.talking ?? false) === (b.talking ?? false)
  );
}

export type AvatarStateMachine = {
  transition: (signal: AvatarSignal, session?: SessionMeta) => void;
  scheduleIdle: (session?: SessionMeta) => void;
  reset: (session?: SessionMeta) => void;
  getCurrent: () => AvatarEvent;
};

export function createAvatarStateMachine(
  cfg: PluginConfig,
  relay: RelayClient,
): AvatarStateMachine {
  const IDLE_WITH_TALKING: AvatarEvent = { ...IDLE_EVENT, emotions: {}, talking: false };
  let current: AvatarEvent = { ...IDLE_EVENT, emotions: { ...IDLE_EVENT.emotions }, talking: false };
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSession: SessionMeta | undefined = undefined;

  // ── Per-category cooldown tracking ──────────────────────────────────────

  let lastEmotionChangeTime = 0;
  let lastActionChangeTime  = 0;

  /** When a one-shot action is active, this is the timestamp it was emitted. */
  let oneShotActiveTime = 0;

  /** Pending coalesced signal. */
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
    if (!emotionsEqual(event.emotions, current.emotions)) lastEmotionChangeTime = now;
    if (event.action !== current.action) lastActionChangeTime = now;
    if (ONE_SHOT_ACTIONS.has(event.action) && event.action !== current.action) {
      oneShotActiveTime = now;
    }
    current = { ...event, emotions: { ...event.emotions } };
    relay.push(event, event, session);
  }

  function applyCooldowns(signal: AvatarSignal, now: number): {
    allowed: AvatarSignal;
    blocked: AvatarSignal;
    retryAfterMs: number;
  } {
    const allowed: AvatarSignal = {};
    const blocked: AvatarSignal = {};
    let retryAfterMs = 0;

    // ── Emotion blend cooldown ──────────────────────────────────────────
    if (signal.emotions !== undefined && !emotionsEqual(signal.emotions, current.emotions)) {
      const emotionElapsed = now - lastEmotionChangeTime;

      if (emotionElapsed >= cfg.emotionCooldownMs) {
        allowed.emotions = signal.emotions;
      } else {
        blocked.emotions = signal.emotions;
        retryAfterMs = Math.max(retryAfterMs, cfg.emotionCooldownMs - emotionElapsed);
      }
    } else if (signal.emotions !== undefined) {
      allowed.emotions = signal.emotions;
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

    // ── No cooldown for these ───────────────────────────────────────────
    if (signal.prop !== undefined)       allowed.prop = signal.prop;
    if (signal.intensity !== undefined)  allowed.intensity = signal.intensity;
    if (signal.color !== undefined)      allowed.color = signal.color;
    if (signal.talking !== undefined)    allowed.talking = signal.talking;

    return { allowed, blocked, retryAfterMs };
  }

  function schedulePendingFlush(retryAfterMs: number, session?: SessionMeta) {
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
      emotions:  allowed.emotions  ?? { ...current.emotions },
      action:    allowed.action    ?? current.action,
      prop:      allowed.prop      ?? current.prop,
      intensity: allowed.intensity ?? current.intensity,
      color:     allowed.color     ?? current.color,
      talking:   allowed.talking   ?? current.talking,
    };

    if (retryAfterMs > 0) {
      if (pendingSignal === null) pendingSignal = {};
      if (blocked.emotions !== undefined) pendingSignal.emotions = blocked.emotions;
      if (blocked.action !== undefined)   pendingSignal.action  = blocked.action;
      if (signal.prop !== undefined)        pendingSignal.prop = signal.prop;
      if (signal.intensity !== undefined)   pendingSignal.intensity = signal.intensity;
      if (signal.color !== undefined)       pendingSignal.color = signal.color;
      if (signal.talking !== undefined)     pendingSignal.talking = signal.talking;

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
      if (!eventsEqual(current, IDLE_WITH_TALKING)) {
        clearPending();
        oneShotActiveTime = 0;
        emit({ ...IDLE_WITH_TALKING, emotions: {} }, idleSession);
      }
    }, cfg.idleTimeoutMs);
  }

  function reset(session?: SessionMeta): void {
    clearPending();
    clearIdle();
    const wasIdle = eventsEqual(current, IDLE_EVENT);
    current = { ...IDLE_WITH_TALKING, emotions: {} };
    lastEmotionChangeTime = 0;
    lastActionChangeTime = 0;
    oneShotActiveTime = 0;
    if (!wasIdle) {
      relay.push(IDLE_WITH_TALKING, IDLE_WITH_TALKING, session);
    }
  }

  function getCurrent(): AvatarEvent {
    return { ...current, emotions: { ...current.emotions } };
  }

  return { transition, scheduleIdle, reset, getCurrent };
}
