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
    before:     { emotion: 'thinking',  action: 'shading_eyes',   prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'nodding',        prop: 'book' },
    afterError: { emotion: 'confused',  action: 'head_shake' },
  },
  web_fetch: {
    before:     { emotion: 'focused',   action: 'looking_around', prop: 'book' },
    after:      { emotion: 'satisfied', action: 'nodding' },
    afterError: { emotion: 'confused',  action: 'head_shake' },
  },

  // ── File operations ──────────────────────────────────────────────────────────
  Read: {
    before:     { emotion: 'focused',   action: 'looking_around', prop: 'book' },
    after:      { emotion: 'focused',   action: 'nodding' },
  },
  Write: {
    before:     { emotion: 'focused',   action: 'typing',         prop: 'keyboard' },
    after:      { emotion: 'satisfied', action: 'typing',         prop: 'keyboard' },
    afterError: { emotion: 'confused',  action: 'head_shake' },
  },
  Edit: {
    before:     { emotion: 'focused',   action: 'typing',         prop: 'keyboard' },
    after:      { emotion: 'satisfied', action: 'typing',         prop: 'keyboard' },
    afterError: { emotion: 'confused',  action: 'head_shake' },
  },

  // ── Shell ────────────────────────────────────────────────────────────────────
  exec: {
    before:     { emotion: 'focused',   action: 'typing',         prop: 'keyboard', intensity: 'high' },
    after:      { emotion: 'satisfied', action: 'nodding' },
    afterError: { emotion: 'confused',  action: 'terrified',      intensity: 'high' },
  },
  process: {
    before:     { emotion: 'focused',   action: 'typing',         prop: 'keyboard' },
    after:      { emotion: 'focused',   action: 'nodding' },
  },

  // ── Browser ──────────────────────────────────────────────────────────────────
  browser: {
    before:     { emotion: 'focused',   action: 'shading_eyes',   prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'nodding' },
    afterError: { emotion: 'confused',  action: 'head_shake' },
  },
  canvas: {
    before:     { emotion: 'focused',   action: 'looking_around', prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'nodding' },
  },

  // ── Messaging / output ───────────────────────────────────────────────────────
  message: {
    before:     { emotion: 'focused',   action: 'talking',        prop: 'phone' },
    after:      { emotion: 'satisfied', action: 'nodding' },
  },
  tts: {
    before:     { emotion: 'excited',   action: 'talking' },
    after:      { emotion: 'satisfied', action: 'nodding' },
  },

  // ── Vision / image ───────────────────────────────────────────────────────────
  image: {
    before:     { emotion: 'thinking',  action: 'shading_eyes',   prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'nodding' },
  },

  // ── Memory ──────────────────────────────────────────────────────────────────
  memory_search: {
    before:     { emotion: 'thinking',  action: 'looking_around', prop: 'book' },
    after:      { emotion: 'focused',   action: 'nodding',        prop: 'book' },
  },
  memory_get: {
    before:     { emotion: 'focused',   action: 'looking_around', prop: 'book' },
    after:      { emotion: 'focused',   action: 'nodding' },
  },

  // ── Sub-agents / orchestration ───────────────────────────────────────────────
  subagents: {
    before:     { emotion: 'thinking',  action: 'idle' },
    after:      { emotion: 'satisfied', action: 'nodding' },
  },
  sessions_spawn: {
    before:     { emotion: 'excited',   action: 'typing',         prop: 'keyboard' },
    after:      { emotion: 'focused',   action: 'idle' },
  },
  sessions_list: {
    before:     { emotion: 'thinking',  action: 'looking_around' },
  },
  sessions_send: {
    before:     { emotion: 'focused',   action: 'talking',        prop: 'phone' },
    after:      { emotion: 'satisfied', action: 'nodding' },
  },
  sessions_history: {
    before:     { emotion: 'focused',   action: 'looking_around', prop: 'book' },
  },

  // ── Devices / nodes ──────────────────────────────────────────────────────────
  nodes: {
    before:     { emotion: 'focused',   action: 'phone',          prop: 'phone' },
    after:      { emotion: 'satisfied', action: 'nodding' },
  },

  // ── Scheduling ───────────────────────────────────────────────────────────────
  cron: {
    before:     { emotion: 'focused',   action: 'typing',         prop: 'scroll' },
    after:      { emotion: 'satisfied', action: 'nodding' },
  },

  // ── Session / status ─────────────────────────────────────────────────────────
  session_status: {
    before:     { emotion: 'thinking',  action: 'looking_around' },
    after:      { emotion: 'focused',   action: 'nodding' },
  },

  // ── Gateway ──────────────────────────────────────────────────────────────────
  gateway: {
    before:     { emotion: 'focused',   action: 'typing',         prop: 'keyboard', intensity: 'high' },
    after:      { emotion: 'satisfied', action: 'nodding' },
    afterError: { emotion: 'confused',  action: 'terrified',      intensity: 'high' },
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
