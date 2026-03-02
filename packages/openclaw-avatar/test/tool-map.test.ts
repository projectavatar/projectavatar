/**
 * Tool map tests — v2 (EmotionBlend format).
 */

import { describe, it, expect } from 'vitest';
import { resolveToolSignal, TOOL_SIGNAL_MAP } from '../src/tool-map.js';
import { PRIMARY_EMOTIONS, WORD_INTENSITIES, ACTIONS, PROPS, INTENSITIES } from '../src/types.js';

const VALID_PRIMARIES   = new Set<string>(PRIMARY_EMOTIONS);
const VALID_WORD_INTS   = new Set<string>(WORD_INTENSITIES);
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
  });

  it('returns before signal with emotion blend for high-signal tools', () => {
    const signal = resolveToolSignal('exec', 'before');
    expect(signal).not.toBeNull();
    expect(signal?.emotions).toMatchObject({ interest: 'high' });
    expect(signal?.action).toBe('typing');
  });

  it('returns afterError signal with blend when error is provided', () => {
    const signal = resolveToolSignal('exec', 'after', 'Command failed');
    expect(signal).not.toBeNull();
    expect(signal?.emotions).toMatchObject({ fear: 'medium' });
    expect(signal?.action).toBe('nervous');
  });

  it('returns null for after when no after rule exists', () => {
    const signal = resolveToolSignal('exec', 'after', undefined);
    expect(signal).toBeNull();
  });

  it('returns after signal for tools that have one', () => {
    const signal = resolveToolSignal('tts', 'after');
    expect(signal).not.toBeNull();
    expect(signal?.emotions).toMatchObject({ joy: 'high' });
    expect(signal?.action).toBe('greeting');
  });
});

describe('TOOL_SIGNAL_MAP validation', () => {
  it('all tool rules have valid signal values', () => {
    for (const [tool, rule] of Object.entries(TOOL_SIGNAL_MAP)) {
      // Validate emotions blend in before/after/afterError
      for (const [phase, signal] of [['before', rule.before], ['after', rule.after], ['afterError', rule.afterError]] as const) {
        if (!signal) continue;
        if (signal.emotions) {
          for (const [key, value] of Object.entries(signal.emotions)) {
            expect(VALID_PRIMARIES.has(key), `${tool}.${phase}: invalid emotion key '${key}'`).toBe(true);
            expect(VALID_WORD_INTS.has(value!), `${tool}.${phase}: invalid word intensity '${value}'`).toBe(true);
          }
        }
        if (signal.action !== undefined) {
          expect(VALID_ACTIONS.has(signal.action), `${tool}.${phase}: invalid action`).toBe(true);
        }
        if (signal.prop !== undefined) {
          expect(VALID_PROPS.has(signal.prop), `${tool}.${phase}: invalid prop`).toBe(true);
        }
        if (signal.intensity !== undefined) {
          expect(VALID_INTENSITIES.has(signal.intensity), `${tool}.${phase}: invalid intensity`).toBe(true);
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
