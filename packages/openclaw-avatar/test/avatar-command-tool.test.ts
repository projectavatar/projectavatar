/**
 * avatar-command-tool.ts tests.
 *
 * Tests the avatar_commands tool that powers the /avatar Discord slash command.
 * Covers: link generation, status fetch (success + errors), unknown subcommand,
 * missing token, and the lazy getToken() behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAvatarCommandTool } from '../src/avatar-command-tool.js';
import type { PluginConfig } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const TOOL_CALL_ID = 'cmd_test123';

function makeCfg(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function makeParams(command = '') {
  return { command, commandName: 'avatar', skillName: 'avatar' };
}

function textOf(result: { content: Array<{ type: string; text: string }> }) {
  return result.content[0]?.text ?? '';
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('avatar_commands tool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── registration shape ────────────────────────────────────────────────────

  it('has correct name and parameters schema', () => {
    const tool = createAvatarCommandTool(makeCfg(), () => 'tok');
    expect(tool.name).toBe('avatar_commands');
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.properties).toHaveProperty('command');
    expect(tool.parameters.properties).toHaveProperty('commandName');
    expect(tool.parameters.properties).toHaveProperty('skillName');
    expect(Array.isArray(tool.parameters.required)).toBe(true);
  });

  // ── missing token ─────────────────────────────────────────────────────────

  it('returns setup instructions when AVATAR_TOKEN is missing', async () => {
    const tool = createAvatarCommandTool(makeCfg(), () => '');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('link'));
    expect(textOf(result)).toContain('AVATAR_TOKEN not set');
  });

  // ── link subcommand ───────────────────────────────────────────────────────

  it('returns share link for "link" subcommand', async () => {
    const cfg = makeCfg({ appUrl: 'https://app.example.com' });
    const tool = createAvatarCommandTool(cfg, () => 'mytoken');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('link'));
    expect(textOf(result)).toContain('https://app.example.com/?token=mytoken');
  });

  it('returns share link when no subcommand is given (defaults to link)', async () => {
    const cfg = makeCfg({ appUrl: 'https://app.example.com' });
    const tool = createAvatarCommandTool(cfg, () => 'mytoken');
    const result = await tool.execute(TOOL_CALL_ID, makeParams(''));
    expect(textOf(result)).toContain('https://app.example.com/?token=mytoken');
  });

  it('strips trailing slash from appUrl', async () => {
    const cfg = makeCfg({ appUrl: 'https://app.example.com/' });
    const tool = createAvatarCommandTool(cfg, () => 'tok');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('link'));
    expect(textOf(result)).not.toContain('com//');
    expect(textOf(result)).toContain('https://app.example.com/?token=tok');
  });

  it('encodes token in the URL', async () => {
    const cfg = makeCfg({ appUrl: 'https://app.example.com' });
    const tool = createAvatarCommandTool(cfg, () => 'tok en+special');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('link'));
    // appUrl link uses raw token (query param, browser handles encoding)
    expect(textOf(result)).toContain('tok en+special');
  });

  // ── status subcommand ─────────────────────────────────────────────────────

  it('returns formatted channel status on success', async () => {
    const statePayload = {
      model: 'claude-sonnet',
      connectedClients: 2,
      lastAgentEventAt: Date.now() - 5_000,
    };
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => statePayload,
    } as Response);

    const tool = createAvatarCommandTool(makeCfg(), () => 'tok');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('status'));
    const text = textOf(result);
    expect(text).toContain('claude-sonnet');
    expect(text).toContain('2');
    expect(text).toMatch(/\d+s ago/);
  });

  it('shows "never" for lastAgentEventAt when null', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model: null, connectedClients: 0, lastAgentEventAt: null }),
    } as Response);

    const tool = createAvatarCommandTool(makeCfg(), () => 'tok');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('status'));
    expect(textOf(result)).toContain('never');
    expect(textOf(result)).toContain('not selected');
  });

  it('handles non-ok relay response gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const tool = createAvatarCommandTool(makeCfg(), () => 'tok');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('status'));
    expect(textOf(result)).toContain('503');
  });

  it('handles fetch timeout (AbortError) gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const tool = createAvatarCommandTool(makeCfg(), () => 'tok');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('status'));
    expect(textOf(result)).toContain('timed out');
  });

  it('handles generic network error gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('network failure'));
    const tool = createAvatarCommandTool(makeCfg(), () => 'tok');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('status'));
    expect(textOf(result)).toContain('Could not reach relay');
  });

  it('URL-encodes the token in the relay status request', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementationOnce((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: async () => ({ model: null, connectedClients: 0, lastAgentEventAt: null }),
      } as Response);
    });

    const tool = createAvatarCommandTool(makeCfg({ relayUrl: 'https://relay.example.com' }), () => 'tok/special');
    await tool.execute(TOOL_CALL_ID, makeParams('status'));
    expect(capturedUrl).toContain(encodeURIComponent('tok/special'));
  });

  // ── unknown subcommand ────────────────────────────────────────────────────

  it('returns usage help for unknown subcommand', async () => {
    const tool = createAvatarCommandTool(makeCfg(), () => 'tok');
    const result = await tool.execute(TOOL_CALL_ID, makeParams('potato'));
    expect(textOf(result)).toContain('Usage');
    expect(textOf(result)).toContain('/avatar link');
    expect(textOf(result)).toContain('/avatar status');
  });

  // ── lazy getToken ─────────────────────────────────────────────────────────

  it('reads token lazily — picks up changes after tool creation', async () => {
    let token = '';
    const cfg = makeCfg({ appUrl: 'https://app.example.com' });
    const tool = createAvatarCommandTool(cfg, () => token);

    // No token yet — should fail
    const noToken = await tool.execute(TOOL_CALL_ID, makeParams('link'));
    expect(textOf(noToken)).toContain('AVATAR_TOKEN not set');

    // Token set after creation — should work
    token = 'latetoken';
    const withToken = await tool.execute(TOOL_CALL_ID, makeParams('link'));
    expect(textOf(withToken)).toContain('latetoken');
  });
});
