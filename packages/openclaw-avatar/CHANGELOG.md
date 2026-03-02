# @projectavatar/openclaw-avatar

## 2.0.1

### Patch Changes

- Fix repository URL on npm (points to projectavatar org)

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
