/**
 * OpenClaw output filter hook for the Avatar skill.
 *
 * This file is loaded by OpenClaw as an output middleware hook. It intercepts
 * each agent response, strips the avatar tag, and forwards the event to the
 * relay in the background.
 *
 * Hook signature matches OpenClaw's skill output filter API:
 *   (text: string, ctx: HookContext) => Promise<string>
 *
 * OpenClaw calls this BEFORE the response is delivered to the user. The
 * returned string is what the user actually sees. Never reject or throw —
 * always return a string (the clean text, or the original if something fails).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractAvatarTag, pushToRelay } from '../node/filter.js';
import type { FilterConfig } from '../node/filter.js';

// ─── Config loading ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Cached config — loaded once on first use */
let _config: FilterConfig | null = null;

function loadConfig(): FilterConfig {
  if (_config) return _config;

  try {
    const configPath = join(__dirname, 'config.json');
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FilterConfig>;

    if (!parsed.relayUrl || !parsed.token || parsed.token === 'YOUR_TOKEN_HERE') {
      if (process.env.AVATAR_DEBUG) {
        console.warn('[avatar-skill] config.json not configured — filter disabled');
      }
      return { relayUrl: '', token: '', enabled: false };
    }

    _config = {
      relayUrl: parsed.relayUrl,
      token: parsed.token,
      enabled: parsed.enabled !== false,
    };

    return _config;
  } catch {
    // Config missing or unreadable — disable filter, don't crash
    return { relayUrl: '', token: '', enabled: false };
  }
}

// ─── Hook context type ────────────────────────────────────────────────────────

/**
 * OpenClaw hook context passed to output filter hooks.
 * Fields relevant to this filter — the full interface may have more.
 */
interface HookContext {
  /** The session/conversation this response belongs to */
  sessionKey?: string;
  /** Whether the response is streaming (token-by-token) vs complete */
  streaming?: boolean;
  /** Any skill-specific metadata */
  meta?: Record<string, unknown>;
}

// ─── OpenClaw output filter hook ─────────────────────────────────────────────

/**
 * Main hook — called by OpenClaw for every agent response.
 *
 * @param text    The raw agent response text (may include avatar tag)
 * @param ctx     OpenClaw hook context
 * @returns       Clean text (avatar tag stripped), to be shown to the user
 */
export async function onOutput(text: string, _ctx?: HookContext): Promise<string> {
  try {
    const config = loadConfig();
    const { cleanText, avatarEvent } = extractAvatarTag(text);

    if (avatarEvent && config.enabled) {
      // Fire and forget — never block response delivery
      void pushToRelay(config, avatarEvent);
    }

    return cleanText;
  } catch {
    // Catch-all safety net — always return something
    return text;
  }
}

/**
 * Default export for OpenClaw's dynamic import / hook resolution.
 * OpenClaw may expect either a named export or a default export depending
 * on its skill API version. Exporting both covers both conventions.
 */
export default onOutput;
