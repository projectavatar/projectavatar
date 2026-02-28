export const PROTOCOL_VERSION = '1.0.0';

export const DEFAULTS = {
  prop: 'none' as const,
  intensity: 'medium' as const,
  idleTimeoutMs: 30_000,
  relayUrl: 'https://relay.projectavatar.io',
  bufferLimit: 200,
} as const;

export const RATE_LIMITS = {
  pushPerMinute: 60,
  streamConnectionsPerMinute: 10,
  maxPayloadBytes: 1024,
} as const;

/** Token format: 32–64 chars, base62 + underscore + hyphen */
export const TOKEN_REGEX = /^[a-zA-Z0-9_-]{32,64}$/;

export function isValidToken(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

/**
 * Generates a cryptographically random 48-character token.
 *
 * The character set is exactly 64 characters (A-Z, a-z, 0-9, _, -)
 * which makes it a power of 2. Each random byte maps cleanly to one
 * character via `b % 64` with zero modulo bias — every character is
 * equally likely. Do not change the charset length without reviewing
 * this invariant.
 *
 * Entropy: 48 chars × 6 bits = 288 bits.
 */
export function generateToken(): string {
  // Exactly 64 chars — power of 2 ensures zero modulo bias
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  if (chars.length !== 64) {
    throw new Error('generateToken: charset must be exactly 64 characters');
  }
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % 64]).join('');
}

/**
 * CORS headers shared across all relay endpoints.
 * Frozen to prevent accidental mutation at runtime.
 * Open CORS: the token is the auth boundary.
 */
export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
} as const) as Record<string, string>;

/**
 * Keepalive timing constants — shared between relay (server) and web (client).
 *
 * INVARIANT: PING_INTERVAL_MS < KEEPALIVE_TIMEOUT_MS
 * The server pings every PING_INTERVAL_MS. The client disconnects if no message
 * arrives within KEEPALIVE_TIMEOUT_MS. As long as the ping interval is shorter
 * than the timeout, idle connections survive.
 */
export const KEEPALIVE = {
  /** Server sends a ping every 30s */
  pingIntervalMs: 30_000,
  /** Client closes + reconnects if no message in 60s */
  timeoutMs: 60_000,
} as const;
