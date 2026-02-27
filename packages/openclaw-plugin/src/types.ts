/**
 * Shared types for the OpenClaw plugin.
 * Mirrors the AvatarEvent schema from @project-avatar/shared without
 * importing it directly — the plugin must be standalone with no runtime
 * deps on other workspace packages (it ships to npm independently).
 */

export type Emotion =
  | 'idle'
  | 'thinking'
  | 'focused'
  | 'excited'
  | 'confused'
  | 'satisfied'
  | 'concerned';

export type Action =
  | 'responding'
  | 'searching'
  | 'coding'
  | 'reading'
  | 'waiting'
  | 'error'
  | 'celebrating';

export type Prop =
  | 'none'
  | 'keyboard'
  | 'magnifying_glass'
  | 'coffee_cup'
  | 'book'
  | 'phone'
  | 'scroll';

export type Intensity = 'low' | 'medium' | 'high';

export interface AvatarEvent {
  emotion: Emotion;
  action: Action;
  prop: Prop;
  intensity: Intensity;
}

/** A partial update — only the fields you want to change. */
export type AvatarSignal = Partial<AvatarEvent>;

export interface PluginConfig {
  relayUrl: string;
  enabled: boolean;
  idleTimeoutMs: number;
  debounceMs: number;
  enableAvatarTool: boolean;
  suppressSkillTags: boolean;
}

export const DEFAULT_CONFIG: PluginConfig = {
  relayUrl: 'https://relay.projectavatar.io',
  enabled: true,
  idleTimeoutMs: 30_000,
  debounceMs: 300,
  enableAvatarTool: false,
  suppressSkillTags: true,
};

export const IDLE_EVENT: AvatarEvent = {
  emotion: 'idle',
  action: 'waiting',
  prop: 'none',
  intensity: 'medium',
};
