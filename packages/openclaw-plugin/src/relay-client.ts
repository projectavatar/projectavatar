/**
 * Relay client — HTTP POST to the relay server.
 *
 * The plugin runs server-side inside the OpenClaw gateway. No persistent
 * WebSocket connection is needed — each avatar event is a single fire-and-forget
 * HTTP POST. Simpler, cheaper, and no lifecycle to manage.
 *
 * Critical: this must NEVER throw or block. Avatar events are cosmetic.
 * If the relay is down, the agent continues unaffected.
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

export type RelayClient = {
  push: (signal: AvatarSignal, current?: AvatarEvent) => void;
};

export function createRelayClient(cfg: PluginConfig, token: string): RelayClient {
  // Trailing slash is stripped during config validation, but guard here too
  // in case createRelayClient is called directly in tests with a raw URL.
  const baseUrl = cfg.relayUrl.replace(/\/+$/, '');
  const pushUrl = `${baseUrl}/push/${encodeURIComponent(token)}`;

  function push(signal: AvatarSignal, current: AvatarEvent = IDLE_EVENT): void {
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

    // Fire and forget — don't await, don't catch outside
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
        // Non-critical. Avatar is cosmetic — never surface this to the user.
      }
    })();
  }

  return { push };
}
