import { RATE_LIMITS } from '../../shared/src/constants.js';

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter using Durable Object SQL storage.
 *
 * Uses a simple per-minute counter with SQL for atomic upsert.
 * Replaces the previous KV-based implementation which had race conditions
 * under concurrent requests (get-then-put is not atomic in KV).
 *
 * SQL storage in the Channel DO is transactional — no race conditions.
 * Old entries are lazily cleaned up on each check.
 */
export class RateLimiter {
  private initialized = false;

  constructor(private sql: SqlStorage) {}

  private ensureTable(): void {
    if (this.initialized) return;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT NOT NULL,
        window_minute INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (key, window_minute)
      )
    `);
    this.initialized = true;
  }

  check(kind: 'push' | 'stream', identifier: string): RateLimitResult {
    const windowMinute = Math.floor(Date.now() / 60_000);
    const key = `${kind}:${identifier}`;
    const limit = kind === 'push' ? RATE_LIMITS.pushPerMinute : RATE_LIMITS.streamConnectionsPerMinute;

    try {
      this.ensureTable();
      // Clean up stale entries — keep only current window
      this.sql.exec(`DELETE FROM rate_limits WHERE window_minute < ?`, windowMinute);

      const row = this.sql.exec(
        `SELECT count FROM rate_limits WHERE key = ? AND window_minute = ?`,
        key, windowMinute,
      ).one() as { count: number } | null;

      const count = row?.count ?? 0;

      if (count >= limit) {
        const secondsIntoMinute = (Date.now() / 1000) % 60;
        const retryAfterSeconds = Math.ceil(60 - secondsIntoMinute);
        return { allowed: false, retryAfterSeconds };
      }

      // Upsert: increment or insert for current window
      this.sql.exec(
        `INSERT INTO rate_limits (key, window_minute, count) VALUES (?, ?, 1)
         ON CONFLICT(key, window_minute) DO UPDATE SET count = count + 1`,
        key, windowMinute,
      );

      return { allowed: true, retryAfterSeconds: 0 };
    } catch {
      // If SQL fails, allow the request (availability > rate limiting)
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}
