import { RATE_LIMITS } from '../../packages/shared/src/constants.js';
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
    // Get current count
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
