/**
 * types.ts tests — validatePluginConfig + new cooldown config fields.
 */

import { describe, it, expect } from 'vitest';
import { validatePluginConfig, DEFAULT_CONFIG, ONE_SHOT_ACTIONS } from '../src/types.js';

describe('validatePluginConfig', () => {
  it('returns no errors and full sanitized config for a valid config', () => {
    const { errors, sanitized } = validatePluginConfig({
      relayUrl: 'https://relay.example.com',
      enabled: false,
      idleTimeoutMs: 10_000,
      debounceMs: 500,
      emotionCooldownMs: 3000,
      actionCooldownMs: 2000,
      oneShotCooldownMs: 4000,
    });
    expect(errors).toHaveLength(0);
    expect(sanitized.relayUrl).toBe('https://relay.example.com');
    expect(sanitized.enabled).toBe(false);
    expect(sanitized.idleTimeoutMs).toBe(10_000);
    expect(sanitized.debounceMs).toBe(500);
    expect(sanitized.emotionCooldownMs).toBe(3000);
    expect(sanitized.actionCooldownMs).toBe(2000);
    expect(sanitized.oneShotCooldownMs).toBe(4000);
  });

  it('strips trailing slash from relayUrl', () => {
    const { errors, sanitized } = validatePluginConfig({ relayUrl: 'https://relay.example.com/' });
    expect(errors).toHaveLength(0);
    expect(sanitized.relayUrl).toBe('https://relay.example.com');
  });

  it('strips multiple trailing slashes', () => {
    const { errors, sanitized } = validatePluginConfig({ relayUrl: 'https://relay.example.com///' });
    expect(errors).toHaveLength(0);
    expect(sanitized.relayUrl).toBe('https://relay.example.com');
  });

  it('rejects non-URL strings for relayUrl', () => {
    const { errors, sanitized } = validatePluginConfig({ relayUrl: 'not a url at all' });
    expect(errors.some(e => e.includes('valid URL'))).toBe(true);
    expect(sanitized.relayUrl).toBeUndefined();
  });

  it('rejects non-string relayUrl', () => {
    const { errors, sanitized } = validatePluginConfig({ relayUrl: 42 });
    expect(errors.some(e => e.includes('relayUrl'))).toBe(true);
    expect(sanitized.relayUrl).toBeUndefined();
  });

  it('rejects debounceMs below minimum', () => {
    const { errors, sanitized } = validatePluginConfig({ debounceMs: 10 });
    expect(errors.some(e => e.includes('debounceMs'))).toBe(true);
    expect(sanitized.debounceMs).toBeUndefined();
  });

  it('rejects non-number debounceMs', () => {
    const { errors, sanitized } = validatePluginConfig({ debounceMs: 'potato' });
    expect(errors.some(e => e.includes('debounceMs'))).toBe(true);
    expect(sanitized.debounceMs).toBeUndefined();
  });

  it('rejects idleTimeoutMs below minimum', () => {
    const { errors, sanitized } = validatePluginConfig({ idleTimeoutMs: 1000 });
    expect(errors.some(e => e.includes('idleTimeoutMs'))).toBe(true);
    expect(sanitized.idleTimeoutMs).toBeUndefined();
  });

  it('returns empty object sanitized for non-object input', () => {
    const { errors, sanitized } = validatePluginConfig('not an object');
    expect(errors).toHaveLength(1);
    expect(sanitized).toEqual({});
  });

  it('spreads sanitized onto DEFAULT_CONFIG produces valid config', () => {
    const { sanitized } = validatePluginConfig({ debounceMs: 'potato', enabled: false });
    const cfg = { ...DEFAULT_CONFIG, ...sanitized };
    expect(cfg.debounceMs).toBe(DEFAULT_CONFIG.debounceMs);
    expect(cfg.enabled).toBe(false);
  });

  it('accepts an empty config object with no errors', () => {
    const { errors, sanitized } = validatePluginConfig({});
    expect(errors).toHaveLength(0);
    expect(Object.keys(sanitized)).toHaveLength(0);
  });

  // ── New cooldown config fields ────────────────────────────────────────────

  it('rejects negative emotionCooldownMs', () => {
    const { errors, sanitized } = validatePluginConfig({ emotionCooldownMs: -1 });
    expect(errors.some(e => e.includes('emotionCooldownMs'))).toBe(true);
    expect(sanitized.emotionCooldownMs).toBeUndefined();
  });

  it('rejects non-number actionCooldownMs', () => {
    const { errors, sanitized } = validatePluginConfig({ actionCooldownMs: 'fast' });
    expect(errors.some(e => e.includes('actionCooldownMs'))).toBe(true);
    expect(sanitized.actionCooldownMs).toBeUndefined();
  });

  it('rejects negative oneShotCooldownMs', () => {
    const { errors, sanitized } = validatePluginConfig({ oneShotCooldownMs: -100 });
    expect(errors.some(e => e.includes('oneShotCooldownMs'))).toBe(true);
    expect(sanitized.oneShotCooldownMs).toBeUndefined();
  });

  it('allows zero for cooldown values (disable cooldown)', () => {
    const { errors, sanitized } = validatePluginConfig({
      emotionCooldownMs: 0,
      actionCooldownMs: 0,
      oneShotCooldownMs: 0,
    });
    expect(errors).toHaveLength(0);
    expect(sanitized.emotionCooldownMs).toBe(0);
    expect(sanitized.actionCooldownMs).toBe(0);
    expect(sanitized.oneShotCooldownMs).toBe(0);
  });

  it('DEFAULT_CONFIG has sensible cooldown defaults', () => {
    expect(DEFAULT_CONFIG.emotionCooldownMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.actionCooldownMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.oneShotCooldownMs).toBeGreaterThanOrEqual(DEFAULT_CONFIG.actionCooldownMs);
  });
});

describe('ONE_SHOT_ACTIONS', () => {
  it('contains the expected one-shot actions', () => {
    expect(ONE_SHOT_ACTIONS.has('celebrating')).toBe(true);
    expect(ONE_SHOT_ACTIONS.has('greeting')).toBe(true);
    expect(ONE_SHOT_ACTIONS.has('laughing')).toBe(true);
    expect(ONE_SHOT_ACTIONS.has('dismissive')).toBe(true);
  });

  it('does not contain sustained/looping actions', () => {
    expect(ONE_SHOT_ACTIONS.has('idle')).toBe(false);
    expect(ONE_SHOT_ACTIONS.has('typing')).toBe(false);
    expect(ONE_SHOT_ACTIONS.has('talking')).toBe(false);
    expect(ONE_SHOT_ACTIONS.has('searching')).toBe(false);
  });
});
