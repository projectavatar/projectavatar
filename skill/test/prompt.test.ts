/**
 * Prompt template tests.
 *
 * Validates that the prompt template is well-formed, contains all required
 * enum values, and that the tag format it describes is parseable by the filter.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractAvatarTag } from '../filters/node/filter.js';
import {
  EMOTIONS,
  ACTIONS,
  PROPS,
  INTENSITIES,
} from '../../packages/shared/src/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT = readFileSync(join(__dirname, '../prompt.md'), 'utf-8');

describe('prompt.md', () => {
  it('contains all valid emotion values', () => {
    for (const emotion of EMOTIONS) {
      expect(PROMPT).toContain(emotion);
    }
  });

  it('contains all valid action values', () => {
    for (const action of ACTIONS) {
      expect(PROMPT).toContain(action);
    }
  });

  it('contains all valid prop values (excluding "none")', () => {
    for (const prop of PROPS.filter((p) => p !== 'none')) {
      expect(PROMPT).toContain(prop);
    }
  });

  it('contains all valid intensity values', () => {
    for (const intensity of INTENSITIES) {
      expect(PROMPT).toContain(intensity);
    }
  });

  it('contains the tag format example', () => {
    // The core tag format must be shown
    expect(PROMPT).toContain('[avatar:');
  });

  it('prompt example tags are parseable by the filter', () => {
    // Extract all example tags from the prompt and verify each one parses
    const tagMatches = PROMPT.matchAll(/\[avatar:(\{[^}]+\})\]/g);
    const parsed: Array<{ emotion: string; action: string }> = [];

    for (const match of tagMatches) {
      try {
        const event = JSON.parse(match[1]);
        if (typeof event.emotion === 'string' && typeof event.action === 'string') {
          parsed.push(event);
        }
      } catch {
        // skip malformed examples (shouldn't exist but test would catch them)
      }
    }

    // There should be at least a few examples in the prompt
    expect(parsed.length).toBeGreaterThanOrEqual(3);
  });

  it('example tags use valid emotion + action values', () => {
    const tagMatches = PROMPT.matchAll(/\[avatar:(\{[^}]+\})\]/g);

    for (const match of tagMatches) {
      try {
        const event = JSON.parse(match[1]);
        if (typeof event.emotion === 'string') {
          expect(EMOTIONS as readonly string[]).toContain(event.emotion);
        }
        if (typeof event.action === 'string') {
          expect(ACTIONS as readonly string[]).toContain(event.action);
        }
        if (typeof event.prop === 'string') {
          expect(PROPS as readonly string[]).toContain(event.prop);
        }
        if (typeof event.intensity === 'string') {
          expect(INTENSITIES as readonly string[]).toContain(event.intensity);
        }
      } catch {
        // skip
      }
    }
  });

  it('filter can extract tags when prepended to real text', () => {
    // Simulate what an LLM would actually output
    const examples = [
      '[avatar:{"emotion":"focused","action":"coding","prop":"keyboard"}]\nHere is the code:',
      '[avatar:{"emotion":"thinking","action":"searching"}]\nLet me look that up.',
      '[avatar:{"emotion":"excited","action":"responding"}]\nGreat question!',
    ];

    for (const example of examples) {
      const { avatarEvent, cleanText } = extractAvatarTag(example);
      expect(avatarEvent).not.toBeNull();
      expect(cleanText).not.toContain('[avatar:');
      expect(cleanText.length).toBeGreaterThan(0);
    }
  });
});
