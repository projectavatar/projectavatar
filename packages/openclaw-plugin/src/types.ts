/**
 * Shared types for the OpenClaw plugin.
 * Mirrors the AvatarEvent schema from @project-avatar/shared without
 * importing it directly — the plugin must be standalone with no runtime
 * deps on other workspace packages (it ships to npm independently).
 */

// ── Canonical value arrays — single source of truth ─────────────────────────
// Derive union types AND runtime validation sets from these.
// Never duplicate these values elsewhere.

export const EMOTIONS    = ['idle', 'thinking', 'focused', 'excited', 'confused', 'satisfied', 'concerned'] as const;
export const ACTIONS     = ['responding', 'searching', 'coding', 'reading', 'waiting', 'error', 'celebrating'] as const;
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
}

/** A partial update — only the fields you want to change. */
export type AvatarSignal = Partial<AvatarEvent>;

export interface PluginConfig {
  relayUrl:          string;
  enabled:           boolean;
  idleTimeoutMs:     number;
  debounceMs:        number;
  enableAvatarTool:  boolean;
  suppressSkillTags: boolean;
}

export const DEFAULT_CONFIG: PluginConfig = {
  relayUrl:          'https://relay.projectavatar.io',
  enabled:           true,
  idleTimeoutMs:     30_000,
  debounceMs:        300,
  enableAvatarTool:  false,
  suppressSkillTags: true,
};

export const IDLE_EVENT: AvatarEvent = {
  emotion:   'idle',
  action:    'waiting',
  prop:      'none',
  intensity: 'medium',
};

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
      // Validate as a proper URL — a non-URL string produces silent fetch failures
      try {
        new URL(cfg.relayUrl);
        // Strip trailing slash to prevent double-slash in constructed paths
        sanitized.relayUrl = cfg.relayUrl.replace(/\/+$/, '');
      } catch {
        errors.push(`relayUrl must be a valid URL (got: ${cfg.relayUrl})`);
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

  if ('enableAvatarTool' in cfg) {
    if (typeof cfg.enableAvatarTool !== 'boolean') errors.push('enableAvatarTool must be a boolean');
    else sanitized.enableAvatarTool = cfg.enableAvatarTool;
  }

  if ('suppressSkillTags' in cfg) {
    if (typeof cfg.suppressSkillTags !== 'boolean') errors.push('suppressSkillTags must be a boolean');
    else sanitized.suppressSkillTags = cfg.suppressSkillTags;
  }

  return { errors, sanitized };
}
