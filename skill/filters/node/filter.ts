/**
 * Avatar output filter — Node.js implementation.
 *
 * Intercepts agent responses, extracts the [avatar:{...}] tag, strips it
 * from the visible response, and forwards the event to the relay.
 *
 * The avatar is cosmetic. Filter failures MUST NOT affect the user's
 * experience with the agent. Every operation that could fail is wrapped
 * to guarantee clean text is always returned.
 */

export interface AvatarEvent {
  emotion: string;
  action: string;
  prop?: string;
  intensity?: string;
}

export interface FilterConfig {
  relayUrl: string;
  token: string;
  enabled?: boolean;
}

export interface FilterResult {
  cleanText: string;
  avatarEvent: AvatarEvent | null;
}

/**
 * Regex that matches the avatar tag.
 *
 * Pattern breakdown:
 *   ^           – Start of a line (with `m` flag)
 *   \[avatar:   – Literal tag prefix
 *   ({[^}]+})   – Capture group: JSON object (no nesting — our schema has none)
 *   \]          – Literal tag suffix
 *   \s*\n?      – Optional trailing whitespace + newline
 *
 * Flags:
 *   m – Multiline: `^` matches start of any line, not just the string
 *
 * Note: `{[^}]+}` will not match nested objects like `{"foo":{"bar":1}}`.
 * This is intentional — our schema has no nested objects, and a non-matching
 * nested tag is safer than silently mangling content.
 */
export const AVATAR_TAG_REGEX = /^\[avatar:(\{[^}]+\})\]\s*\n?/m;

/**
 * Extract and strip the avatar tag from a complete (non-streaming) response.
 *
 * Returns the cleaned text and the parsed event (or null if no valid tag found).
 * Never throws — malformed tags are ignored and the original text is returned.
 */
export function extractAvatarTag(text: string): FilterResult {
  let match: RegExpMatchArray | null;

  try {
    match = text.match(AVATAR_TAG_REGEX);
  } catch {
    // Regex failure (shouldn't happen, but be safe)
    return { cleanText: text, avatarEvent: null };
  }

  if (!match) {
    return { cleanText: text, avatarEvent: null };
  }

  let event: AvatarEvent;
  try {
    event = JSON.parse(match[1]) as AvatarEvent;
  } catch {
    // Malformed JSON — return original text unmodified
    return { cleanText: text, avatarEvent: null };
  }

  // Require at minimum emotion + action
  if (typeof event.emotion !== 'string' || typeof event.action !== 'string') {
    return { cleanText: text, avatarEvent: null };
  }

  // Strip the matched tag (and its trailing whitespace/newline) from the text
  const cleanText = text.replace(match[0], '').trimStart();

  return { cleanText, avatarEvent: event };
}

/**
 * Push an avatar event to the relay. Fire-and-forget — never throws.
 * A failed push is logged but never allowed to block the response pipeline.
 */
export async function pushToRelay(config: FilterConfig, event: AvatarEvent): Promise<void> {
  if (config.enabled === false) return;

  try {
    const url = `${config.relayUrl}/push/${config.token}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      // @ts-ignore — signal is not in all fetch type defs but works in Node 18+
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // Non-critical — avatar events are cosmetic, never block the pipeline
    if (process.env.AVATAR_DEBUG) {
      console.warn('[avatar-filter] Failed to push event:', err);
    }
  }
}

/**
 * Filter a complete (non-streaming) response.
 *
 * Extracts the avatar tag, pushes to relay asynchronously, and returns the
 * clean text. The relay push happens in the background — this function returns
 * as soon as the clean text is ready.
 */
export async function filterResponse(text: string, config: FilterConfig): Promise<string> {
  try {
    const { cleanText, avatarEvent } = extractAvatarTag(text);

    if (avatarEvent) {
      // Fire and forget — don't await, don't block
      void pushToRelay(config, avatarEvent);
    }

    return cleanText;
  } catch {
    // Catch-all: if something goes completely wrong, return original text
    return text;
  }
}
