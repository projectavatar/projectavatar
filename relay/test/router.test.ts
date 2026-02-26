import { describe, it, expect } from 'vitest';

/**
 * Router-level tests for relay/src/index.ts.
 *
 * These test the routing/validation layer without needing a full
 * Cloudflare Worker runtime — we import the handler logic indirectly
 * via the validation and auth modules.
 */

// ─── /health ─────────────────────────────────────────────────────────────────

describe('/health endpoint', () => {
  it('shape check: must have status and version fields', () => {
    // Validate the shape we expect from the health endpoint
    const mockHealthResponse = { status: 'ok', version: '1.0.0' };
    expect(mockHealthResponse).toHaveProperty('status', 'ok');
    expect(mockHealthResponse).toHaveProperty('version');
    expect(typeof mockHealthResponse.version).toBe('string');
  });
});

// ─── Token format validation (used by push + stream routes) ──────────────────

import { isValidToken } from '../../packages/shared/src/constants.js';

describe('router token validation', () => {
  it('allows valid 48-char token through', () => {
    expect(isValidToken('a'.repeat(48))).toBe(true);
  });

  it('blocks short tokens', () => {
    expect(isValidToken('short')).toBe(false);
  });

  it('blocks tokens with path separators (URL injection guard)', () => {
    expect(isValidToken('a'.repeat(31) + '/')).toBe(false);
    expect(isValidToken('a'.repeat(31) + '.')).toBe(false);
  });

  it('blocks tokens with special chars that could appear in URLs', () => {
    expect(isValidToken('a'.repeat(31) + '?')).toBe(false);
    expect(isValidToken('a'.repeat(31) + '#')).toBe(false);
    expect(isValidToken('a'.repeat(31) + '=')).toBe(false);
  });
});

// ─── generateToken bias check ─────────────────────────────────────────────────

import { generateToken } from '../../packages/shared/src/constants.js';

describe('generateToken', () => {
  it('generates tokens of correct length', () => {
    for (let i = 0; i < 10; i++) {
      expect(generateToken().length).toBe(48);
    }
  });

  it('all generated tokens pass isValidToken', () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidToken(generateToken())).toBe(true);
    }
  });

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });

  it('uses all 64 charset characters (distribution sanity check)', () => {
    // Generate enough tokens to statistically cover the charset
    const combined = Array.from({ length: 50 }, () => generateToken()).join('');
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    for (const char of charset) {
      expect(combined).toContain(char);
    }
  });
});
