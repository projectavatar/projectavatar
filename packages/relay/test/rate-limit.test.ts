import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../src/rate-limit.js';

// ─── Mock SQL storage (mimics DO SqlStorage) ────────────────────────────────

class MockSqlStorage {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();

  exec(query: string, ...params: unknown[]): { one(): Record<string, unknown> | null } {
    const q = query.trim().toUpperCase();

    if (q.startsWith('CREATE TABLE')) {
      this.tables.set('rate_limits', new Map());
      return { one: () => null };
    }

    if (q.startsWith('DELETE')) {
      const windowMinute = params[0] as number;
      const table = this.tables.get('rate_limits');
      if (table) {
        for (const [k, row] of table) {
          if ((row['window_minute'] as number) < windowMinute) {
            table.delete(k);
          }
        }
      }
      return { one: () => null };
    }

    if (q.startsWith('SELECT')) {
      const key = params[0] as string;
      const windowMinute = params[1] as number;
      const table = this.tables.get('rate_limits');
      const compositeKey = `${key}:${windowMinute}`;
      const row = table?.get(compositeKey);
      return { one: () => row && (row['window_minute'] as number) === windowMinute ? row : null };
    }

    if (q.startsWith('INSERT')) {
      const key = params[0] as string;
      const windowMinute = params[1] as number;
      const table = this.tables.get('rate_limits')!;
      const compositeKey = `${key}:${windowMinute}`;
      const existing = table.get(compositeKey);
      if (existing && (existing['window_minute'] as number) === windowMinute) {
        existing['count'] = (existing['count'] as number) + 1;
      } else {
        table.set(compositeKey, { key, count: 1, window_minute: windowMinute });
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
    // token-b should still be allowed
    const result = limiter.check('push', 'token-b');
    expect(result.allowed).toBe(true);
  });
});
