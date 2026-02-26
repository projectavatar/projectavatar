/**
 * Streaming output filter — Node.js implementation.
 *
 * Most LLM interfaces stream tokens. The avatar tag appears at the start of
 * the response, so this filter buffers the first N chars, extracts the tag
 * when found, then passes all subsequent chunks through directly.
 *
 * The buffer window is generous (200 chars). A maximal avatar tag is ~120
 * chars. If 200 chars accumulate with no tag found, the buffer is flushed
 * and the filter gives up — never indefinitely delaying the stream.
 */

import { extractAvatarTag, pushToRelay } from './filter.js';
import type { FilterConfig } from './filter.js';

export interface StreamingFilterOptions {
  /** Max characters to buffer while searching for the avatar tag. Default: 200 */
  bufferLimit?: number;
  /** Called with each chunk of clean text, in order. */
  onChunk: (chunk: string) => void;
  /** Called when the filter determines whether a tag was found (before first chunk). */
  onTagExtracted?: (extracted: boolean) => void;
}

/**
 * StreamingAvatarFilter processes a stream of text chunks from an LLM,
 * extracting the avatar tag from the start of the stream without buffering
 * the entire response.
 *
 * Usage:
 *
 *   const filter = new StreamingAvatarFilter(config, {
 *     onChunk: (chunk) => process.stdout.write(chunk),
 *   });
 *
 *   for await (const chunk of llmStream) {
 *     filter.processChunk(chunk);
 *   }
 *
 *   filter.flush();
 */
export class StreamingAvatarFilter {
  private buffer = '';
  private tagResolved = false;
  /** True once we've emitted the first clean chunk post-tag (stops leading-whitespace trim). */
  private firstCleanChunkEmitted = false;
  private bufferLimit: number;
  private config: FilterConfig;
  private onChunk: (chunk: string) => void;
  private onTagExtracted?: (extracted: boolean) => void;

  constructor(config: FilterConfig, options: StreamingFilterOptions) {
    this.config = config;
    this.bufferLimit = options.bufferLimit ?? 200;
    this.onChunk = options.onChunk;
    this.onTagExtracted = options.onTagExtracted;
  }

  /** Emit a clean chunk, trimming leading whitespace from the very first one. */
  private emitClean(chunk: string): void {
    if (!this.firstCleanChunkEmitted) {
      const trimmed = chunk.trimStart();
      if (trimmed) {
        this.firstCleanChunkEmitted = true;
        this.onChunk(trimmed);
      }
      // If trimmed is empty, don't mark firstCleanChunkEmitted — wait for content
    } else {
      this.onChunk(chunk);
    }
  }

  /**
   * Process a single chunk from the stream.
   *
   * - If tag already resolved: chunk passes through (with leading-whitespace trimming on first).
   * - If buffering: append to buffer, attempt extraction.
   * - If buffer exceeds limit: flush buffer as-is, give up on tag search.
   */
  processChunk(chunk: string): void {
    if (this.tagResolved) {
      this.emitClean(chunk);
      return;
    }

    this.buffer += chunk;

    // Attempt tag extraction on the accumulated buffer
    const { cleanText, avatarEvent } = extractAvatarTag(this.buffer);

    if (avatarEvent) {
      // Tag found — push to relay, emit clean text, stop buffering
      this.tagResolved = true;
      void pushToRelay(this.config, avatarEvent);
      this.onTagExtracted?.(true);
      this.buffer = '';

      // Only emit if there's actual content after the tag
      if (cleanText) {
        this.firstCleanChunkEmitted = true;
        this.onChunk(cleanText);
      }
      return;
    }

    // No tag yet — check if the buffer is long enough to conclude there's no tag
    if (this.buffer.length > this.bufferLimit) {
      // Exceeded the window — give up, flush as-is
      this.tagResolved = true;
      this.onTagExtracted?.(false);
      const buffered = this.buffer;
      this.buffer = '';
      this.firstCleanChunkEmitted = true;
      this.onChunk(buffered);
    }

    // Otherwise: still buffering, wait for more chunks
  }

  /**
   * Call after the stream ends to flush any remaining buffer.
   * Safe to call even if the stream ended cleanly and buffer is empty.
   */
  flush(): void {
    if (this.buffer) {
      const remaining = this.buffer;
      this.buffer = '';

      if (!this.tagResolved) {
        // Stream ended before we found or ruled out a tag
        // Attempt one final extraction
        const { cleanText, avatarEvent } = extractAvatarTag(remaining);
        if (avatarEvent) {
          void pushToRelay(this.config, avatarEvent);
          this.onTagExtracted?.(true);
          if (cleanText) {
            this.firstCleanChunkEmitted = true;
            this.onChunk(cleanText);
          }
        } else {
          this.onTagExtracted?.(false);
          this.firstCleanChunkEmitted = true;
          this.onChunk(remaining);
        }
        this.tagResolved = true;
      } else {
        this.emitClean(remaining);
      }
    }
  }

  /** Whether the tag search phase is complete (tag found or search exhausted). */
  get resolved(): boolean {
    return this.tagResolved;
  }
}

/**
 * Filter a ReadableStream<string> — returns a new ReadableStream with avatar tags stripped.
 *
 * Convenience wrapper for environments that expose streams natively (e.g. Cloudflare Workers,
 * fetch() Response.body piped through TextDecoder).
 */
export function filterStream(
  input: ReadableStream<string>,
  config: FilterConfig,
): ReadableStream<string> {
  let controller: ReadableStreamDefaultController<string>;

  const filter = new StreamingAvatarFilter(config, {
    onChunk: (chunk) => controller.enqueue(chunk),
  });

  const output = new ReadableStream<string>({
    start(ctrl) {
      controller = ctrl;
    },
  });

  // Process input in the background
  void (async () => {
    try {
      const reader = input.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        filter.processChunk(value);
      }
      filter.flush();
    } catch (err) {
      // On error, close the output stream
      if (process.env.AVATAR_DEBUG) {
        console.warn('[avatar-filter] Stream error:', err);
      }
    } finally {
      controller.close();
    }
  })();

  return output;
}
