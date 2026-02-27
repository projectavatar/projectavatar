/**
 * Output filter tests — Node.js implementation.
 *
 * Covers: tag extraction, streaming filter, edge cases, relay push behavior.
 * Run with: npx vitest --run (from skill/ directory)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractAvatarTag, AVATAR_TAG_REGEX } from '../filters/node/filter.js';
import { StreamingAvatarFilter } from '../filters/node/streaming-filter.js';
import type { FilterConfig } from '../filters/node/filter.js';

const mockConfig: FilterConfig = {
  relayUrl: 'https://relay.projectavatar.io',
  token: 'test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  enabled: true,
};

// ─── extractAvatarTag ─────────────────────────────────────────────────────────

describe('extractAvatarTag', () => {
  it('extracts a minimal valid tag', () => {
    const input = '[avatar:{"emotion":"idle","action":"idle"}]\nHello world';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(cleanText).toBe('Hello world');
    expect(avatarEvent).not.toBeNull();
    expect(avatarEvent?.emotion).toBe('idle');
    expect(avatarEvent?.action).toBe('idle');
  });

  it('extracts a full tag with prop and intensity', () => {
    const input = '[avatar:{"emotion":"focused","action":"typing","prop":"keyboard","intensity":"high"}]\nHere is the code:';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(cleanText).toBe('Here is the code:');
    expect(avatarEvent?.prop).toBe('keyboard');
    expect(avatarEvent?.intensity).toBe('high');
  });

  it('returns original text when no tag is present', () => {
    const input = 'Just a normal response with no tag.';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(cleanText).toBe(input);
    expect(avatarEvent).toBeNull();
  });

  it('handles malformed JSON gracefully (returns original text)', () => {
    const input = '[avatar:{"emotion":"idle","action":}]\nSome response';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(cleanText).toBe(input);
    expect(avatarEvent).toBeNull();
  });

  it('handles a tag missing required "emotion" field', () => {
    const input = '[avatar:{"action":"typing"}]\nCode stuff';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(cleanText).toBe(input);
    expect(avatarEvent).toBeNull();
  });

  it('handles a tag missing required "action" field', () => {
    const input = '[avatar:{"emotion":"focused"}]\nSome text';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(cleanText).toBe(input);
    expect(avatarEvent).toBeNull();
  });

  it('handles an empty object tag', () => {
    // Pattern `{[^}]+}` requires at least one char — empty object won't match
    const input = '[avatar:{}]\nText';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(cleanText).toBe(input);
    expect(avatarEvent).toBeNull();
  });

  it('strips trailing whitespace and newline after tag', () => {
    const input = '[avatar:{"emotion":"idle","action":"idle"}]   \nActual response';
    const { cleanText } = extractAvatarTag(input);
    expect(cleanText).toBe('Actual response');
  });

  it('handles tag without trailing newline', () => {
    const input = '[avatar:{"emotion":"idle","action":"idle"}]Immediate text';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(avatarEvent).not.toBeNull();
    expect(cleanText).toBe('Immediate text');
  });

  it('only extracts the FIRST tag when multiple exist', () => {
    const input = '[avatar:{"emotion":"idle","action":"idle"}]\nFirst\n[avatar:{"emotion":"excited","action":"celebrating"}]\nSecond';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(avatarEvent?.emotion).toBe('idle');
    // Second tag should remain in the clean text (unusual case, but documented)
    expect(cleanText).toContain('[avatar:{"emotion":"excited","action":"celebrating"}]');
  });

  it('handles a tag in the middle of multi-line text (multiline flag)', () => {
    // The MULTILINE flag means ^ matches start of any line, not just string start
    // In practice tags should be at the start, but the regex supports mid-text
    const input = 'Preamble\n[avatar:{"emotion":"thinking","action":"looking_around"}]\nThe actual response';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(avatarEvent).not.toBeNull();
    expect(cleanText).not.toContain('[avatar:');
  });

  it('does NOT match nested objects (regex limitation by design)', () => {
    // Nested objects break the simple [^}]+ regex — this is intentional
    const input = '[avatar:{"emotion":"idle","action":{"nested":"object"}}]\nText';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    // The regex captures up to the first }, which may produce invalid JSON
    // Either the tag is ignored (parse error) or partially matched — both are safe
    if (avatarEvent) {
      // If somehow it matched, action should not be the nested object string
      expect(typeof avatarEvent.action).toBe('string');
    } else {
      expect(cleanText).toBe(input); // Safe passthrough
    }
  });

  it('handles unicode content around the tag', () => {
    const input = '[avatar:{"emotion":"excited","action":"responding"}]\n日本語テスト 🎉';
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(avatarEvent).not.toBeNull();
    expect(cleanText).toBe('日本語テスト 🎉');
  });

  it('handles very long response text correctly', () => {
    const longText = 'x'.repeat(10_000);
    const input = `[avatar:{"emotion":"idle","action":"idle"}]\n${longText}`;
    const { cleanText, avatarEvent } = extractAvatarTag(input);
    expect(avatarEvent).not.toBeNull();
    expect(cleanText).toHaveLength(10_000);
  });

  it('is safe when input is empty string', () => {
    const { cleanText, avatarEvent } = extractAvatarTag('');
    expect(cleanText).toBe('');
    expect(avatarEvent).toBeNull();
  });

  it('trims leading whitespace from clean text', () => {
    const input = '[avatar:{"emotion":"idle","action":"idle"}]\n   leading spaces';
    const { cleanText } = extractAvatarTag(input);
    expect(cleanText).toBe('leading spaces');
  });
});

// ─── AVATAR_TAG_REGEX ─────────────────────────────────────────────────────────

describe('AVATAR_TAG_REGEX', () => {
  it('does not match a tag missing the closing bracket', () => {
    const result = '[avatar:{"emotion":"idle","action":"idle"}]'.slice(0, -1).match(AVATAR_TAG_REGEX);
    expect(result).toBeNull();
  });

  it('does not match a tag with wrong prefix casing', () => {
    const result1 = '[Avatar:{"emotion":"idle","action":"idle"}]'.match(AVATAR_TAG_REGEX);
    const result2 = '[AVATAR:{"emotion":"idle","action":"idle"}]'.match(AVATAR_TAG_REGEX);
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });
});

// ─── StreamingAvatarFilter ────────────────────────────────────────────────────

describe('StreamingAvatarFilter', () => {
  function collectChunks(
    chunks: string[],
    config = mockConfig,
    bufferLimit = 200,
  ): string {
    const output: string[] = [];
    const filter = new StreamingAvatarFilter(config, {
      onChunk: (c) => output.push(c),
      bufferLimit,
    });
    for (const chunk of chunks) {
      filter.processChunk(chunk);
    }
    filter.flush();
    return output.join('');
  }

  it('passes through text with no tag', () => {
    const result = collectChunks(['Hello ', 'world']);
    expect(result).toBe('Hello world');
  });

  it('extracts tag when it arrives in a single chunk', () => {
    const result = collectChunks([
      '[avatar:{"emotion":"idle","action":"idle"}]\nHello',
    ]);
    expect(result).toBe('Hello');
  });

  it('extracts tag split across multiple chunks', () => {
    const result = collectChunks([
      '[avatar:{"emot',
      'ion":"idle","action":"idle"}]\n',
      'Hello world',
    ]);
    expect(result).toBe('Hello world');
  });

  it('handles tag arriving one character at a time', () => {
    const tag = '[avatar:{"emotion":"idle","action":"idle"}]\nHello';
    const chars = tag.split('');
    const result = collectChunks(chars);
    expect(result).toBe('Hello');
  });

  it('passes through everything after tag is resolved', () => {
    const result = collectChunks([
      '[avatar:{"emotion":"excited","action":"celebrating"}]\nLine one\n',
      'Line two\n',
      'Line three',
    ]);
    expect(result).toBe('Line one\nLine two\nLine three');
  });

  it('flushes buffer when limit is exceeded with no tag', () => {
    // Buffer limit set to 10 — the response has no tag
    const result = collectChunks(
      ['Hello world, this is a longer text'],
      mockConfig,
      10,
    );
    expect(result).toBe('Hello world, this is a longer text');
  });

  it('flush() is safe to call multiple times', () => {
    const output: string[] = [];
    const filter = new StreamingAvatarFilter(mockConfig, {
      onChunk: (c) => output.push(c),
    });
    filter.processChunk('hello');
    filter.flush();
    filter.flush(); // Second call should be a no-op
    expect(output.join('')).toBe('hello');
  });

  it('correctly reports resolved state', () => {
    const filter = new StreamingAvatarFilter(mockConfig, { onChunk: () => {} });
    expect(filter.resolved).toBe(false);
    filter.processChunk('[avatar:{"emotion":"idle","action":"idle"}]\nHi');
    expect(filter.resolved).toBe(true);
  });

  it('handles empty stream (no chunks)', () => {
    const result = collectChunks([]);
    expect(result).toBe('');
  });

  it('handles stream that is only whitespace', () => {
    const result = collectChunks(['   ', '\n', '\t']);
    expect(result).toBe('   \n\t');
  });

  it('extracts tag even when followed by no content', () => {
    const result = collectChunks(['[avatar:{"emotion":"idle","action":"idle"}]']);
    expect(result).toBe('');
  });

  it('invokes onTagExtracted callback correctly when tag found', () => {
    const extracted: boolean[] = [];
    const filter = new StreamingAvatarFilter(mockConfig, {
      onChunk: () => {},
      onTagExtracted: (found) => extracted.push(found),
    });
    filter.processChunk('[avatar:{"emotion":"idle","action":"idle"}]\nHi');
    expect(extracted).toEqual([true]);
  });

  it('invokes onTagExtracted callback correctly when no tag', () => {
    const extracted: boolean[] = [];
    const filter = new StreamingAvatarFilter(mockConfig, {
      onChunk: () => {},
      onTagExtracted: (found) => extracted.push(found),
      bufferLimit: 10,
    });
    // 22 chars, well over the limit of 10 → should resolve false
    filter.processChunk('No tag here at all!!');
    // Exceeds buffer limit → resolves false
    expect(extracted).toEqual([false]);
  });
});

// ─── Relay push (fire-and-forget safety) ─────────────────────────────────────

describe('filterResponse (relay push safety)', () => {
  it('returns clean text even when relay is unreachable', async () => {
    // Use a config pointing at an invalid relay
    const badConfig: FilterConfig = {
      relayUrl: 'http://127.0.0.1:0', // Nothing listening here
      token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      enabled: true,
    };

    // filterResponse should never throw even with unreachable relay
    const { filterResponse } = await import('../filters/node/filter.js');
    const result = await filterResponse(
      '[avatar:{"emotion":"idle","action":"idle"}]\nHello from filter',
      badConfig,
    );
    expect(result).toBe('Hello from filter');
  });
});
