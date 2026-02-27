/**
 * Relay client — HTTP POST to the relay server.
 *
 * The plugin runs server-side inside the OpenClaw gateway. No persistent
 * WebSocket connection is needed — each avatar event is a single fire-and-forget
 * HTTP POST. Simpler, cheaper, and no lifecycle to manage.
 *
 * Failure strategy: FIRE AND FORGET.
 * If the relay is down, pushes are silently dropped. The avatar freezes in its
 * last known state until the relay recovers and the next event arrives. This is
 * intentional — avatar state is cosmetic and must never impact agent performance.
 * There is no retry queue, no backpressure, no circuit breaker. If you need
 * guaranteed delivery, you need a different architecture.
 *
 * Statelessness: This client holds NO persistent state — no keep-alive agent,
 * no connection pool, no retry timers. Each push() call is fully self-contained.
 * No cleanup or teardown is required on session end.
 *
 * Critical: this must NEVER throw or block.
 */

import type { AvatarEvent, AvatarSignal, PluginConfig } from './types.js';
import { EMOTIONS, ACTIONS, PROPS, INTENSITIES, IDLE_EVENT } from './types.js';

// Derived from the canonical arrays — never duplicated.
const EMOTION_SET   = new Set<string>(EMOTIONS);
const ACTION_SET    = new Set<string>(ACTIONS);
const PROP_SET      = new Set<string>(PROPS);
const INTENSITY_SET = new Set<string>(INTENSITIES);

function isValidEvent(event: AvatarEvent): boolean {
  return (
    EMOTION_SET.has(event.emotion) &&
    ACTION_SET.has(event.action) &&
    PROP_SET.has(event.prop) &&
    INTENSITY_SET.has(event.intensity)
  );
}

/**
 * Session metadata attached to each push.
 * Derived from the OpenClaw hook context (sessionKey) and used by the relay
 * for multi-session arbitration.
 */
export interface SessionMeta {
  /**
   * Stable identifier for this session, derived from the OpenClaw sessionKey.
   * Passed as-is to the relay — opaque from the relay's perspective.
   */
  sessionId: string;
  /**
   * Priority for relay arbitration. Lower = higher priority.
   * 0 = main/interactive session, 1 = sub-agent, 2+ = background tasks.
   */
  priority: number;
}

export type RelayClient = {
  /**
   * Push an avatar signal to the relay. Fire-and-forget: never throws, never blocks.
   * Invalid events are silently dropped. Network failures are silently swallowed.
   *
   * @param signal  The state delta to apply (merged with current to form a full event)
   * @param current The last known full event (used as base for partial signal merging)
   * @param session Optional session metadata for multi-session arbitration.
   *                If omitted, the relay treats the push as a legacy single-session push.
   */
  push: (signal: AvatarSignal, current?: AvatarEvent, session?: SessionMeta) => void;
};

export function createRelayClient(cfg: PluginConfig, token: string): RelayClient {
  // Trailing slash is stripped during config validation, but guard here too
  // in case createRelayClient is called directly in tests with a raw URL.
  const baseUrl = cfg.relayUrl.replace(/\/+$/, '');
  const pushUrl = `${baseUrl}/push/${encodeURIComponent(token)}`;

  function push(
    signal:  AvatarSignal,
    current: AvatarEvent  = IDLE_EVENT,
    session?: SessionMeta,
  ): void {
    // Merge signal onto current state to get a complete event
    const event: AvatarEvent = {
      emotion:   signal.emotion   ?? current.emotion,
      action:    signal.action    ?? current.action,
      prop:      signal.prop      ?? current.prop,
      intensity: signal.intensity ?? current.intensity,
    };

    if (!isValidEvent(event)) {
      return; // Silently drop invalid events — state machine should never produce these
    }

    // Attach session metadata if provided — enables relay arbitration
    if (session !== undefined) {
      event.sessionId = session.sessionId;
      event.priority  = session.priority;
    }

    // Fire and forget — see failure strategy in module header
    void (async () => {
      try {
        await fetch(pushUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(event),
          // AbortSignal.timeout is Node 17.3+; safe for OpenClaw's Node 18+ requirement
          signal:  AbortSignal.timeout(5_000),
        });
      } catch {
        // Non-critical. Avatar is cosmetic — never surface relay errors to the user.
      }
    })();
  }

  return { push };
}
