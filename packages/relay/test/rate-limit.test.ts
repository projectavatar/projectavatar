import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock KV namespace ─────────────────────────────────────────────────────

class MockKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string, _opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
  }

  clear() {
    this.store.clear();
  }
}

// Dynamic import so we can inject the mock env
const { checkRateLimit } = await import('../src/rate-limit.js');

describe('checkRateLimit', () => {
  let mockKV: MockKV;
  let env: { RATE_LIMIT_KV: MockKV; CHANNEL: unknown; RELAY_VERSION: string };

  beforeEach(() => {
    mockKV = new MockKV();
    env = {
      RATE_LIMIT_KV: mockKV,
      CHANNEL: {},
      RELAY_VERSION: '1.0.0',
    };
  });

  it('allows the first request', async () => {
    const result = await checkRateLimit(env as any, 'push', 'testtoken');
    expect(result.allowed).toBe(true);
  });

  it('allows requests up to the push limit (60)', async () => {
    for (let i = 0; i < 60; i++) {
      const result = await checkRateLimit(env as any, 'push', 'token1');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the 61st push request', async () => {
    for (let i = 0; i < 60; i++) {
      await checkRateLimit(env as any, 'push', 'token2');
    }
    const result = await checkRateLimit(env as any, 'push', 'token2');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('allows requests up to the stream limit (10)', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await checkRateLimit(env as any, 'stream', '1.2.3.4');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the 11th stream request', async () => {
    for (let i = 0; i < 10; i++) {
      await checkRateLimit(env as any, 'stream', '5.6.7.8');
    }
    const result = await checkRateLimit(env as any, 'stream', '5.6.7.8');
    expect(result.allowed).toBe(false);
  });

  it('tracks different identifiers independently', async () => {
    for (let i = 0; i < 60; i++) {
      await checkRateLimit(env as any, 'push', 'token-a');
    }
    // token-b should still be allowed
    const result = await checkRateLimit(env as any, 'push', 'token-b');
    expect(result.allowed).toBe(true);
  });

  it('allows the request when KV throws (degrade gracefully)', async () => {
    const brokenKV = {
      get: async () => { throw new Error('KV error'); },
      put: async () => { throw new Error('KV error'); },
    };
    const brokenEnv = { ...env, RATE_LIMIT_KV: brokenKV };
    const result = await checkRateLimit(brokenEnv as any, 'push', 'token-x');
    expect(result.allowed).toBe(true);
  });
});
