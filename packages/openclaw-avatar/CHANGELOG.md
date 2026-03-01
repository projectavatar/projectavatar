# @projectavatar/openclaw-avatar

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
