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
    before:     { emotion: 'thinking',  action: 'searching',  prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'reading',    prop: 'book' },
    afterError: { emotion: 'confused',  action: 'error' },
  },
  web_fetch: {
    before:     { emotion: 'focused',   action: 'reading',    prop: 'book' },
    after:      { emotion: 'satisfied', action: 'reading' },
    afterError: { emotion: 'confused',  action: 'error' },
  },

  // ── File operations ──────────────────────────────────────────────────────────
  Read: {
    before:     { emotion: 'focused',   action: 'reading',    prop: 'book' },
    after:      { emotion: 'focused',   action: 'reading' },
  },
  Write: {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard' },
    after:      { emotion: 'satisfied', action: 'coding',     prop: 'keyboard' },
    afterError: { emotion: 'confused',  action: 'error' },
  },
  Edit: {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard' },
    after:      { emotion: 'satisfied', action: 'coding',     prop: 'keyboard' },
    afterError: { emotion: 'confused',  action: 'error' },
  },

  // ── Shell ────────────────────────────────────────────────────────────────────
  exec: {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard', intensity: 'high' },
    after:      { emotion: 'satisfied', action: 'coding' },
    afterError: { emotion: 'confused',  action: 'error',      intensity: 'high' },
  },
  process: {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard' },
    after:      { emotion: 'focused',   action: 'coding' },
  },

  // ── Browser ──────────────────────────────────────────────────────────────────
  browser: {
    before:     { emotion: 'focused',   action: 'searching',  prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'reading' },
    afterError: { emotion: 'confused',  action: 'error' },
  },
  canvas: {
    before:     { emotion: 'focused',   action: 'reading',    prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'reading' },
  },

  // ── Messaging / output ───────────────────────────────────────────────────────
  message: {
    before:     { emotion: 'focused',   action: 'responding', prop: 'phone' },
    after:      { emotion: 'satisfied', action: 'responding' },
  },
  tts: {
    before:     { emotion: 'excited',   action: 'responding' },
    after:      { emotion: 'satisfied', action: 'responding' },
  },

  // ── Vision / image ───────────────────────────────────────────────────────────
  image: {
    before:     { emotion: 'thinking',  action: 'reading',    prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'responding' },
  },

  // ── Memory ──────────────────────────────────────────────────────────────────
  memory_search: {
    before:     { emotion: 'thinking',  action: 'searching',  prop: 'book' },
    after:      { emotion: 'focused',   action: 'reading',    prop: 'book' },
  },
  memory_get: {
    before:     { emotion: 'focused',   action: 'reading',    prop: 'book' },
    after:      { emotion: 'focused',   action: 'reading' },
  },

  // ── Sub-agents / orchestration ───────────────────────────────────────────────
  subagents: {
    before:     { emotion: 'thinking',  action: 'waiting' },
    after:      { emotion: 'satisfied', action: 'responding' },
  },
  sessions_spawn: {
    before:     { emotion: 'excited',   action: 'coding',     prop: 'keyboard' },
    after:      { emotion: 'focused',   action: 'waiting' },
  },
  sessions_list: {
    before:     { emotion: 'thinking',  action: 'searching' },
  },
  sessions_send: {
    before:     { emotion: 'focused',   action: 'responding', prop: 'phone' },
    after:      { emotion: 'satisfied', action: 'responding' },
  },
  sessions_history: {
    before:     { emotion: 'focused',   action: 'reading',    prop: 'book' },
  },

  // ── Devices / nodes ──────────────────────────────────────────────────────────
  nodes: {
    before:     { emotion: 'focused',   action: 'searching',  prop: 'phone' },
    after:      { emotion: 'satisfied', action: 'responding' },
  },

  // ── Scheduling ───────────────────────────────────────────────────────────────
  cron: {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'scroll' },
    after:      { emotion: 'satisfied', action: 'responding' },
  },

  // ── Session / status ─────────────────────────────────────────────────────────
  session_status: {
    before:     { emotion: 'thinking',  action: 'reading' },
    after:      { emotion: 'focused',   action: 'reading' },
  },

  // ── Gateway ──────────────────────────────────────────────────────────────────
  gateway: {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard', intensity: 'high' },
    after:      { emotion: 'satisfied', action: 'responding' },
    afterError: { emotion: 'confused',  action: 'error',      intensity: 'high' },
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
