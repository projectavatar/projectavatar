/**
 * Relay client — HTTP POST to the relay server.
 *
 * Fire-and-forget. See module header for design rationale.
 * v2: EmotionBlend format — emotions dict + optional color override.
 */

import type { AvatarEvent, AvatarSignal, SessionMeta, PluginConfig } from './types.js';
import { PRIMARY_EMOTIONS, WORD_INTENSITIES, ACTIONS, PROPS, INTENSITIES, IDLE_EVENT } from './types.js';

export type { SessionMeta } from './types.js';

const PRIMARY_SET     = new Set<string>(PRIMARY_EMOTIONS);
const WORD_INT_SET    = new Set<string>(WORD_INTENSITIES);
const ACTION_SET      = new Set<string>(ACTIONS);
const PROP_SET        = new Set<string>(PROPS);
const INTENSITY_SET   = new Set<string>(INTENSITIES);

function isValidEvent(event: AvatarEvent): boolean {
  // Validate emotions dict
  if (typeof event.emotions !== 'object' || event.emotions === null) return false;
  for (const [key, value] of Object.entries(event.emotions)) {
    if (!PRIMARY_SET.has(key)) return false;
    if (typeof value !== 'string' || !WORD_INT_SET.has(value)) return false;
  }
  if (!ACTION_SET.has(event.action)) return false;
  if (event.prop !== undefined && !PROP_SET.has(event.prop)) return false;
  if (event.intensity !== undefined && !INTENSITY_SET.has(event.intensity)) return false;
  if (event.color !== undefined && typeof event.color !== 'string') return false;
  return true;
}

export type RelayClient = {
  push: (signal: AvatarSignal, current?: AvatarEvent, session?: SessionMeta) => void;
};

export function createRelayClient(cfg: PluginConfig, token: string): RelayClient {
  const baseUrl = cfg.relayUrl.replace(/\/+$/, '');
  const pushUrl = `${baseUrl}/push/${encodeURIComponent(token)}`;

  function push(
    signal:  AvatarSignal,
    current: AvatarEvent  = IDLE_EVENT,
    session?: SessionMeta,
  ): void {
    const event: AvatarEvent = {
      emotions:  signal.emotions  ?? { ...current.emotions },
      action:    signal.action    ?? current.action,
      prop:      signal.prop      ?? current.prop,
      intensity: signal.intensity ?? current.intensity,
      color:     signal.color     ?? current.color,
    };

    if (!isValidEvent(event)) {
      return;
    }

    if (session !== undefined) {
      event.sessionId = session.sessionId;
      event.priority  = session.priority;
    }

    void (async () => {
      try {
        await fetch(pushUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(event),
          signal:  AbortSignal.timeout(5_000),
        });
      } catch {
        // Non-critical. Avatar is cosmetic.
      }
    })();
  }

  return { push };
}
