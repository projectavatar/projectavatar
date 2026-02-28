/**
 * Tool → Avatar signal mapping table.
 *
 * DESIGN PRINCIPLE: Less is more.
 *
 * The agent's own `avatar_signal` tool calls are the PRIMARY source of truth
 * for avatar state. This map only covers HIGH-SIGNAL tools — actions that
 * represent meaningful state transitions. Routine tools (Read, Write, Edit,
 * web_search, etc.) are intentionally absent to prevent visual jitter.
 *
 * Unknown tools return null (no fallback signal).
 */

import type { AvatarSignal } from './types.js';

type ToolRule = {
  before: AvatarSignal;
  after?: AvatarSignal;
  afterError?: AvatarSignal;
};

export const TOOL_SIGNAL_MAP: Record<string, ToolRule> = {
  // ── Shell — high-signal, agent is running something important ────────────
  // No after (success): agent's avatar_signal before the reply provides the beat.
  exec: {
    before:     { emotion: 'thinking', action: 'typing', prop: 'keyboard', intensity: 'high' },
    afterError: { emotion: 'confused', action: 'nervous', intensity: 'high' },
  },

  // ── Browser — agent is actively navigating ───────────────────────────────
  // No after (success): same rationale as exec — agent signals intent in its reply.
  browser: {
    before:     { emotion: 'thinking', action: 'searching', prop: 'magnifying_glass' },
    afterError: { emotion: 'confused', action: 'dismissive' },
  },

  // ── TTS — agent is speaking ──────────────────────────────────────────────
  tts: {
    before:     { emotion: 'excited', action: 'talking' },
    after:      { emotion: 'happy',   action: 'greeting' },
  },

  // ── Sub-agents — noteworthy orchestration ────────────────────────────────
  sessions_spawn: {
    before:     { emotion: 'excited', action: 'typing', prop: 'keyboard' },
    after:      { emotion: 'happy',   action: 'celebrating' },
  },

  // ── Gateway — system-level action ────────────────────────────────────────
  gateway: {
    before:     { emotion: 'thinking', action: 'typing', prop: 'keyboard', intensity: 'high' },
    after:      { emotion: 'happy',    action: 'celebrating' },
    afterError: { emotion: 'confused', action: 'nervous', intensity: 'high' },
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
