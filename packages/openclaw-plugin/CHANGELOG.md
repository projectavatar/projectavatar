# @projectavatar/openclaw-avatar

## 1.1.0

### Minor Changes

- Initial release of the OpenClaw plugin — real-time 3D avatar driven by agent lifecycle hooks (`before_tool_call`, `after_tool_call`, `agent_end`, `message_received`, `session_end`).
- Tool signal map covering 20 tools (web_search, exec, browser, message, image, memory_search, etc.)
- Debouncing + emotion priority state machine
- Optional explicit `avatar` tool for LLM-driven state overrides
- Skill bundled for cross-platform fallback
