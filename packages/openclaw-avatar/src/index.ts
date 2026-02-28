/**
 * @projectavatar/openclaw-avatar — OpenClaw plugin
 *
 * A first-class OpenClaw plugin that hooks into the agent lifecycle to drive
 * a real-time 3D VRM avatar. The avatar reacts to what the agent is *doing*
 * (via before_tool_call / after_tool_call) — not just what it says.
 *
 * SIGNAL PHILOSOPHY:
 *   The agent's `avatar_signal` tool is the PRIMARY source of truth — it knows
 *   the intent behind each reply. Lifecycle hooks only fire for high-signal
 *   tools (exec, browser, tts, etc.). Routine tools (Read, Write, Edit, etc.)
 *   are intentionally silent — they produce visual jitter when 5+ fire per turn.
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
import { createAvatarTool } from './avatar-signal-tool.js';
import { createAvatarCommandTool } from './avatar-command-tool.js';
import { DEFAULT_CONFIG, validatePluginConfig } from './types.js';
import type { PluginConfig, SessionMeta } from './types.js';
import { deriveSessionPriority } from './session-utils.js';


/**
 * Derive a SessionMeta from an OpenClaw hook context object.
 *
 * Returns undefined if the context lacks a sessionKey (old OpenClaw versions
 * or unusual hook invocations) — the relay treats absent sessionId as a legacy
 * single-session push that always fans out.
 */
function deriveSessionMeta(ctx: Record<string, unknown>): SessionMeta | undefined {
  const sessionKey = typeof ctx['sessionKey'] === 'string' ? ctx['sessionKey'] : undefined;
  if (!sessionKey) return undefined;

  return {
    sessionId: sessionKey,
    priority:  deriveSessionPriority(sessionKey),
  };
}

const plugin: OpenClawPluginDefinition = {
  // id matches the unscoped package name so OpenClaw's idHint derivation
  // produces no mismatch warning. Users reference this as plugins.entries.openclaw-avatar.
  id: 'openclaw-avatar',
  name: 'Project Avatar',
  description: 'Real-time 3D avatar driven by agent lifecycle hooks.',

  register(api: OpenClawPluginApi): void {
    // ── Config ──────────────────────────────────────────────────────────────

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

    const relayHost = (() => { try { return new URL(cfg.relayUrl).hostname; } catch { return cfg.relayUrl; } })();
    api.logger.info(
      `[ProjectAvatar] Plugin active — relay: ${relayHost}, ` +
      `idle timeout: ${cfg.idleTimeoutMs}ms, ` +
      `cooldowns: emotion=${cfg.emotionCooldownMs}ms action=${cfg.actionCooldownMs}ms oneshot=${cfg.oneShotCooldownMs}ms`
    );

    // ── Agent lifecycle hooks ─────────────────────────────────────────────────
    //
    // SIGNAL REDUCTION: Only emotion on message_received (no action change).
    // Tool hooks only fire for high-signal tools in the tool map — unknown
    // tools are silently ignored (no fallback signal).

    api.on('message_received', (_event, ctx) => {
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      // Emotion-only signal: let the agent's avatar_signal pick the action
      sm.transition({ emotion: 'thinking' }, session);
    });

    api.on('before_tool_call', (event, ctx) => {
      if (typeof event.toolName !== 'string') return;
      // Skip avatar_signal — it IS the signal
      if (event.toolName === 'avatar_signal' || event.toolName === 'avatar_commands') return;
      const signal = resolveToolSignal(event.toolName, 'before');
      // No fallback for unmapped tools — let the agent's avatar_signal handle it
      if (!signal) return;
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.transition(signal, session);
    });

    api.on('after_tool_call', (event, ctx) => {
      if (typeof event.toolName !== 'string') return;
      if (event.toolName === 'avatar_signal' || event.toolName === 'avatar_commands') return;
      const errorStr = typeof event.error === 'string' ? event.error : undefined;
      const signal = resolveToolSignal(event.toolName, 'after', errorStr);
      if (!signal) return;
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.transition(signal, session);
    });

    api.on('agent_end', (event, ctx) => {
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      // Only signal on error — success is handled by the agent's final avatar_signal
      if (!event.success) {
        sm.transition(
          { emotion: 'nervous', action: 'dismissive', prop: 'none', intensity: 'high' },
          session,
        );
      }
      sm.scheduleIdle(session);
    });

    api.on('session_end', (_event, ctx) => {
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.reset(session);
    });

    // ── Prompt injection: ensure agent always knows about avatar tags ──────────

    api.on('before_prompt_build', () => {
      return {
        prependContext: 'Call avatar_signal before each reply. Respond in the user\'s language.',
      };
    });

    // ── Avatar signal tool — always registered ────────────────────────────────

    api.registerTool(createAvatarTool(sm));

    // ── /avatar command tool ───────────────────────────────────────────────────

    api.registerTool(createAvatarCommandTool(cfg, getToken));
  },
};

export default plugin;
export { plugin };
