/**
 * Tool → Avatar signal mapping table.
 *
 * Maps OpenClaw tool names to avatar signals for before/after phases.
 * Unknown tools are silently ignored — no signal emitted.
 *
 * Rule of thumb for signal design:
 *  - before: what the agent is *about to do* (searching, reading, coding)
 *  - after (success): what happened (focused, satisfied)
 *  - after (error): what went wrong (confused/error)
 *
 * Props are optional and appear in the avatar's hand.
 * Intensity is optional; high reserved for intense actions (exec, errors).
 */

import type { AvatarSignal } from './types.js';

type ToolRule = {
  before: AvatarSignal;
  after?: AvatarSignal;
  afterError?: AvatarSignal;
};

export const TOOL_SIGNAL_MAP: Record<string, ToolRule> = {
  // ── Web / research ──────────────────────────────────────────────────────────
  web_search: {
    before:     { emotion: 'thinking',  action: 'searching',   prop: 'magnifying_glass' },
    after:      { emotion: 'thinking',   action: 'nodding',        prop: 'book' },
    afterError: { emotion: 'confused',  action: 'dismissive' },
  },
  web_fetch: {
    before:     { emotion: 'thinking',   action: 'searching', prop: 'book' },
    after:      { emotion: 'happy', action: 'nodding' },
    afterError: { emotion: 'confused',  action: 'dismissive' },
  },

  // ── File operations ──────────────────────────────────────────────────────────
  Read: {
    before:     { emotion: 'thinking',   action: 'searching', prop: 'book' },
    after:      { emotion: 'thinking',   action: 'nodding' },
  },
  Write: {
    before:     { emotion: 'thinking',   action: 'typing',         prop: 'keyboard' },
    after:      { emotion: 'happy', action: 'typing',         prop: 'keyboard' },
    afterError: { emotion: 'confused',  action: 'dismissive' },
  },
  Edit: {
    before:     { emotion: 'thinking',   action: 'typing',         prop: 'keyboard' },
    after:      { emotion: 'happy', action: 'typing',         prop: 'keyboard' },
    afterError: { emotion: 'confused',  action: 'dismissive' },
  },

  // ── Shell ────────────────────────────────────────────────────────────────────
  exec: {
    before:     { emotion: 'thinking',   action: 'typing',         prop: 'keyboard', intensity: 'high' },
    after:      { emotion: 'happy', action: 'nodding' },
    afterError: { emotion: 'confused',  action: 'nervous',      intensity: 'high' },
  },
  process: {
    before:     { emotion: 'thinking',   action: 'typing',         prop: 'keyboard' },
    after:      { emotion: 'thinking',   action: 'nodding' },
  },

  // ── Browser ──────────────────────────────────────────────────────────────────
  browser: {
    before:     { emotion: 'thinking',   action: 'searching',   prop: 'magnifying_glass' },
    after:      { emotion: 'thinking',   action: 'nodding' },
    afterError: { emotion: 'confused',  action: 'dismissive' },
  },
  canvas: {
    before:     { emotion: 'thinking',   action: 'searching', prop: 'magnifying_glass' },
    after:      { emotion: 'thinking',   action: 'nodding' },
  },

  // ── Messaging / output ───────────────────────────────────────────────────────
  message: {
    before:     { emotion: 'thinking',   action: 'talking',        prop: 'phone' },
    after:      { emotion: 'happy', action: 'nodding' },
  },
  tts: {
    before:     { emotion: 'excited',   action: 'talking' },
    after:      { emotion: 'happy', action: 'greeting' },
  },

  // ── Vision / image ───────────────────────────────────────────────────────────
  image: {
    before:     { emotion: 'thinking',  action: 'searching',   prop: 'magnifying_glass' },
    after:      { emotion: 'thinking',   action: 'nodding' },
  },

  // ── Memory ──────────────────────────────────────────────────────────────────
  memory_search: {
    before:     { emotion: 'thinking',  action: 'searching', prop: 'book' },
    after:      { emotion: 'thinking',   action: 'nodding',        prop: 'book' },
  },
  memory_get: {
    before:     { emotion: 'thinking',   action: 'searching', prop: 'book' },
    after:      { emotion: 'thinking',   action: 'nodding' },
  },

  // ── Sub-agents / orchestration ───────────────────────────────────────────────
  subagents: {
    before:     { emotion: 'thinking',  action: 'idle' },
    after:      { emotion: 'happy', action: 'nodding' },
  },
  sessions_spawn: {
    before:     { emotion: 'excited',   action: 'typing',         prop: 'keyboard' },
    after:      { emotion: 'happy',   action: 'celebrating' },
  },
  sessions_list: {
    before:     { emotion: 'thinking',  action: 'searching' },
  },
  sessions_send: {
    before:     { emotion: 'thinking',   action: 'talking',        prop: 'phone' },
    after:      { emotion: 'happy', action: 'nodding' },
  },
  sessions_history: {
    before:     { emotion: 'thinking',   action: 'searching', prop: 'book' },
  },

  // ── Devices / nodes ──────────────────────────────────────────────────────────
  nodes: {
    before:     { emotion: 'thinking',   action: 'talking',          prop: 'phone' },
    after:      { emotion: 'happy', action: 'nodding' },
  },

  // ── Scheduling ───────────────────────────────────────────────────────────────
  cron: {
    before:     { emotion: 'thinking',   action: 'typing',         prop: 'scroll' },
    after:      { emotion: 'happy', action: 'nodding' },
  },

  // ── Session / status ─────────────────────────────────────────────────────────
  session_status: {
    before:     { emotion: 'thinking',  action: 'searching' },
    after:      { emotion: 'thinking',   action: 'nodding' },
  },

  // ── Gateway ──────────────────────────────────────────────────────────────────
  gateway: {
    before:     { emotion: 'thinking',   action: 'typing',         prop: 'keyboard', intensity: 'high' },
    after:      { emotion: 'happy', action: 'celebrating' },
    afterError: { emotion: 'confused',  action: 'nervous',      intensity: 'high' },
  },
};

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
