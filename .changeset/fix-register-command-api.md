---
"@projectavatar/openclaw-avatar": patch
---

Fix `registerCommand` call to use the object API (`{ name, description, handler }`) instead of positional arguments. The old three-argument signature caused a `TypeError: Cannot read properties of undefined (reading 'trim')` crash during plugin registration.
