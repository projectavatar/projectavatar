/**
 * types.ts tests — validatePluginConfig.
 *
 * Verifies that the validator returns errors AND a sanitized object that
 * contains only valid fields (invalid keys are stripped, not passed through).
 */

import { describe, it, expect } from 'vitest';
import { validatePluginConfig, DEFAULT_CONFIG } from '../src/types.js';

describe('validatePluginConfig', () => {
  it('returns no errors and full sanitized config for a valid config', () => {
    const { errors, sanitized } = validatePluginConfig({
      relayUrl: 'https://relay.example.com',
      enabled: false,
      idleTimeoutMs: 10_000,
      debounceMs: 500,
    });
    expect(errors).toHaveLength(0);
    expect(sanitized.relayUrl).toBe('https://relay.example.com');
    expect(sanitized.enabled).toBe(false);
    expect(sanitized.idleTimeoutMs).toBe(10_000);
    expect(sanitized.debounceMs).toBe(500);
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
    expect(sanitized.relayUrl).toBeUndefined(); // invalid key stripped
  });

  it('rejects non-string relayUrl', () => {
    const { errors, sanitized } = validatePluginConfig({ relayUrl: 42 });
    expect(errors.some(e => e.includes('relayUrl'))).toBe(true);
    expect(sanitized.relayUrl).toBeUndefined();
  });

  it('rejects debounceMs below minimum', () => {
    const { errors, sanitized } = validatePluginConfig({ debounceMs: 10 });
    expect(errors.some(e => e.includes('debounceMs'))).toBe(true);
    expect(sanitized.debounceMs).toBeUndefined(); // stripped — falls back to DEFAULT_CONFIG
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
    // Simulate what index.ts does — only valid keys get applied
    const { sanitized } = validatePluginConfig({ debounceMs: 'potato', enabled: false });
    const cfg = { ...DEFAULT_CONFIG, ...sanitized };
    // Invalid debounceMs was stripped — falls back to default
    expect(cfg.debounceMs).toBe(DEFAULT_CONFIG.debounceMs);
    // Valid enabled:false was kept
    expect(cfg.enabled).toBe(false);
  });

  it('accepts an empty config object with no errors', () => {
    const { errors, sanitized } = validatePluginConfig({});
    expect(errors).toHaveLength(0);
    expect(Object.keys(sanitized)).toHaveLength(0);
  });
});
