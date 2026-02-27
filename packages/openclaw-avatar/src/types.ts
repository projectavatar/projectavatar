/**
 * Shared types for the OpenClaw plugin.
 * Mirrors the AvatarEvent schema from @project-avatar/shared without
 * importing it directly — the plugin must be standalone with no runtime
 * deps on other workspace packages (it ships to npm independently).
 */

// ── Canonical value arrays — single source of truth ─────────────────────────
// Derive union types AND runtime validation sets from these.
// Never duplicate these values elsewhere.

export const EMOTIONS    = ['idle', 'thinking', 'focused', 'excited', 'confused', 'satisfied', 'concerned', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'bashful', 'nervous'] as const;
export const ACTIONS     = ['idle', 'talking', 'typing', 'nodding', 'waving', 'greeting', 'laughing', 'pointing', 'fist_pump', 'dismissive', 'plotting', 'sarcastic', 'looking_around', 'shading_eyes', 'telling_secret', 'victory', 'head_shake', 'relief', 'cautious_agree', 'angry_fist', 'rallying', 'sad_idle', 'nervous_look', 'terrified', 'scratching_head', 'cocky', 'questioning', 'phone', 'celebrating'] as const;
export const PROPS       = ['none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll'] as const;
export const INTENSITIES = ['low', 'medium', 'high'] as const;

export type Emotion   = typeof EMOTIONS[number];
export type Action    = typeof ACTIONS[number];
export type Prop      = typeof PROPS[number];
export type Intensity = typeof INTENSITIES[number];

export interface AvatarEvent {
  emotion:   Emotion;
  action:    Action;
  prop:      Prop;
  intensity: Intensity;
  /**
   * Opaque session identifier. Included in every push so the relay can
   * perform multi-session arbitration. Derived from the OpenClaw sessionKey.
   */
  sessionId?: string;
  /**
   * Session priority for relay arbitration. Lower = higher priority.
   * 0 = main/interactive session, 1 = sub-agent, 2+ = background tasks.
   * When absent, the relay defaults to 0 (highest priority) — but this default
   * lives in the relay's handlePush, not here. The schema validates the shape only.
   */
  priority?: number;
}

/** A partial update — only the display fields. sessionId/priority are relay concerns. */
export type AvatarSignal = Partial<Pick<AvatarEvent, 'emotion' | 'action' | 'prop' | 'intensity'>>;

/**
 * Session metadata attached to each relay push.
 * Enables the relay to perform multi-session arbitration — suppressing lower-priority
 * sessions while a higher-priority session is active.
 *
 * Defined here (types.ts) rather than relay-client.ts because it is used by
 * relay-client, state-machine, and index — and types.ts is the canonical home
 * for shared plugin types.
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
   * Derived from the number of ':subagent:' segments in the sessionKey.
   */
  priority: number;
}

/**
 * Default app URL for share link generation.
 * Override via `appUrl` config if self-hosting the web app at a custom domain.
 */
export const DEFAULT_APP_URL = 'https://app.projectavatar.io';

export interface PluginConfig {
  relayUrl:         string;
  /** Base URL for the avatar web app. Used for share link generation.
   *  Only needed if self-hosting at a custom domain.
   *  Default: https://app.projectavatar.io */
  appUrl:           string;
  enabled:          boolean;
  idleTimeoutMs:    number;
  debounceMs:       number;
}

export const DEFAULT_CONFIG: PluginConfig = {
  relayUrl:         'https://relay.projectavatar.io',
  appUrl:           DEFAULT_APP_URL,
  enabled:          true,
  idleTimeoutMs:    5_000,
  debounceMs:       300,
};

export const IDLE_EVENT: AvatarEvent = {
  emotion:   'idle',
  action:    'idle',
  prop:      'none',
  intensity: 'medium',
};

/** Response from GET /channel/:token/state */
export interface ChannelStateResponse {
  model: string | null;
  lastAgentEventAt: number | null;
  connectedClients: number;
}

/**
 * Runtime config validation.
 * Returns a list of error strings (empty = valid), AND a sanitized config object
 * with invalid fields stripped back to their defaults.
 *
 * Always use the returned `sanitized` config — never spread the raw input directly,
 * since invalid values would silently override validated defaults.
 */
export function validatePluginConfig(
  raw: unknown,
): { errors: string[]; sanitized: Partial<PluginConfig> } {
  const errors: string[] = [];
  const sanitized: Partial<PluginConfig> = {};

  if (typeof raw !== 'object' || raw === null) {
    return { errors: ['pluginConfig must be an object'], sanitized: {} };
  }
  const cfg = raw as Record<string, unknown>;

  if ('relayUrl' in cfg) {
    if (typeof cfg.relayUrl !== 'string') {
      errors.push('relayUrl must be a string');
    } else {
      try {
        new URL(cfg.relayUrl);
        sanitized.relayUrl = cfg.relayUrl.replace(/\/+$/, '');
      } catch {
        errors.push(`relayUrl must be a valid URL (got: ${cfg.relayUrl})`);
      }
    }
  }

  if ('appUrl' in cfg) {
    if (typeof cfg.appUrl !== 'string') {
      errors.push('appUrl must be a string');
    } else {
      try {
        new URL(cfg.appUrl);
        sanitized.appUrl = cfg.appUrl.replace(/\/+$/, '');
      } catch {
        errors.push(`appUrl must be a valid URL (got: ${cfg.appUrl})`);
      }
    }
  }

  if ('enabled' in cfg) {
    if (typeof cfg.enabled !== 'boolean') errors.push('enabled must be a boolean');
    else sanitized.enabled = cfg.enabled;
  }

  if ('idleTimeoutMs' in cfg) {
    if (typeof cfg.idleTimeoutMs !== 'number' || cfg.idleTimeoutMs < 5000)
      errors.push('idleTimeoutMs must be a number >= 5000');
    else sanitized.idleTimeoutMs = cfg.idleTimeoutMs;
  }

  if ('debounceMs' in cfg) {
    if (typeof cfg.debounceMs !== 'number' || cfg.debounceMs < 50)
      errors.push('debounceMs must be a number >= 50');
    else sanitized.debounceMs = cfg.debounceMs;
  }


  return { errors, sanitized };
}
