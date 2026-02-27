/**
 * avatar_link tool — handles /avatar [link|status] command dispatch.
 *
 * Registered via the plugin and invoked by the skill's command-dispatch:tool
 * so /avatar works as a native Discord slash command without going through
 * the model (deterministic, instant response).
 *
 * Receives: { command: "<raw args>", commandName: "avatar", skillName: "avatar" }
 */

import type { PluginConfig, ChannelStateResponse } from './types.js';

function reply(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function createAvatarCommandTool(cfg: PluginConfig, getToken: () => string) {
  return {
    name: 'avatar_link',
    description: 'Returns the avatar share link or channel status. Used internally by the /avatar slash command.',
    parameters: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Raw args after /avatar (e.g. "link", "status", or empty)' },
        commandName: { type: 'string' },
        skillName: { type: 'string' },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>): Promise<ReturnType<typeof reply>> {
      const token = getToken();
      if (!token) {
        return reply('[Avatar] AVATAR_TOKEN not set.\nRun: openclaw secrets set AVATAR_TOKEN <your-token>');
      }

      const sub = ((params.command as string | undefined) ?? '').trim().toLowerCase() || 'link';

      if (sub === 'link' || sub === '') {
        const appBase = cfg.appUrl.replace(/\/+$/, '');
        return reply(`[Avatar] Share link:\n${appBase}/?token=${token}`);
      }

      if (sub === 'status') {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5_000);
          let res: Response;
          try {
            res = await fetch(
              `${cfg.relayUrl}/channel/${encodeURIComponent(token)}/state`,
              { signal: controller.signal },
            );
          } finally {
            clearTimeout(timeout);
          }
          if (!res.ok) {
            return reply(`[Avatar] Relay returned HTTP ${res.status}`);
          }
          const state = await res.json() as ChannelStateResponse;
          const model    = state.model          ?? 'not selected';
          const clients  = state.connectedClients;
          const lastSeen = state.lastAgentEventAt
            ? `${Math.round((Date.now() - state.lastAgentEventAt) / 1_000)}s ago`
            : 'never';
          return reply(
            `[Avatar] Channel status:\n` +
            `  Model:       ${model}\n` +
            `  Viewers:     ${clients}\n` +
            `  Last event:  ${lastSeen}`,
          );
        } catch (err) {
          const isAbort = err instanceof Error && err.name === 'AbortError';
          return reply(isAbort
            ? '[Avatar] Relay timed out — check plugins.entries.openclaw-avatar.config.relayUrl'
            : '[Avatar] Could not reach relay — check plugins.entries.openclaw-avatar.config.relayUrl and network.',
          );
        }
      }

      return reply('[Avatar] Usage:\n  /avatar link    — get your share URL\n  /avatar status  — show channel info');
    },
  };
}
