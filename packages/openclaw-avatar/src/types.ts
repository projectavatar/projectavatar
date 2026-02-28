/**
 * Shared types for the OpenClaw plugin.
 * Mirrors the AvatarEvent schema from @project-avatar/shared without
 * importing it directly — the plugin must be standalone with no runtime
 * deps on other workspace packages (it ships to npm independently).
 *
 * SOURCE OF TRUTH: packages/shared/src/schema.ts
 * If the schema changes there, update the arrays here to match.
 */

// ── Canonical value arrays — single source of truth ─────────────────────────
// Derive union types AND runtime validation sets from these.
// Never duplicate these values elsewhere.

export const EMOTIONS    = ['idle', 'thinking', 'excited', 'confused', 'happy', 'angry', 'sad', 'surprised', 'bashful', 'nervous'] as const;
export const ACTIONS     = ['idle', 'talking', 'typing', 'nodding', 'laughing', 'celebrating', 'dismissive', 'searching', 'nervous', 'sad', 'plotting', 'greeting'] as const;
export const PROPS       = ['none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll'] as const;
export const INTENSITIES = ['low', 'medium', 'high'] as const;

export type Emotion   = typeof EMOTIONS[number];
export type Action    = typeof ACTIONS[number];
export type Prop      = typeof PROPS[number];
export type Intensity = typeof INTENSITIES[number];

/**
 * One-shot actions — these play once and should not be interrupted quickly.
 * They get a longer cooldown to prevent rapid cancellation.
 *
 * Note on chaining: if a deferred signal carries a one-shot action (e.g.
 * dismissive deferred during a celebrating hold), it will start its own
 * cooldown when it fires. Total hold can reach 2x oneShotCooldownMs.
 * This is by design — both dramatic actions should play out fully.
 */
export const ONE_SHOT_ACTIONS: ReadonlySet<string> = new Set([
  'celebrating', 'greeting', 'laughing', 'dismissive',
]);

export interface AvatarEvent {
  emotion:   Emotion;
  action:    Action;
  prop?:     Prop;
  intensity?: Intensity;
  /** Opaque session identifier for relay multi-session arbitration. */
  sessionId?: string;
  /** Session priority (lower = higher). Defaults to 0 in relay when absent. */
  priority?: number;
}

/** A partial update — only the display fields. sessionId/priority are relay concerns. */
export type AvatarSignal = Partial<Pick<AvatarEvent, 'emotion' | 'action' | 'prop' | 'intensity'>>;

/**
 * Session metadata attached to each relay push.
 * Enables the relay to perform multi-session arbitration — suppressing
 * lower-priority sessions while a higher-priority session is active.
 */
export interface SessionMeta {
  /** Opaque identifier derived from OpenClaw sessionKey. */
  sessionId: string;
  /**
   * Priority for relay arbitration. Lower = higher priority.
   * 0 = main/interactive, 1 = sub-agent, 2+ = background.
   */
  priority: number;
}

export const DEFAULT_APP_URL = 'https://app.projectavatar.io';

export interface PluginConfig {
  relayUrl:         string;
  appUrl:           string;
  enabled:          boolean;
  idleTimeoutMs:    number;
  emotionCooldownMs: number;
  actionCooldownMs:  number;
  oneShotCooldownMs: number;
}

export const DEFAULT_CONFIG: PluginConfig = {
  relayUrl:           'https://relay.projectavatar.io',
  appUrl:             DEFAULT_APP_URL,
  enabled:            true,
  idleTimeoutMs:      5_000,
  emotionCooldownMs:  2_000,
  actionCooldownMs:   1_500,
  oneShotCooldownMs:  3_000,
};

export const IDLE_EVENT: AvatarEvent = {
  emotion:   'idle',
  action:    'idle',
  prop:      'none',
  intensity: 'medium',
};

export interface ChannelStateResponse {
  model: string | null;
  lastAgentEventAt: number | null;
  connectedClients: number;
}

/**
 * Runtime config validation. Returns errors + sanitized config.
 * Invalid fields are stripped (fall back to DEFAULT_CONFIG when spread).
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

  if ('emotionCooldownMs' in cfg) {
    if (typeof cfg.emotionCooldownMs !== 'number' || cfg.emotionCooldownMs < 0)
      errors.push('emotionCooldownMs must be a number >= 0');
    else sanitized.emotionCooldownMs = cfg.emotionCooldownMs;
  }

  if ('actionCooldownMs' in cfg) {
    if (typeof cfg.actionCooldownMs !== 'number' || cfg.actionCooldownMs < 0)
      errors.push('actionCooldownMs must be a number >= 0');
    else sanitized.actionCooldownMs = cfg.actionCooldownMs;
  }

  if ('oneShotCooldownMs' in cfg) {
    if (typeof cfg.oneShotCooldownMs !== 'number' || cfg.oneShotCooldownMs < 0)
      errors.push('oneShotCooldownMs must be a number >= 0');
    else sanitized.oneShotCooldownMs = cfg.oneShotCooldownMs;
  }

  return { errors, sanitized };
}
