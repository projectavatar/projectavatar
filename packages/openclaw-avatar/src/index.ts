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
import type { SessionMeta } from './relay-client.js';
import { createAvatarStateMachine } from './state-machine.js';
import { resolveToolSignal } from './tool-map.js';
import { createAvatarTool } from './avatar-tool.js';
import { createAvatarCommandTool } from './avatar-command-tool.js';
import { DEFAULT_CONFIG, validatePluginConfig } from './types.js';
import type { PluginConfig } from './types.js';

/**
 * Fallback signals for tool calls on tools not in the tool map.
 * The avatar should always react to tool activity, even for unknown tools.
 */
const UNKNOWN_TOOL_BEFORE: import('./types.js').AvatarSignal = { emotion: 'focused', action: 'coding', prop: 'none', intensity: 'medium' };
const UNKNOWN_TOOL_AFTER:  import('./types.js').AvatarSignal = { emotion: 'focused', action: 'responding', prop: 'none', intensity: 'medium' };

/**
 * Derive session priority from an OpenClaw sessionKey.
 *
 * OpenClaw sessionKey format:
 *   agent:<agentId>:<rest>
 *
 * Where <rest> for common session types:
 *   - Main/channel:   discord:guild-XXX:channel-YYY  → depth 0
 *   - Sub-agent:      subagent:<uuid>                 → depth 1
 *   - Nested:         subagent:<uuid>:subagent:<uuid> → depth 2
 *   - Cron:           cron:...                        → depth 1 (treated as background)
 *
 * Priority = number of ':subagent:' segments in the key (the subagent depth).
 * Main sessions = 0, sub-agents = 1, nested sub-agents = 2, etc.
 * Cron sessions start with 'cron:' in the rest segment — treated as priority 1.
 *
 * Two concurrent main sessions (same depth 0) will both have priority 0.
 * The relay breaks this tie via firstPushAt — first-mover holds the avatar.
 */
function deriveSessionPriority(sessionKey: string): number {
  const lower = sessionKey.toLowerCase();

  // Count ':subagent:' occurrences — each nesting level adds one
  let depth = 0;
  let pos   = 0;
  const marker = ':subagent:';
  while ((pos = lower.indexOf(marker, pos)) !== -1) {
    depth++;
    pos += marker.length;
  }
  if (depth > 0) return depth;

  // Cron sessions: agent:main:cron:... — treat as background (priority 1)
  // Parsed rest starts after "agent:<id>:"
  const parts = lower.split(':');
  const restStart = 2; // parts[0]='agent', parts[1]=agentId, parts[2+]=rest
  const restFirst = parts[restStart] ?? '';
  if (restFirst === 'cron') return 1;

  // Everything else is a main/channel session — priority 0
  return 0;
}

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
    //
    // Every hook receives `ctx` as the second argument (OpenClaw PluginHookAgentContext).
    // We extract `sessionKey` from ctx to derive session identity and priority for
    // relay arbitration. If ctx lacks sessionKey (old OpenClaw versions or unusual
    // hook types), we fall back to undefined — the relay treats it as a legacy push.

    /**
     * message_received — user sent a message, agent is about to start thinking.
     * Explicitly reset prop and intensity to neutral so we don't inherit stale
     * state from the previous interaction.
     */
    api.on('message_received', (_event, ctx) => {
      sm.transition(
        { emotion: 'thinking', action: 'reading', prop: 'none', intensity: 'medium' },
        deriveSessionMeta(ctx as Record<string, unknown>),
      );
    });

    /**
     * before_tool_call — agent decided to call a tool.
     * Falls back to a generic "focused/coding" signal for unrecognized tools.
     */
    api.on('before_tool_call', (event, ctx) => {
      if (typeof event.toolName !== 'string') return;
      const signal = resolveToolSignal(event.toolName, 'before') ?? UNKNOWN_TOOL_BEFORE;
      sm.transition(signal, deriveSessionMeta(ctx as Record<string, unknown>));
    });

    /**
     * after_tool_call — tool finished (success or error).
     */
    api.on('after_tool_call', (event, ctx) => {
      if (typeof event.toolName !== 'string') return;
      const errorStr = typeof event.error === 'string' ? event.error : undefined;
      const signal = resolveToolSignal(event.toolName, 'after', errorStr) ?? UNKNOWN_TOOL_AFTER;
      sm.transition(signal, deriveSessionMeta(ctx as Record<string, unknown>));
    });

    /**
     * agent_end — the agent finished its full response.
     * On error, use high intensity to convey urgency.
     * Schedules idle timeout regardless of outcome.
     */
    api.on('agent_end', (event, ctx) => {
      sm.transition(
        event.success
          ? { emotion: 'satisfied', action: 'responding', prop: 'none', intensity: 'medium' }
          : { emotion: 'concerned', action: 'error',      prop: 'none', intensity: 'high' },
        deriveSessionMeta(ctx as Record<string, unknown>),
      );
      sm.scheduleIdle();
    });

    /**
     * session_end — conversation over. Reset to idle immediately.
     *
     * Passing session metadata on the idle push ensures the relay can attribute
     * the final idle state to the correct session. The session entry expires
     * naturally after SESSION_EVICT_AFTER_MS regardless.
     */
    api.on('session_end', (_event, ctx) => {
      sm.reset(deriveSessionMeta(ctx as Record<string, unknown>));
    });

    // ── Optional explicit avatar tool ──────────────────────────────────────────

    if (cfg.enableAvatarTool) {
      api.registerTool(createAvatarTool(sm), { optional: true });
    }

    // ── /avatar command tool (for skill command-dispatch) ──────────────────────
    // Registered always so the skill's command-dispatch:tool can find it.
    // This avoids the registerCommand vs. user-invocable skill name collision
    // that causes the command to be deduped to /avatar_2 on Discord.
    api.registerTool(createAvatarCommandTool(cfg, getToken));

  },
};

export default plugin;
export { plugin };
