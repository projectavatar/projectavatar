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

export function generateToken(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
