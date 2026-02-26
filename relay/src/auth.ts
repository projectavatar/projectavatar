import { isValidToken } from '../../packages/shared/src/constants.js';

export { isValidToken };

/**
 * Derive a stable Durable Object name from a token using SHA-256.
 * This means tokens don't need to be stored — any valid token
 * deterministically maps to its own DO instance.
 */
export async function tokenToChannelName(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
