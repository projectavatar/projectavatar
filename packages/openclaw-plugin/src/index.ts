/**
 * @projectavatar/openclaw-avatar — OpenClaw plugin
 *
 * A first-class OpenClaw plugin that hooks into the agent lifecycle to drive
 * a real-time 3D VRM avatar. The avatar reacts to what the agent is *doing*
 * (via before_tool_call / after_tool_call) — not just what it says.
 *
 * Installation:
 *   openclaw plugins install @projectavatar/openclaw-avatar
 *   openclaw secrets set AVATAR_TOKEN <your-token>
 *
 * See: https://projectavatar.io/docs/openclaw
 */

import type { OpenClawPluginApi, OpenClawPluginDefinition } from './openclaw-api.js';
import { createRelayClient } from './relay-client.js';
import { createAvatarStateMachine } from './state-machine.js';
import { resolveToolSignal } from './tool-map.js';
import { createAvatarTool } from './avatar-tool.js';
import { DEFAULT_CONFIG, validatePluginConfig } from './types.js';
import type { PluginConfig } from './types.js';

/**
 * Fallback signals for tool calls on tools not in the tool map.
 * The avatar should always react to tool activity, even for unknown tools.
 */
const UNKNOWN_TOOL_BEFORE: import('./types.js').AvatarSignal = { emotion: 'focused', action: 'coding', prop: 'none', intensity: 'medium' };
const UNKNOWN_TOOL_AFTER:  import('./types.js').AvatarSignal = { emotion: 'focused', action: 'responding', prop: 'none', intensity: 'medium' };

