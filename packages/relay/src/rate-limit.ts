import { RATE_LIMITS } from '../../shared/src/constants.js';

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Rate limiter using Durable Object SQL storage.
 *
 * Uses a simple sliding-window counter with SQL for atomic increment.
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
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        window_minute INTEGER NOT NULL
      )
    `);
    this.initialized = true;
  }

  check(kind: 'push' | 'stream', identifier: string): RateLimitResult {
    this.ensureTable();

    const windowMinute = Math.floor(Date.now() / 60_000);
    const key = `${kind}:${identifier}`;
    const limit = kind === 'push' ? RATE_LIMITS.pushPerMinute : RATE_LIMITS.streamConnectionsPerMinute;

    // Atomic read + increment in a single transaction
    // Clean up stale entries from previous windows
    this.sql.exec(`DELETE FROM rate_limits WHERE window_minute < ?`, windowMinute - 1);

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

    // Upsert: increment or insert
    this.sql.exec(
      `INSERT INTO rate_limits (key, count, window_minute) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + 1, window_minute = ?`,
      key, windowMinute, windowMinute,
    );

    return { allowed: true, retryAfterSeconds: 0 };
  }
}
