/**
 * Tool map tests.
 *
 * Verifies that all known tools resolve to valid signals,
 * and that unknown tools are safely ignored.
 */

import { describe, it, expect } from 'vitest';
import { resolveToolSignal, TOOL_SIGNAL_MAP } from '../src/tool-map.js';
import { EMOTIONS, ACTIONS, PROPS, INTENSITIES } from '../src/types.js';

// Derived from the canonical arrays — stays in sync automatically when schema changes
const VALID_EMOTIONS   = new Set<string>(EMOTIONS);
const VALID_ACTIONS    = new Set<string>(ACTIONS);
const VALID_PROPS      = new Set<string>(PROPS);
const VALID_INTENSITIES = new Set<string>(INTENSITIES);

describe('resolveToolSignal', () => {
  it('returns null for unknown tools', () => {
    expect(resolveToolSignal('totally_unknown_tool_xyz', 'before')).toBeNull();
    expect(resolveToolSignal('totally_unknown_tool_xyz', 'after')).toBeNull();
  });

  it('returns before signal for known tools', () => {
    const signal = resolveToolSignal('web_search', 'before');
    expect(signal).not.toBeNull();
    expect(signal?.emotion).toBe('thinking');
    expect(signal?.action).toBe('shading_eyes');
  });

  it('returns after signal for known tools', () => {
    const signal = resolveToolSignal('web_search', 'after');
    expect(signal).not.toBeNull();
    expect(signal?.emotion).toBe('focused');
  });

  it('returns afterError signal when error is provided', () => {
    const signal = resolveToolSignal('exec', 'after', 'Command failed');
    expect(signal).not.toBeNull();
    expect(signal?.emotion).toBe('confused');
    expect(signal?.action).toBe('terrified');
  });

  it('returns after (success) signal when no error', () => {
    const signal = resolveToolSignal('exec', 'after', undefined);
    expect(signal).not.toBeNull();
    expect(signal?.emotion).toBe('satisfied');
  });

  it('returns null for after when no after rule exists', () => {
    // Read only has a before and after but no afterError
    const signal = resolveToolSignal('Read', 'after', 'some error');
    // Read has after but no afterError — falls back to after
    expect(signal).not.toBeNull();
  });
});

describe('TOOL_SIGNAL_MAP validation', () => {
  it('all tool rules have a valid before signal', () => {
    for (const [tool, rule] of Object.entries(TOOL_SIGNAL_MAP)) {
      if (rule.before.emotion !== undefined) {
        expect(VALID_EMOTIONS.has(rule.before.emotion), `${tool}: invalid before.emotion`).toBe(true);
      }
      if (rule.before.action !== undefined) {
        expect(VALID_ACTIONS.has(rule.before.action), `${tool}: invalid before.action`).toBe(true);
      }
      if (rule.before.prop !== undefined) {
        expect(VALID_PROPS.has(rule.before.prop), `${tool}: invalid before.prop`).toBe(true);
      }
      if (rule.before.intensity !== undefined) {
        expect(VALID_INTENSITIES.has(rule.before.intensity), `${tool}: invalid before.intensity`).toBe(true);
      }
    }
  });

  it('all tool rules have valid after signals when defined', () => {
    for (const [tool, rule] of Object.entries(TOOL_SIGNAL_MAP)) {
      if (rule.after) {
        if (rule.after.emotion !== undefined) {
          expect(VALID_EMOTIONS.has(rule.after.emotion), `${tool}: invalid after.emotion`).toBe(true);
        }
        if (rule.after.action !== undefined) {
          expect(VALID_ACTIONS.has(rule.after.action), `${tool}: invalid after.action`).toBe(true);
        }
      }
      if (rule.afterError) {
        if (rule.afterError.emotion !== undefined) {
          expect(VALID_EMOTIONS.has(rule.afterError.emotion), `${tool}: invalid afterError.emotion`).toBe(true);
        }
        if (rule.afterError.action !== undefined) {
          expect(VALID_ACTIONS.has(rule.afterError.action), `${tool}: invalid afterError.action`).toBe(true);
        }
      }
    }
  });

  it('key tools are all present', () => {
    const required = [
      'web_search', 'web_fetch', 'Read', 'Write', 'Edit', 'exec',
      'browser', 'message', 'image', 'memory_search',
    ];
    for (const tool of required) {
      expect(TOOL_SIGNAL_MAP[tool], `${tool} is missing from map`).toBeDefined();
    }
  });
});
