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
import { IDLE_EVENT } from './types.js';

const EMOTIONS = new Set([
  'idle', 'thinking', 'focused', 'excited', 'confused', 'satisfied', 'concerned',
]);
const ACTIONS = new Set([
  'responding', 'searching', 'coding', 'reading', 'waiting', 'error', 'celebrating',
]);
const PROPS = new Set([
  'none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll',
]);
const INTENSITIES = new Set(['low', 'medium', 'high']);

function isValidEvent(event: AvatarEvent): boolean {
  return (
    EMOTIONS.has(event.emotion) &&
    ACTIONS.has(event.action) &&
    PROPS.has(event.prop) &&
    INTENSITIES.has(event.intensity)
  );
}

export type RelayClient = {
  push: (signal: AvatarSignal, current?: AvatarEvent) => void;
};

export function createRelayClient(cfg: PluginConfig, token: string): RelayClient {
  const pushUrl = `${cfg.relayUrl}/push/${encodeURIComponent(token)}`;

  function push(signal: AvatarSignal, current: AvatarEvent = IDLE_EVENT): void {
    // Merge signal onto current state to get a complete event
    const event: AvatarEvent = {
      emotion:   signal.emotion   ?? current.emotion,
      action:    signal.action    ?? current.action,
      prop:      signal.prop      ?? current.prop,
      intensity: signal.intensity ?? current.intensity,
    };

    if (!isValidEvent(event)) {
      return; // Silently drop invalid events
    }

    // Fire and forget — don't await, don't catch outside
    void (async () => {
      try {
        await fetch(pushUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          // AbortSignal.timeout is Node 17.3+; safe for OpenClaw's Node 18+ requirement
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Non-critical. Avatar is cosmetic — never surface this to the user.
      }
    })();
  }

  return { push };
}
