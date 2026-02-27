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
import { createAvatarCommandTool } from './avatar-command-tool.js';
import { DEFAULT_CONFIG, validatePluginConfig } from './types.js';
import type { PluginConfig, SessionMeta } from './types.js';
import { deriveSessionPriority } from './session-utils.js';

// ─── Tag extraction (inline — plugin is standalone, no dep on skill/filters) ──

const AVATAR_TAG_REGEX = /^\[avatar:(\{[^}]+\})\]\s*\n?/m;

function extractAndStripTag(text: string): { cleanText: string; tagEvent: import('./types.js').AvatarSignal | null } {
  try {
    const match = text.match(AVATAR_TAG_REGEX);
    if (!match) return { cleanText: text, tagEvent: null };

    const parsed = JSON.parse(match[1]);
    if (typeof parsed.emotion !== 'string' && typeof parsed.action !== 'string') {
      return { cleanText: text, tagEvent: null };
    }

    const cleanText = text.replace(match[0], '').trimStart();
    const tagEvent: import('./types.js').AvatarSignal = {};
    if (typeof parsed.emotion === 'string') tagEvent.emotion = parsed.emotion;
    if (typeof parsed.action === 'string') tagEvent.action = parsed.action;
    if (typeof parsed.prop === 'string') tagEvent.prop = parsed.prop;
    if (typeof parsed.intensity === 'string') tagEvent.intensity = parsed.intensity;

    return { cleanText, tagEvent };
  } catch {
    return { cleanText: text, tagEvent: null };
  }
}

/**
 * Fallback signals for tool calls on tools not in the tool map.
 * The avatar should always react to tool activity, even for unknown tools.
 */
const UNKNOWN_TOOL_BEFORE: import('./types.js').AvatarSignal = { emotion: 'focused', action: 'typing', prop: 'none', intensity: 'medium' };
const UNKNOWN_TOOL_AFTER:  import('./types.js').AvatarSignal = { emotion: 'focused', action: 'nodding', prop: 'none', intensity: 'medium' };


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
      `debounce: ${cfg.debounceMs}ms, idle timeout: ${cfg.idleTimeoutMs}ms` +
      (cfg.enableAvatarTool ? ', avatar tool: enabled' : ''),
    );

    // ── Agent lifecycle hooks ─────────────────────────────────────────────────
    //
    // Every hook receives `ctx` as the second argument (OpenClaw PluginHookAgentContext).
    // We cast ctx to Record<string,unknown> once per handler — OpenClaw injects sessionKey
    // at runtime but our local type stubs use AnyCtx. deriveSessionMeta extracts it safely.

    api.on('message_received', (_event, ctx) => {
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.transition(
        { emotion: 'thinking', action: 'looking_around', prop: 'none', intensity: 'medium' },
        session,
      );
    });

    api.on('before_tool_call', (event, ctx) => {
      if (typeof event.toolName !== 'string') return;
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      const signal  = resolveToolSignal(event.toolName, 'before') ?? UNKNOWN_TOOL_BEFORE;
      sm.transition(signal, session);
    });

    api.on('after_tool_call', (event, ctx) => {
      if (typeof event.toolName !== 'string') return;
      const session  = deriveSessionMeta(ctx as Record<string, unknown>);
      const errorStr = typeof event.error === 'string' ? event.error : undefined;
      const signal   = resolveToolSignal(event.toolName, 'after', errorStr) ?? UNKNOWN_TOOL_AFTER;
      sm.transition(signal, session);
    });

    api.on('agent_end', (event, ctx) => {
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.transition(
        event.success
          ? { emotion: 'satisfied', action: 'nodding', prop: 'none', intensity: 'medium' }
          : { emotion: 'concerned', action: 'head_shake',  prop: 'none', intensity: 'high' },
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
          '## Avatar Signal',
          'At the START of every response, emit one tag on its own line before your reply to express your emotion and action related to the current context:',
          '[avatar:{"emotion":"<emotion>","action":"<action>"}]',
          'Emotions: idle, thinking, focused, excited, confused, satisfied, concerned, happy, angry, sad, relaxed, surprised, bashful, nervous',
          'Actions: idle, talking, typing, nodding, waving, greeting, laughing, pointing, fist_pump, dismissive, plotting, sarcastic, looking_around, shading_eyes, telling_secret, victory, head_shake, relief, cautious_agree, angry_fist, rallying, sad_idle, nervous_look, terrified, scratching_head, cocky, questioning, phone, celebrating',
          'Optional: "prop" (keyboard|magnifying_glass|coffee_cup|book|phone|scroll|none), "intensity" (low|medium|high)',
          'The tag is stripped automatically. Never mention the avatar. Use double quotes in JSON.',
        ].join('\n'),
      };
    });

    // ── Output filter: extract [avatar:{...}] tags before message reaches user ──

    api.on('message_sending', (event, ctx) => {
      if (!event.content || typeof event.content !== 'string') return;

      const { cleanText, tagEvent } = extractAndStripTag(event.content);
      if (!tagEvent) return;

      // Push the tag event to the relay
      const session = deriveSessionMeta(ctx as Record<string, unknown>);
      sm.transition(tagEvent, session);

      // Return modified content with the tag stripped
      return { content: cleanText };
    });

    // ── Optional explicit avatar tool ──────────────────────────────────────────

    if (cfg.enableAvatarTool) {
      api.registerTool(createAvatarTool(sm), { optional: true });
    }

    // ── /avatar command tool ───────────────────────────────────────────────────

    api.registerTool(createAvatarCommandTool(cfg, getToken));
  },
};

export default plugin;
export { plugin };
