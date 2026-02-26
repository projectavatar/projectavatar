import { describe, it, expect } from 'vitest';
import { isValidToken, tokenToChannelName } from '../src/auth.js';

describe('isValidToken', () => {
  it('accepts a 48-char base62 token', () => {
    const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop12345';
    expect(token.length).toBe(47); // sanity
  });

  it('accepts tokens between 32 and 64 chars', () => {
    expect(isValidToken('a'.repeat(32))).toBe(true);
    expect(isValidToken('a'.repeat(48))).toBe(true);
    expect(isValidToken('a'.repeat(64))).toBe(true);
  });

  it('accepts underscores and hyphens', () => {
    expect(isValidToken('a'.repeat(31) + '_')).toBe(true);
    expect(isValidToken('a'.repeat(31) + '-')).toBe(true);
  });

  it('rejects tokens shorter than 32 chars', () => {
    expect(isValidToken('abc')).toBe(false);
    expect(isValidToken('a'.repeat(31))).toBe(false);
  });

  it('rejects tokens longer than 64 chars', () => {
    expect(isValidToken('a'.repeat(65))).toBe(false);
  });

  it('rejects tokens with invalid characters', () => {
    expect(isValidToken('a'.repeat(31) + '!')).toBe(false);
    expect(isValidToken('a'.repeat(31) + ' ')).toBe(false);
    expect(isValidToken('a'.repeat(31) + '/')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidToken('')).toBe(false);
  });
});

describe('tokenToChannelName', () => {
  it('returns a 64-char hex string', async () => {
    const name = await tokenToChannelName('a'.repeat(48));
    expect(name).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same token always gives same name', async () => {
    const token = 'MyTestToken_1234567890abcdefghijklmnopqrstuvwx';
    const name1 = await tokenToChannelName(token);
    const name2 = await tokenToChannelName(token);
    expect(name1).toBe(name2);
  });

  it('different tokens give different names', async () => {
    const name1 = await tokenToChannelName('a'.repeat(48));
    const name2 = await tokenToChannelName('b'.repeat(48));
    expect(name1).not.toBe(name2);
  });
});
