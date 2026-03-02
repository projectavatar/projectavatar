# @projectavatar/openclaw-avatar

## 2.0.1

### Patch Changes

- Fix repository URL on npm (points to projectavatar org)

## 2.0.0

### Breaking Changes

- **Simplified schema:** Emotions reduced from 14 → 10, actions from 29 → 12. Removed unused/redundant values (`focused`, `satisfied`, `concerned`, `relaxed` emotions; `responding`, `coding`, `reading`, `waiting`, `error`, `waving`, `pointing`, `fist_pump`, `sarcastic`, `looking_around`, `shading_eyes`, `telling_secret`, `victory`, `head_shake`, `relief`, `cautious_agree`, `angry_fist`, `rallying`, `sad_idle`, `nervous_look`, `terrified`, `scratching_head`, `cocky`, `questioning`, `phone` actions). If your agent prompt references removed values, update it.
- **Tag-based approach replaced with `avatar_signal` tool.** The plugin no longer injects `[avatar:{...}]` tags into agent responses. Instead, it registers a silent `avatar_signal` tool that the agent calls directly. No output filter needed.
- **`/avatar_commands` renamed to `/avatar`.** Slash command simplified.
- **License changed from MIT to AGPL-3.0-or-later.**
- **Repository moved to `projectavatar/projectavatar` org.**

### New Features

- **`avatar_signal` tool** — silent tool the agent calls to set emotion, action, prop, and intensity. Primary source of truth for avatar state. Replaces the tag extraction + output filter approach entirely.
- **`/avatar` command** — renamed from `/avatar_commands`. Subcommands: `link` (get share URL), `status` (model, viewer count, last event age).
- **Multi-session arbitration** — sessions include `sessionId` and `priority` in pushed events. Main sessions (priority 0) suppress sub-agents (priority 1) and background tasks (priority 2+). Priority derived automatically from OpenClaw session key nesting depth. Cron sessions treated as background.
- **Per-category cooldowns** — emotion and action changes are rate-limited independently to prevent visual jitter. High-priority emotions (confused, angry, surprised) bypass cooldowns. One-shot actions (celebrating, greeting) get extended cooldown protection.
- **Selective lifecycle hooks** — only high-signal tools trigger avatar state changes (exec, browser, tts, sessions_spawn, gateway). Routine tools (Read, Write, Edit, web_search) are intentionally silent to prevent jitter from multi-tool turns.
- **Session context inheritance** — `avatar_signal` tool calls skip lifecycle hooks to prevent echo loops. Session metadata (sessionKey, priority) derived and attached automatically.

### Bug Fixes

- Fix `registerCommand` crash — was using positional args instead of object API
- Fix broken template literal in startup log
- Fix dangling string concatenation in log line
- Fix lifecycle hook echo loop — `avatar_signal` calls no longer re-trigger hooks
- Remove dead `enableAvatarTool` config code path

### Internal

- Plugin manifest id changed from `projectavatar` to `openclaw-avatar` (matches npm package name)
- Compact prompt injection preserving user language
- Comprehensive test suite for tool map, state machine, relay client, session utils, and types

## 1.1.2

### Patch Changes

- b02fffb: Change plugin manifest id from `"projectavatar"` to `"openclaw-avatar"` to match the unscoped package name. This eliminates the "plugin id mismatch" warning on every gateway start. Config key changes from `plugins.entries.projectavatar` to `plugins.entries.openclaw-avatar`.
- 0f467c8: Fix `registerCommand` call to use the object API (`{ name, description, handler }`) instead of positional arguments. The old three-argument signature caused a `TypeError: Cannot read properties of undefined (reading 'trim')` crash during plugin registration.

## 1.1.1

### Patch Changes

- c356cf4: publish

## 1.1.0

### Minor Changes

- Initial release of the OpenClaw plugin — real-time 3D avatar driven by agent lifecycle hooks (`before_tool_call`, `after_tool_call`, `agent_end`, `message_received`, `session_end`).
- Tool signal map covering 20 tools (web_search, exec, browser, message, image, memory_search, etc.)
- Debouncing + emotion priority state machine
- Optional explicit `avatar` tool for LLM-driven state overrides
- Skill bundled for cross-platform fallback