const plugin: OpenClawPluginDefinition = {
  // Explicit id keeps the config key stable regardless of package name.
  // @projectavatar/openclaw-avatar would normalize to "openclaw-avatar" by default,
  // but "projectavatar" is shorter, matches openclaw.plugin.json, and is what
  // users reference in plugins.entries.projectavatar.config.
  id: 'projectavatar',
  name: 'Project Avatar',
  description: 'Real-time 3D avatar driven by agent lifecycle hooks.',

  register(api: OpenClawPluginApi): void {
    // ── Config ──────────────────────────────────────────────────────────────

    // Validate and sanitize pluginConfig — only valid keys are merged into cfg.
    // Invalid fields are stripped from sanitized and fall back to DEFAULT_CONFIG.
    const { errors, sanitized } = validatePluginConfig(api.pluginConfig ?? {});
    if (errors.length > 0) {
      api.logger.warn(
        `[ProjectAvatar] Invalid plugin config — invalid fields reset to defaults. Errors: ${errors.join('; ')}`,
      );
    }

    const cfg: PluginConfig = { ...DEFAULT_CONFIG, ...sanitized };

    if (!cfg.enabled) {
      api.logger.info('[ProjectAvatar] Plugin disabled via config.');
      return;
    }

    // ── Token (lazy) ─────────────────────────────────────────────────────────
    //
    // Token is read on first push rather than at registration time.
    // This handles environments where secrets are injected after process start
    // (secret managers, runtime config reloads) without permanently disabling
    // the plugin if AVATAR_TOKEN isn't set at boot.
    //
    // If the token is absent at registration, we log a warning but continue —
    // the relay client will check on each push and drop the call if still unset.

    const getToken = (): string => process.env.AVATAR_TOKEN ?? '';

    if (!getToken()) {
      api.logger.warn(
        '[ProjectAvatar] AVATAR_TOKEN not set at startup — plugin will activate once the ' +
        'variable is available. Set via: openclaw secrets set AVATAR_TOKEN <your-token>',
      );
    }

    // ── Core services ────────────────────────────────────────────────────────

    const relay = createRelayClient(cfg, getToken());
    const sm = createAvatarStateMachine(cfg, relay);

    // Log relay hostname only — full URL may contain environment-specific path segments
    const relayHost = (() => { try { return new URL(cfg.relayUrl).hostname; } catch { return cfg.relayUrl; } })();
    api.logger.info(
      `[ProjectAvatar] Plugin active — relay: ${relayHost}, ` +
      `debounce: ${cfg.debounceMs}ms, idle timeout: ${cfg.idleTimeoutMs}ms` +
      (cfg.enableAvatarTool ? ', avatar tool: enabled' : ''),
    );

    // ── Agent lifecycle hooks ─────────────────────────────────────────────────

    /**
     * message_received — user sent a message, agent is about to start thinking.
     * Explicitly reset prop and intensity to neutral so we don't inherit stale
     * state from the previous interaction (e.g. coffee_cup + high intensity
     * carrying over from a previous excited/celebrating state).
     */
    api.on('message_received', () => {
      sm.transition({ emotion: 'thinking', action: 'reading', prop: 'none', intensity: 'medium' });
    });

    /**
     * before_tool_call — agent decided to call a tool.
     * Falls back to a generic "focused/coding" signal for unrecognized tools
     * so the avatar always reacts to tool activity.
     */
    api.on('before_tool_call', (event) => {
      // Defensive: guard against unexpected event shapes from future API versions
      if (typeof event.toolName !== 'string') return;
      const signal = resolveToolSignal(event.toolName, 'before') ?? UNKNOWN_TOOL_BEFORE;
      sm.transition(signal);
    });

    /**
     * after_tool_call — tool finished (success or error).
     * Falls back to a generic "focused/responding" signal for unrecognized tools.
     */
    api.on('after_tool_call', (event) => {
      // Defensive: guard against unexpected event shapes from future API versions
      if (typeof event.toolName !== 'string') return;
      const errorStr = typeof event.error === 'string' ? event.error : undefined;
      const signal = resolveToolSignal(event.toolName, 'after', errorStr) ?? UNKNOWN_TOOL_AFTER;
      sm.transition(signal);
    });

    /**
     * agent_end — the agent finished its full response.
     * On error, use high intensity to convey urgency.
     * Schedules idle timeout regardless of outcome.
     */
    api.on('agent_end', (event) => {
      sm.transition(
        event.success
          ? { emotion: 'satisfied', action: 'responding', prop: 'none', intensity: 'medium' }
          : { emotion: 'concerned', action: 'error',      prop: 'none', intensity: 'high' },
      );
      sm.scheduleIdle();
    });

    /**
     * session_end — conversation over. Reset to idle immediately.
     *
     * reset() cancels all pending timers (debounce + idle), sets current = IDLE,
     * and pushes IDLE to the relay. The relay client is stateless (no keep-alive,
     * no retry queue) so no additional cleanup is needed.
     */
    api.on('session_end', () => {
      sm.reset();
    });

    // ── Optional explicit avatar tool ──────────────────────────────────────────

    if (cfg.enableAvatarTool) {
      api.registerTool(createAvatarTool(sm), { optional: true });
    }

    // ── /avatar command ────────────────────────────────────────────────────────

    if (typeof api.registerCommand === 'function') {
      api.registerCommand(
        'avatar',
        async (args) => {
          const token = getToken();
          if (!token) {
            return '[Avatar] AVATAR_TOKEN not set.\nRun: openclaw secrets set AVATAR_TOKEN <your-token>';
          }

          const sub = args[0] ?? 'link';

          if (sub === 'link') {
            const appBase = cfg.relayUrl
              .replace('relay.projectavatar.io', 'app.projectavatar.io')
              .replace(/\/+$/, '');
            return `[Avatar] Share link:\n${appBase}/?token=${token}`;
          }

          if (sub === 'status') {
            try {
              const res = await fetch(
                `${cfg.relayUrl}/channel/${encodeURIComponent(token)}/state`,
                { signal: AbortSignal.timeout(5_000) },
              );
              if (!res.ok) {
                return `[Avatar] Relay returned HTTP ${res.status}`;
              }
              const state = await res.json() as import('./types.js').ChannelStateResponse;
              const model    = state.model          ?? 'not selected';
              const clients  = state.connectedClients;
              const lastSeen = state.lastAgentEventAt
                ? `${Math.round((Date.now() - state.lastAgentEventAt) / 1_000)}s ago`
                : 'never';
              return (
                `[Avatar] Channel status:\n` +
                `  Model:       ${model}\n` +
                `  Viewers:     ${clients}\n` +
                `  Last event:  ${lastSeen}`
              );
            } catch {
              return '[Avatar] Could not reach relay — check AVATAR_RELAY_URL and network.';
            }
          }

          return '[Avatar] Usage:\n  /avatar link    — get your share URL\n  /avatar status  — show channel info';
        },
        { description: 'Project Avatar — get share link or channel status' },
      );
    }
  },
};

export default plugin;
export { plugin };
