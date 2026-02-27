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
import type { PluginConfig, AvatarSignal } from './types.js';

/**
 * Avatar tag regex — non-global, used inside the handler as a fresh instance.
 *
 * ⚠️  Do NOT add the `g` flag here. A module-level global regex retains
 * `lastIndex` state between calls, causing intermittent missed matches when
 * used with `.test()` or `.exec()`. We use a fresh regex per invocation instead,
 * and call `.replace()` with this pattern inline for stripping.
 *
 * Note: `[^}]+` intentionally does not match nested braces — our signal schema
 * is flat. If the schema ever gains nested objects, switch to a proper JSON parser.
 */
const AVATAR_TAG_PATTERN = /^\[avatar:(\{[^}]+\})\]\s*\n?/m;

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

    // ── Prompt injection (when suppressSkillTags is true) ─────────────────────

    /**
     * before_prompt_build — inject a short context block telling the agent
     * it has a plugin-driven avatar and should NOT emit [avatar:...] tags.
     *
     * Guard: skip if the skill prompt is already present in the system prompt
     * (skill and plugin active simultaneously → plugin takes precedence).
     */
    if (cfg.suppressSkillTags) {
      api.on('before_prompt_build', (event) => {
        // Detect if the skill's tag-emission prompt is already active.
        // Use a specific sentinel from the skill SKILL.md rather than the
        // generic '[avatar:' string, which could appear in examples or docs.
        const alreadyHasSkillPrompt = typeof event.prompt === 'string' &&
          event.prompt.includes('[avatar:{"emotion"');

        if (alreadyHasSkillPrompt) return undefined;

        return {
          prependContext: [
            '## Avatar Presence',
            '',
            'You have a live 3D avatar that reacts to your actions in real-time.',
            'Avatar state is managed automatically by a plugin that observes your tool calls.',
            'Do NOT emit [avatar:{...}] tags — the plugin handles all signaling.',
            cfg.enableAvatarTool
              ? 'Use the `avatar` tool only when you want to express a state explicitly (e.g. during long reasoning).'
              : '',
          ].filter(Boolean).join('\n'),
        };
      });
    }

    // ── Tag suppression — strip residual [avatar:{...}] from outgoing messages ─

    /**
     * message_sending — strip any avatar tags that leaked through.
     *
     * Always active regardless of suppressSkillTags: if the skill prompt is active
     * alongside the plugin, or the LLM ignores the "don't emit tags" instruction,
     * tags must never reach the user. Tag stripping is unconditional.
     *
     * Before stripping, push the first tag's event to the relay — the LLM may
     * have emitted a genuinely meaningful state alongside its message.
     *
     * Returns undefined (no change) when no tags are present — OpenClaw treats
     * undefined as "pass through unchanged," not as "empty content."
     */
    api.on('message_sending', (event) => {
      // Fresh regex per call — avoids lastIndex state from a module-level global regex
      const tagRe = new RegExp(AVATAR_TAG_PATTERN.source, 'gm');

      if (!AVATAR_TAG_PATTERN.test(event.content)) return undefined;

      // Capture and push the first tag's event to the relay before stripping
      try {
        const firstMatch = AVATAR_TAG_PATTERN.exec(event.content);
        if (firstMatch?.[1]) {
          const parsed = JSON.parse(firstMatch[1]) as Record<string, unknown>;
          // Validate before transitioning — LLMs can emit garbage
          const emotion   = typeof parsed.emotion   === 'string' ? parsed.emotion   : undefined;
          const action    = typeof parsed.action    === 'string' ? parsed.action    : undefined;
          const prop      = typeof parsed.prop      === 'string' ? parsed.prop      : undefined;
          const intensity = typeof parsed.intensity === 'string' ? parsed.intensity : undefined;
          if (emotion && action) {
            sm.transition({ emotion, action, prop, intensity } as AvatarSignal);
          }
        }
      } catch {
        // Malformed tag — ignore, just strip it
      }

      // Strip ALL avatar tags using the global version of the pattern
      const cleaned = event.content.replace(tagRe, '').trimStart();

      // Only return a mutation if content actually changed
      return cleaned !== event.content ? { content: cleaned } : undefined;
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
