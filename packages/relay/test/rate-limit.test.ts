import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../src/rate-limit.js';

// ─── Mock SQL storage (mimics DO SqlStorage) ────────────────────────────────

class MockSqlStorage {
  private rows = new Map<string, { count: number; window_minute: number }>();

  exec(query: string, ...params: unknown[]): { one(): Record<string, unknown> | null } {
    const q = query.trim();
    const upper = q.toUpperCase();

    if (upper.startsWith('CREATE TABLE')) {
      return { one: () => null };
    }

    if (upper.startsWith('DELETE')) {
      // DELETE FROM rate_limits WHERE window_minute < ?
      const windowMinute = params[0] as number;
      for (const [k, row] of this.rows) {
        if (row.window_minute < windowMinute) {
          this.rows.delete(k);
        }
      }
      return { one: () => null };
    }

    if (upper.startsWith('SELECT')) {
      // SELECT count FROM rate_limits WHERE key = ? AND window_minute = ?
      const key = params[0] as string;
      const windowMinute = params[1] as number;
      const compositeKey = `${key}|${windowMinute}`;
      const row = this.rows.get(compositeKey);
      return { one: () => row ? { count: row.count } : null };
    }

    if (upper.startsWith('INSERT')) {
      // INSERT ... ON CONFLICT(key, window_minute) DO UPDATE SET count = count + 1
      const key = params[0] as string;
      const windowMinute = params[1] as number;
      const compositeKey = `${key}|${windowMinute}`;
      const existing = this.rows.get(compositeKey);
      if (existing) {
        existing.count += 1;
      } else {
        this.rows.set(compositeKey, { count: 1, window_minute: windowMinute });
      }
      return { one: () => null };
    }

    return { one: () => null };
  }
}

describe('RateLimiter (DO SQL)', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(new MockSqlStorage() as any);
  });

  it('allows the first request', () => {
    const result = limiter.check('push', 'testtoken');
    expect(result.allowed).toBe(true);
  });

  it('allows requests up to the push limit (60)', () => {
    for (let i = 0; i < 60; i++) {
      const result = limiter.check('push', 'token1');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the 61st push request', () => {
    for (let i = 0; i < 60; i++) {
      limiter.check('push', 'token2');
    }
    const result = limiter.check('push', 'token2');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('allows requests up to the stream limit (10)', () => {
    for (let i = 0; i < 10; i++) {
      const result = limiter.check('stream', '1.2.3.4');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the 11th stream request', () => {
    for (let i = 0; i < 10; i++) {
      limiter.check('stream', '5.6.7.8');
    }
    const result = limiter.check('stream', '5.6.7.8');
    expect(result.allowed).toBe(false);
  });

  it('tracks different identifiers independently', () => {
    for (let i = 0; i < 60; i++) {
      limiter.check('push', 'token-a');
    }
    const result = limiter.check('push', 'token-b');
    expect(result.allowed).toBe(true);
  });

  it('fails open when SQL throws', () => {
    const broken = { exec: () => { throw new Error('SQL error'); } };
    const brokenLimiter = new RateLimiter(broken as any);
    const result = brokenLimiter.check('push', 'token-x');
    expect(result.allowed).toBe(true);
  });
});
