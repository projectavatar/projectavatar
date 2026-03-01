import { RATE_LIMITS } from '../../shared/src/constants.js';
import type { Env } from './types.js';

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Sliding window rate limiter using Cloudflare KV.
 * Key: `rl:<kind>:<identifier>:<window-minute>`
 */
export async function checkRateLimit(
  env: Env,
  kind: 'push' | 'stream',
  identifier: string,
): Promise<RateLimitResult> {
  const windowMinute = Math.floor(Date.now() / 60_000);
  const key = `rl:${kind}:${identifier}:${windowMinute}`;

  const limit = kind === 'push' ? RATE_LIMITS.pushPerMinute : RATE_LIMITS.streamConnectionsPerMinute;

  try {
    // Known limitation: KV get-then-put is not atomic. Under high concurrency,
    // two requests in the same window can both read count=N, both pass the check,
    // and both write N+1. This means the actual limit may be slightly exceeded.
    // Acceptable for this use case — the rate limiter is a soft guard against
    // accidental abuse, not a hard security boundary. For strict enforcement,
    // move counting to a Durable Object with transactional storage.
    const raw = await env.RATE_LIMIT_KV.get(key);
    const count = raw ? parseInt(raw, 10) : 0;

    if (count >= limit) {
      // Seconds remaining in the current minute window
      const secondsIntoMinute = (Date.now() / 1000) % 60;
      const retryAfterSeconds = Math.ceil(60 - secondsIntoMinute);
      return { allowed: false, retryAfterSeconds };
    }

    // Increment with TTL of 120s (2 minutes — covers the current and next window)
    await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 120 });
    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    // If KV fails, allow the request (availability > rate limiting)
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
