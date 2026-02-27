/**
 * Shared types for the OpenClaw plugin.
 * Mirrors the AvatarEvent schema from @project-avatar/shared without
 * importing it directly — the plugin must be standalone with no runtime
 * deps on other workspace packages (it ships to npm independently).
 */

// ── Canonical value arrays — single source of truth ─────────────────────────
// Derive union types AND runtime validation sets from these.
// Never duplicate these values elsewhere.

export const EMOTIONS = ['idle', 'thinking', 'focused', 'excited', 'confused', 'satisfied', 'concerned'] as const;
export const ACTIONS  = ['responding', 'searching', 'coding', 'reading', 'waiting', 'error', 'celebrating'] as const;
export const PROPS    = ['none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll'] as const;
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

/** Runtime config validation — returns a list of error strings, empty = valid. */
export function validatePluginConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['pluginConfig must be an object'];
  const cfg = raw as Record<string, unknown>;

  if ('relayUrl' in cfg && typeof cfg.relayUrl !== 'string') errors.push('relayUrl must be a string');
  if ('enabled' in cfg && typeof cfg.enabled !== 'boolean') errors.push('enabled must be a boolean');
  if ('idleTimeoutMs' in cfg && (typeof cfg.idleTimeoutMs !== 'number' || cfg.idleTimeoutMs < 5000))
    errors.push('idleTimeoutMs must be a number >= 5000');
  if ('debounceMs' in cfg && (typeof cfg.debounceMs !== 'number' || cfg.debounceMs < 50))
    errors.push('debounceMs must be a number >= 50');
  if ('enableAvatarTool' in cfg && typeof cfg.enableAvatarTool !== 'boolean')
    errors.push('enableAvatarTool must be a boolean');
  if ('suppressSkillTags' in cfg && typeof cfg.suppressSkillTags !== 'boolean')
    errors.push('suppressSkillTags must be a boolean');

  return errors;
}
