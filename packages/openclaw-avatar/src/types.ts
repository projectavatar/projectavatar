/**
 * Shared types for the OpenClaw plugin.
 * Mirrors the AvatarEvent schema from @project-avatar/shared without
 * importing it directly — the plugin must be standalone with no runtime
 * deps on other workspace packages (it ships to npm independently).
 *
 * SOURCE OF TRUTH: packages/shared/src/schema.ts
 * If the schema changes there, update the arrays here to match.
 */

// ── Primary emotions ────────────────────────────────────────────────────────
export const PRIMARY_EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'disgust', 'interest'] as const;
export type PrimaryEmotion = typeof PRIMARY_EMOTIONS[number];

// ── Word intensities ────────────────────────────────────────────────────────
export const WORD_INTENSITIES = ['subtle', 'low', 'medium', 'high'] as const;
export type WordIntensity = typeof WORD_INTENSITIES[number];

/** Emotion blend — partial map of primary emotions to word intensities. */
export type EmotionBlend = Partial<Record<PrimaryEmotion, WordIntensity>>;

// ── Actions ─────────────────────────────────────────────────────────────────
export const ACTIONS = ['idle', 'talking', 'typing', 'nodding', 'laughing', 'celebrating', 'dismissive', 'searching', 'nervous', 'sad', 'plotting', 'greeting'] as const;
export type Action = typeof ACTIONS[number];

// ── Props ───────────────────────────────────────────────────────────────────
export const PROPS = ['none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll'] as const;
export type Prop = typeof PROPS[number];

// ── Intensities ─────────────────────────────────────────────────────────────
export const INTENSITIES = ['low', 'medium', 'high'] as const;
export type Intensity = typeof INTENSITIES[number];

/**
 * One-shot actions — these play once and should not be interrupted quickly.
 * They get a longer cooldown to prevent rapid cancellation.
 */
export const ONE_SHOT_ACTIONS: ReadonlySet<string> = new Set([
  'celebrating', 'greeting', 'laughing', 'dismissive',
]);

export interface AvatarEvent {
  emotions:   EmotionBlend;
  action:     Action;
  prop?:      Prop;
  intensity?: Intensity;
  color?:     string;
  /** Opaque session identifier for relay multi-session arbitration. */
  sessionId?: string;
  /** Session priority (lower = higher). Defaults to 0 in relay when absent. */
  priority?:  number;
}

/** A partial update — only the display fields. sessionId/priority are relay concerns. */
export type AvatarSignal = Partial<Pick<AvatarEvent, 'emotions' | 'action' | 'prop' | 'intensity' | 'color'>>;

/**
 * Session metadata attached to each relay push.
 */
export interface SessionMeta {
  sessionId: string;
  priority: number;
}

export const DEFAULT_APP_URL = 'https://app.projectavatar.io';

export interface PluginConfig {
  relayUrl:           string;
  appUrl:             string;
  enabled:            boolean;
  idleTimeoutMs:      number;
  emotionCooldownMs:  number;
  actionCooldownMs:   number;
  oneShotCooldownMs:  number;
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
  emotions:  {},
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
 * Runtime config validation.
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
