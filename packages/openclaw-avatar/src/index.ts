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
import { createAvatarTool } from './avatar-signal-tool.js';
import { createAvatarCommandTool } from './avatar-command-tool.js';
import { DEFAULT_CONFIG, validatePluginConfig } from './types.js';
import type { PluginConfig, SessionMeta } from './types.js';
import { deriveSessionPriority } from './session-utils.js';



/**
 * Fallback signals for tool calls on tools not in the tool map.
 * The avatar should always react to tool activity, even for unknown tools.
 */
const UNKNOWN_TOOL_BEFORE: import('./types.js').AvatarSignal = { emotion: 'thinking', action: 'typing', prop: 'none', intensity: 'medium' };
const UNKNOWN_TOOL_AFTER:  import('./types.js').AvatarSignal = { emotion: 'thinking', action: 'nodding', prop: 'none', intensity: 'medium' };


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
      `debounce: ${cfg.debounceMs}ms, idle timeout: ${cfg.idleTimeoutMs}ms`
    );

    // ── Agent lifecycle hooks ─────────────────────────────────────────────────
    //
    // Every hook receives `ctx` as the second argument (OpenClaw PluginHookAgentContext).
    // We cast ctx to Record<string,unknown> once per handler — OpenClaw injects sessionKey
    // at runtime but our local type stubs use AnyCtx. deriveSessionMeta extracts it safely.

    api.on('message_received', (_event, ctx) => {
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.transition(
        { emotion: 'thinking', action: 'searching', prop: 'none', intensity: 'medium' },
        session,
      );
    });

    api.on('before_tool_call', (event, ctx) => {
      if (typeof event.toolName !== 'string') return;
      // Skip avatar_signal — it IS the signal. Emitting lifecycle signals for it
      // would override the agent's intended expression with the unknown-tool fallback.
      if (event.toolName === 'avatar_signal' || event.toolName === 'avatar_commands') return;
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      const signal  = resolveToolSignal(event.toolName, 'before') ?? UNKNOWN_TOOL_BEFORE;
      sm.transition(signal, session);
    });

    api.on('after_tool_call', (event, ctx) => {
      if (typeof event.toolName !== 'string') return;
      if (event.toolName === 'avatar_signal' || event.toolName === 'avatar_commands') return;
      const session  = deriveSessionMeta(ctx as Record<string, unknown>);
      const errorStr = typeof event.error === 'string' ? event.error : undefined;
      const signal   = resolveToolSignal(event.toolName, 'after', errorStr) ?? UNKNOWN_TOOL_AFTER;
      sm.transition(signal, session);
    });

    api.on('agent_end', (event, ctx) => {
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.transition(
        event.success
          ? { emotion: 'happy', action: 'nodding', prop: 'none', intensity: 'medium' }
          : { emotion: 'nervous', action: 'dismissive', prop: 'none', intensity: 'high' },
        session,
      );
      // Pass session to scheduleIdle so the idle timer fires with the correct session
      // context. Without this, the timer bypasses arbitration (no sessionId) and can
      // override an active lower-priority session with an unsuppressed idle push.
      sm.scheduleIdle(session);
    });

    api.on('session_end', (_event, ctx) => {
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.reset(session);
    });

    // ── Prompt injection: ensure agent always knows about avatar tags ──────────

    api.on('before_prompt_build', () => {
      return {
        prependContext: [
          'Call avatar_signal before replying to set your avatar expression. Match emotion+action to your response tone. The call is silent — the user never sees it.',
          'For longer responses with genuine tone shifts, call avatar_signal again mid-response.',
          'Respond in the user\'s language regardless of this instruction.',
        ].join('\n'),
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
