/**
 * Relay client tests.
 *
 * Tests fire-and-forget behavior, validation, URL construction, and the
 * critical invariant: push() never throws, even on network failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRelayClient } from '../src/relay-client.js';
import { DEFAULT_CONFIG, IDLE_EVENT } from '../src/types.js';

describe('createRelayClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs the correct relay URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const relay = createRelayClient(DEFAULT_CONFIG, 'test-token-abc123');
    relay.push({ emotion: 'focused', action: 'coding', prop: 'keyboard', intensity: 'medium' }, IDLE_EVENT);

    // Give the async fire-and-forget a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/push/test-token-abc123');
    expect(url).toContain(DEFAULT_CONFIG.relayUrl);
  });

  it('sends a POST with Content-Type: application/json', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const relay = createRelayClient(DEFAULT_CONFIG, 'tok');
    relay.push({ emotion: 'excited', action: 'celebrating' }, IDLE_EVENT);

    await new Promise((r) => setTimeout(r, 0));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('merges signal onto current state before sending', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const current = { emotion: 'focused' as const, action: 'coding' as const, prop: 'keyboard' as const, intensity: 'high' as const };
    const relay = createRelayClient(DEFAULT_CONFIG, 'tok');
    // Partial signal — only change emotion
    relay.push({ emotion: 'satisfied' }, current);

    await new Promise((r) => setTimeout(r, 0));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.emotion).toBe('satisfied');
    expect(body.action).toBe('coding');     // from current
    expect(body.prop).toBe('keyboard');      // from current
    expect(body.intensity).toBe('high');     // from current
  });

  it('never throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const relay = createRelayClient(DEFAULT_CONFIG, 'tok');

    // Should NOT throw
    expect(() => {
      relay.push({ emotion: 'focused', action: 'coding' }, IDLE_EVENT);
    }).not.toThrow();

    // Give async rejection a tick to resolve
    await new Promise((r) => setTimeout(r, 0));
    // Still no unhandled rejection here — test would fail if there was one
  });

  it('URL-encodes tokens with special characters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const relay = createRelayClient(DEFAULT_CONFIG, 'my/token+with spaces');
    relay.push({ emotion: 'focused', action: 'coding', prop: 'keyboard', intensity: 'medium' }, IDLE_EVENT);

    await new Promise((r) => setTimeout(r, 0));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('my%2Ftoken%2Bwith%20spaces');
    expect(url).not.toContain('my/token+with spaces');
  });

  it('does not call fetch for invalid events', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const relay = createRelayClient(DEFAULT_CONFIG, 'tok');
    // Invalid emotion — should be silently dropped
    relay.push({ emotion: 'nonexistent_emotion' as any, action: 'coding', prop: 'none', intensity: 'medium' }, IDLE_EVENT);

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
