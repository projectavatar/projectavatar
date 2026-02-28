/**
 * Tool map tests.
 */

import { describe, it, expect } from 'vitest';
import { resolveToolSignal, TOOL_SIGNAL_MAP } from '../src/tool-map.js';
import { EMOTIONS, ACTIONS, PROPS, INTENSITIES } from '../src/types.js';

const VALID_EMOTIONS    = new Set<string>(EMOTIONS);
const VALID_ACTIONS     = new Set<string>(ACTIONS);
const VALID_PROPS       = new Set<string>(PROPS);
const VALID_INTENSITIES = new Set<string>(INTENSITIES);

describe('resolveToolSignal', () => {
  it('returns null for unknown tools', () => {
    expect(resolveToolSignal('totally_unknown_tool_xyz', 'before')).toBeNull();
    expect(resolveToolSignal('totally_unknown_tool_xyz', 'after')).toBeNull();
  });

  it('returns null for intentionally unmapped routine tools', () => {
    expect(resolveToolSignal('Read', 'before')).toBeNull();
    expect(resolveToolSignal('Write', 'before')).toBeNull();
    expect(resolveToolSignal('Edit', 'before')).toBeNull();
    expect(resolveToolSignal('web_search', 'before')).toBeNull();
    expect(resolveToolSignal('web_fetch', 'before')).toBeNull();
    expect(resolveToolSignal('process', 'before')).toBeNull();
    expect(resolveToolSignal('image', 'before')).toBeNull();
    expect(resolveToolSignal('message', 'before')).toBeNull();
  });

  it('returns before signal for high-signal tools', () => {
    const signal = resolveToolSignal('exec', 'before');
    expect(signal).not.toBeNull();
    expect(signal?.emotion).toBe('thinking');
    expect(signal?.action).toBe('typing');
  });

  it('returns afterError signal when error is provided', () => {
    const signal = resolveToolSignal('exec', 'after', 'Command failed');
    expect(signal).not.toBeNull();
    expect(signal?.emotion).toBe('confused');
    expect(signal?.action).toBe('nervous');
  });

  it('returns null for after when no after rule exists', () => {
    const signal = resolveToolSignal('exec', 'after', undefined);
    expect(signal).toBeNull();
  });

  it('returns after signal for tools that have one', () => {
    const signal = resolveToolSignal('tts', 'after');
    expect(signal).not.toBeNull();
    expect(signal?.emotion).toBe('happy');
    expect(signal?.action).toBe('greeting');
  });

  it('returns before signal for browser', () => {
    const signal = resolveToolSignal('browser', 'before');
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('searching');
  });

  it('returns before signal for sessions_spawn', () => {
    const signal = resolveToolSignal('sessions_spawn', 'before');
    expect(signal).not.toBeNull();
    expect(signal?.emotion).toBe('excited');
  });
});

describe('TOOL_SIGNAL_MAP validation', () => {
  it('all tool rules have valid signal values', () => {
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

  it('only high-signal tools are mapped', () => {
    const mapped = Object.keys(TOOL_SIGNAL_MAP);
    expect(mapped.length).toBeLessThanOrEqual(10);
    expect(mapped).toContain('exec');
    expect(mapped).toContain('browser');
    expect(mapped).toContain('tts');
    expect(mapped).toContain('sessions_spawn');
    expect(mapped).toContain('gateway');
  });
});
