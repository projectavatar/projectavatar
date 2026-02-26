export const EMOTIONS = [
  'idle',
  'thinking',
  'focused',
  'excited',
  'confused',
  'satisfied',
  'concerned',
] as const;

export const ACTIONS = [
  'responding',
  'searching',
  'coding',
  'reading',
  'waiting',
  'error',
  'celebrating',
] as const;

export const PROPS = [
  'none',
  'keyboard',
  'magnifying_glass',
  'coffee_cup',
  'book',
  'phone',
  'scroll',
] as const;

export const INTENSITIES = ['low', 'medium', 'high'] as const;

export type Emotion = (typeof EMOTIONS)[number];
export type Action = (typeof ACTIONS)[number];
export type Prop = (typeof PROPS)[number];
export type Intensity = (typeof INTENSITIES)[number];

export interface AvatarEvent {
  emotion: Emotion;
  action: Action;
  prop?: Prop;
  intensity?: Intensity;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateAvatarEvent(event: unknown): ValidationResult {
  if (typeof event !== 'object' || event === null) {
    return { ok: false, error: 'Event must be an object' };
  }

  const e = event as Record<string, unknown>;

  if (!e.emotion || !EMOTIONS.includes(e.emotion as Emotion)) {
    return {
      ok: false,
      error: `Invalid emotion: ${e.emotion}. Must be one of: ${EMOTIONS.join(', ')}`,
    };
  }

  if (!e.action || !ACTIONS.includes(e.action as Action)) {
    return {
      ok: false,
      error: `Invalid action: ${e.action}. Must be one of: ${ACTIONS.join(', ')}`,
    };
  }

  if (e.prop !== undefined && !PROPS.includes(e.prop as Prop)) {
    return {
      ok: false,
      error: `Invalid prop: ${e.prop}. Must be one of: ${PROPS.join(', ')}`,
    };
  }

  if (e.intensity !== undefined && !INTENSITIES.includes(e.intensity as Intensity)) {
    return {
      ok: false,
      error: `Invalid intensity: ${e.intensity}. Must be one of: ${INTENSITIES.join(', ')}`,
    };
  }

  // Reject additional properties
  const allowedKeys = new Set(['emotion', 'action', 'prop', 'intensity']);
  for (const key of Object.keys(e)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: `Unknown field: ${key}` };
    }
  }

  return { ok: true };
}
