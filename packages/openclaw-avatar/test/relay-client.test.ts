/**
 * Relay client tests — v2 (EmotionBlend format).
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
    relay.push({ emotions: { interest: 'high' }, action: 'typing', prop: 'keyboard', intensity: 'medium' }, IDLE_EVENT);

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
    relay.push({ emotions: { joy: 'high' }, action: 'celebrating' }, IDLE_EVENT);

    await new Promise((r) => setTimeout(r, 0));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('merges signal onto current state before sending', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const current = {
      emotions: { interest: 'high' as const },
      action: 'typing' as const,
      prop: 'keyboard' as const,
      intensity: 'high' as const,
    };
    const relay = createRelayClient(DEFAULT_CONFIG, 'tok');
    // Partial signal — only change emotions
    relay.push({ emotions: { joy: 'high' } }, current);

    await new Promise((r) => setTimeout(r, 0));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.emotions).toEqual({ joy: 'high' }); // from signal
    expect(body.action).toBe('typing');               // from current
    expect(body.prop).toBe('keyboard');                // from current
    expect(body.intensity).toBe('high');               // from current
  });

  it('never throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const relay = createRelayClient(DEFAULT_CONFIG, 'tok');

    expect(() => {
      relay.push({ emotions: { interest: 'high' }, action: 'typing' }, IDLE_EVENT);
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 0));
  });

  it('URL-encodes tokens with special characters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const relay = createRelayClient(DEFAULT_CONFIG, 'my/token+with spaces');
    relay.push({ emotions: { interest: 'high' }, action: 'typing', prop: 'keyboard', intensity: 'medium' }, IDLE_EVENT);

    await new Promise((r) => setTimeout(r, 0));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('my%2Ftoken%2Bwith%20spaces');
  });

  it('does not call fetch for invalid events', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const relay = createRelayClient(DEFAULT_CONFIG, 'tok');
    // Invalid emotion key in blend — should be silently dropped by validation
    relay.push({ emotions: { nonexistent: 'high' } as any, action: 'typing', prop: 'none', intensity: 'medium' }, IDLE_EVENT);

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
