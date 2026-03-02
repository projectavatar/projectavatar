/**
 * Tool → Avatar signal mapping table.
 *
 * DESIGN PRINCIPLE: Less is more.
 *
 * The agent's own `avatar_signal` tool calls are the PRIMARY source of truth
 * for avatar state. This map only covers HIGH-SIGNAL tools.
 * Unknown tools return null (no fallback signal).
 *
 * v2: Uses EmotionBlend format instead of single emotion strings.
 */

import type { AvatarSignal } from './types.js';

type ToolRule = {
  before: AvatarSignal;
  after?: AvatarSignal;
  afterError?: AvatarSignal;
};

export const TOOL_SIGNAL_MAP: Record<string, ToolRule> = {
  exec: {
    before:     { emotions: { interest: 'high' }, action: 'typing', prop: 'keyboard', intensity: 'high' },
    afterError: { emotions: { fear: 'medium', surprise: 'low' }, action: 'nervous', intensity: 'high' },
  },

  browser: {
    before:     { emotions: { interest: 'high' }, action: 'searching', prop: 'magnifying_glass' },
    afterError: { emotions: { fear: 'medium', surprise: 'low' }, action: 'dismissive' },
  },

  tts: {
    before:     { emotions: { joy: 'medium' }, action: 'talking' },
    after:      { emotions: { joy: 'high' }, action: 'greeting' },
  },

  sessions_spawn: {
    before:     { emotions: { joy: 'medium', interest: 'low' }, action: 'typing', prop: 'keyboard' },
    after:      { emotions: { joy: 'high' }, action: 'celebrating' },
  },

  gateway: {
    before:     { emotions: { interest: 'high' }, action: 'typing', prop: 'keyboard', intensity: 'high' },
    after:      { emotions: { joy: 'high' }, action: 'celebrating' },
    afterError: { emotions: { fear: 'medium', surprise: 'low' }, action: 'nervous', intensity: 'high' },
  },
};

/**
 * Resolve a tool signal. Returns null for unknown/unmapped tools.
 */
export function resolveToolSignal(
  toolName: string,
  phase: 'before' | 'after',
  error?: string,
): AvatarSignal | null {
  const rule = TOOL_SIGNAL_MAP[toolName];
  if (!rule) return null;

  if (phase === 'before') return rule.before;
  if (error && rule.afterError) return rule.afterError;
  return rule.after ?? null;
}
