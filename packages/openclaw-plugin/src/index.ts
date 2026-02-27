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
    // The message "using defaults for invalid fields" is now true: invalid fields
    // are stripped from the sanitized object and fall back to DEFAULT_CONFIG.
    const { errors, sanitized } = validatePluginConfig(api.pluginConfig ?? {});
    if (errors.length > 0) {
      api.logger.warn(
        `[ProjectAvatar] Invalid plugin config — invalid fields reset to defaults. Errors: ${errors.join('; ')}`,
      );
    }

    const cfg: PluginConfig = { ...DEFAULT_CONFIG, ...sanitized };

    if (!cfg.enabled) {
      api.logger.info('Project Avatar plugin disabled via config.');
      return;
    }

    // ── Token ───────────────────────────────────────────────────────────────

    const token = process.env.AVATAR_TOKEN ?? '';
    if (!token) {
      api.logger.warn(
        '[ProjectAvatar] AVATAR_TOKEN not set — plugin loaded but will not push events. ' +
        'Set via: openclaw secrets set AVATAR_TOKEN <your-token>',
      );
      return;
    }

    // ── Core services ────────────────────────────────────────────────────────

    const relay = createRelayClient(cfg, token);
    const sm = createAvatarStateMachine(cfg, relay);

    // ── Agent lifecycle hooks ─────────────────────────────────────────────────

    /**
     * message_received — user sent a message, agent is about to start thinking.
     * Transition to thinking/reading immediately.
     */
    api.on('message_received', () => {
      sm.transition({ emotion: 'thinking', action: 'reading' });
    });

    /**
     * before_tool_call — agent decided to call a tool.
     * This fires before the tool executes, giving the avatar real-time reactivity.
     */
    api.on('before_tool_call', (event) => {
      const signal = resolveToolSignal(event.toolName, 'before');
      if (signal) sm.transition(signal);
    });

    /**
     * after_tool_call — tool finished (success or error).
     * Update avatar based on outcome.
     */
    api.on('after_tool_call', (event) => {
      const signal = resolveToolSignal(event.toolName, 'after', event.error);
      if (signal) sm.transition(signal);
    });

    /**
     * agent_end — the agent finished its full response.
     * Transition to satisfied (success) or concerned (error), then schedule idle.
     */
    api.on('agent_end', (event) => {
      sm.transition(
        event.success
          ? { emotion: 'satisfied', action: 'responding' }
          : { emotion: 'concerned', action: 'error' },
      );
      sm.scheduleIdle();
    });

    /**
     * session_end — conversation over. Reset to idle immediately.
     */
    api.on('session_end', () => {
      sm.reset();
    });

    // ── Optional explicit avatar tool ──────────────────────────────────────────

    if (cfg.enableAvatarTool) {
      api.registerTool(createAvatarTool(sm), { optional: true });
    }

    api.logger.info(
      `[ProjectAvatar] Plugin active — relay: ${cfg.relayUrl}, ` +
      `debounce: ${cfg.debounceMs}ms, idle timeout: ${cfg.idleTimeoutMs}ms` +
      (cfg.enableAvatarTool ? ', avatar tool: enabled' : ''),
    );
  },
};

export default plugin;
export { plugin };
