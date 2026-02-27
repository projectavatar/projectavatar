---
"@projectavatar/openclaw-avatar": patch
---

Change plugin manifest id from `"projectavatar"` to `"openclaw-avatar"` to match the unscoped package name. This eliminates the "plugin id mismatch" warning on every gateway start. Config key changes from `plugins.entries.projectavatar` to `plugins.entries.openclaw-avatar`.
