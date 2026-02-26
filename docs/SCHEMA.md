# Avatar Signal Schema Specification

Version: `1.0.0`

This document defines the complete schema for avatar signal events — the structured data that drives the avatar's expression, animation, and props.

---

## Table of Contents

1. [Overview](#overview)
2. [Signal Format](#signal-format)
3. [JSON Schema](#json-schema)
4. [Field Reference](#field-reference)
5. [Output Filter Behavior](#output-filter-behavior)
6. [Examples](#examples)
7. [Versioning](#versioning)

---

## Overview

An avatar signal is a JSON object embedded in the agent's response as a tagged string. The tag format is:

```
[avatar:{"emotion":"<emotion>","action":"<action>"}]
```

The tag appears at the **start** of the agent's response, on its own line. The output filter extracts it, strips it from the visible response, and forwards the parsed JSON to the relay server.

**Design constraints:**
- Must be emittable by any LLM (no special tokens, just plain text JSON)
- Must be unambiguous to parse (unique delimiter, no collision with natural language)
- Must be small (< 200 bytes typical, under token budget pressure)
- Must degrade gracefully (missing fields use defaults, malformed tags are ignored)

---

## Signal Format

### Tag Syntax

```
[avatar:<json>]
```

Where `<json>` is a valid JSON object with no nested objects or arrays.

**Rules:**
- The tag MUST start with `[avatar:` (case-sensitive)
- The JSON MUST be a single-line object (no newlines within the JSON)
- The tag MUST end with `]`
- The tag SHOULD appear at the very start of the response
- The tag SHOULD be followed by a newline (but the filter handles missing newlines)
- There SHOULD be exactly one tag per response (if multiple exist, only the first is extracted)

### Wire Format (Relay)

Once extracted by the output filter, the JSON payload is sent to the relay server as a standard JSON HTTP body:

```json
{
  "emotion": "focused",
  "action": "coding",
  "prop": "keyboard",
  "intensity": "medium"
}
```

The relay wraps it in an envelope for WebSocket delivery:

```json
{
  "type": "avatar_event",
  "data": {
    "emotion": "focused",
    "action": "coding",
    "prop": "keyboard",
    "intensity": "medium"
  },
  "timestamp": 1709913600000,
  "replay": false
}
```

---

## JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://projectavatar.dev/schema/avatar-event.v1.json",
  "title": "AvatarEvent",
  "description": "An avatar signal event describing the agent's current emotional state and action.",
  "type": "object",
  "required": ["emotion", "action"],
  "additionalProperties": false,
  "properties": {
    "emotion": {
      "type": "string",
      "enum": ["idle", "thinking", "focused", "excited", "confused", "satisfied", "concerned"],
      "description": "The agent's current emotional state. Drives facial expression blend shapes."
    },
    "action": {
      "type": "string",
      "enum": ["responding", "searching", "coding", "reading", "waiting", "error", "celebrating"],
      "description": "The agent's current action. Drives body animation clip selection."
    },
    "prop": {
      "type": "string",
      "enum": ["none", "keyboard", "magnifying_glass", "coffee_cup", "book", "phone", "scroll"],
      "default": "none",
      "description": "Optional reactive prop to display. Appears in the avatar's hand."
    },
    "intensity": {
      "type": "string",
      "enum": ["low", "medium", "high"],
      "default": "medium",
      "description": "Animation and expression intensity. Affects blend shape weights and animation speed."
    }
  }
}
```

### TypeScript Type

```typescript
// packages/shared/src/schema.ts

export const EMOTIONS = ['idle', 'thinking', 'focused', 'excited', 'confused', 'satisfied', 'concerned'] as const;
export const ACTIONS = ['responding', 'searching', 'coding', 'reading', 'waiting', 'error', 'celebrating'] as const;
export const PROPS = ['none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll'] as const;
export const INTENSITIES = ['low', 'medium', 'high'] as const;

export type Emotion = typeof EMOTIONS[number];
export type Action = typeof ACTIONS[number];
export type Prop = typeof PROPS[number];
export type Intensity = typeof INTENSITIES[number];

export interface AvatarEvent {
  emotion: Emotion;
  action: Action;
  prop?: Prop;
  intensity?: Intensity;
}
```

### Validation Function

```typescript
export function validateAvatarEvent(event: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof event !== 'object' || event === null) {
    return { ok: false, error: 'Event must be an object' };
  }

  const e = event as Record<string, unknown>;

  if (!e.emotion || !EMOTIONS.includes(e.emotion as Emotion)) {
    return { ok: false, error: `Invalid emotion: ${e.emotion}. Must be one of: ${EMOTIONS.join(', ')}` };
  }

  if (!e.action || !ACTIONS.includes(e.action as Action)) {
    return { ok: false, error: `Invalid action: ${e.action}. Must be one of: ${ACTIONS.join(', ')}` };
  }

  if (e.prop !== undefined && !PROPS.includes(e.prop as Prop)) {
    return { ok: false, error: `Invalid prop: ${e.prop}. Must be one of: ${PROPS.join(', ')}` };
  }

  if (e.intensity !== undefined && !INTENSITIES.includes(e.intensity as Intensity)) {
    return { ok: false, error: `Invalid intensity: ${e.intensity}. Must be one of: ${INTENSITIES.join(', ')}` };
  }

  return { ok: true };
}
```

---

## Field Reference

### `emotion` (required)

The agent's emotional state. Maps to VRM facial expression blend shapes.

| Value | Description | VRM Expressions Used | When to Use |
|-------|-------------|---------------------|-------------|
| `idle` | Neutral, at rest | `neutral` (1.0) | No active task, waiting for input |
| `thinking` | Processing, deliberating | `neutral` (0.7), `lookUp` (0.3) | Analyzing a problem, planning response |
| `focused` | Concentrated, determined | `neutral` (0.5), `serious`* (0.5) | Writing code, detailed analysis |
| `excited` | Enthusiastic, energized | `happy` (0.8), `surprised` (0.2) | Found a solution, greeting, good news |
| `confused` | Uncertain, puzzled | `surprised` (0.4), `neutral` (0.3) | Ambiguous input, unexpected error |
| `satisfied` | Content, accomplished | `happy` (0.6), `relaxed` (0.4) | Task completed successfully |
| `concerned` | Worried, cautious | `sad` (0.3), `serious`* (0.4) | Warning about risks, bad news |

*`serious` is a custom expression that may not exist on all VRM models. Falls back to `neutral` with `angry` (0.2) on models without it.

### `action` (required)

The agent's current activity. Maps to body animation clips.

| Value | Description | Animation Clip | When to Use |
|-------|-------------|---------------|-------------|
| `responding` | Speaking, answering | Talking (mouth movement, gestures) | General text responses |
| `searching` | Looking something up | Looking around, hand to chin | Web search, file search, lookup |
| `coding` | Writing code | Typing animation, focused posture | Code generation, debugging |
| `reading` | Processing input | Eyes scanning, slight head nod | Reading user's message, analyzing docs |
| `waiting` | Idle, between tasks | Gentle breathing, subtle sway | Waiting for user input |
| `error` | Something went wrong | Confused scratch, slight recoil | Error encountered, task failed |
| `celebrating` | Success! | Fist pump, happy bounce | Major achievement, task completed well |

### `prop` (optional, default: `"none"`)

A reactive object that appears in the avatar's hand.

| Value | 3D Model | Natural Pairing |
|-------|---------|----------------|
| `none` | — | Any (removes current prop) |
| `keyboard` | Floating holographic keyboard | `coding` |
| `magnifying_glass` | Magnifying glass | `searching` |
| `coffee_cup` | Coffee mug | `waiting`, `idle` |
| `book` | Open book | `reading` |
| `phone` | Smartphone | `searching`, `responding` |
| `scroll` | Scroll/document | `reading`, `responding` |

Props are suggestions, not hard rules. The agent can pair any prop with any action. The "natural pairing" column is guidance for the agent prompt, not enforcement.

### `intensity` (optional, default: `"medium"`)

Controls the energy level of expressions and animations.

| Value | Expression Scale | Animation Speed | When to Use |
|-------|-----------------|----------------|-------------|
| `low` | 0.5x blend weights | 0.7x speed | Calm, casual, background task |
| `medium` | 1.0x (default) | 1.0x (default) | Normal operation |
| `high` | 1.2x blend weights (clamped to 1.0) | 1.3x speed | Urgent, excited, critical error |

---

## Output Filter Behavior

### Regex Pattern

```
/^\[avatar:(\{[^}]+\})\]\s*\n?/m
```

**Breakdown:**
- `^` — Start of line (with `m` flag: any line, not just start of string)
- `\[avatar:` — Literal tag prefix
- `(\{[^}]+\})` — Capture group: JSON object (assumes no nested objects — our schema has none)
- `\]` — Literal tag suffix
- `\s*\n?` — Optional trailing whitespace and newline
- `m` — Multiline flag (for `^` to match line starts)

### Strip Behavior

1. The regex matches the **first** occurrence of the tag in the response
2. The entire match (tag + trailing whitespace/newline) is removed
3. Any leading whitespace on the remaining text is trimmed
4. The cleaned text is returned to the user

**Example:**

Input (agent response):
```
[avatar:{"emotion":"focused","action":"coding","prop":"keyboard"}]
Here's how to fix that memory leak:

```python
# ... code ...
```
```

After filter:
```
Here's how to fix that memory leak:

```python
# ... code ...
```
```

### Edge Cases

| Scenario | Behavior |
|----------|---------|
| No tag present | Text passes through unmodified |
| Malformed JSON in tag | Text passes through unmodified |
| Tag in middle of response | Matched and stripped (multiline flag) |
| Multiple tags | Only first is extracted; rest remain (unusual, but safe) |
| Empty JSON `[avatar:{}]` | Tag stripped; missing fields cause validation failure at relay; no event pushed |
| Extra fields in JSON | Ignored (filter extracts; relay validates with `additionalProperties: false`) |
| Nested objects `[avatar:{"foo":{"bar":1}}]` | Regex won't match (no `}` inside capture). Tag passes through unmodified. |
| Very long JSON | Regex limits: `{[^}]+}` matches up to first `}`. Extremely long single-level objects are fine. |

### Streaming Behavior

When the agent streams tokens:

1. The filter buffers the first 200 characters
2. On each chunk, checks if a complete tag is present in the buffer
3. If found: extracts, strips, pushes to relay, flushes remaining buffer + continues streaming
4. If 200 chars buffered without finding a tag: gives up, flushes entire buffer as-is
5. All subsequent chunks pass through directly

The 200-character buffer is generous — a maximal tag is ~120 characters. The buffer limit prevents indefinite delay if the agent doesn't emit a tag.

---

## Examples

### Every Emotion × Action Combination

Here are representative examples. Not every combination is listed — the full matrix is 7 × 7 = 49 combinations, and all are valid.

#### Thinking

```json
[avatar:{"emotion":"thinking","action":"searching","prop":"magnifying_glass"}]
```
Agent is researching something, hasn't formed an opinion yet.

```json
[avatar:{"emotion":"thinking","action":"reading"}]
```
Agent is processing the user's long message.

#### Focused

```json
[avatar:{"emotion":"focused","action":"coding","prop":"keyboard","intensity":"high"}]
```
Agent is deep in a complex code generation task.

```json
[avatar:{"emotion":"focused","action":"reading","prop":"book"}]
```
Agent is carefully analyzing documentation or a long code snippet.

#### Excited

```json
[avatar:{"emotion":"excited","action":"responding","intensity":"high"}]
```
Agent found the answer and is eager to share.

```json
[avatar:{"emotion":"excited","action":"celebrating"}]
```
Agent completed a major task successfully.

#### Confused

```json
[avatar:{"emotion":"confused","action":"error"}]
```
Agent encountered an unexpected error.

```json
[avatar:{"emotion":"confused","action":"searching","prop":"magnifying_glass"}]
```
Agent is trying to figure out an ambiguous request.

#### Satisfied

```json
[avatar:{"emotion":"satisfied","action":"responding"}]
```
Agent is wrapping up after a successful task.

```json
[avatar:{"emotion":"satisfied","action":"waiting","prop":"coffee_cup"}]
```
Task complete, relaxing while waiting for next input.

#### Concerned

```json
[avatar:{"emotion":"concerned","action":"responding"}]
```
Agent is delivering a warning or bad news.

```json
[avatar:{"emotion":"concerned","action":"reading","intensity":"high"}]
```
Agent found something alarming in the code or data.

#### Idle

```json
[avatar:{"emotion":"idle","action":"waiting","prop":"coffee_cup"}]
```
Agent has nothing to do. Sipping coffee.

```json
[avatar:{"emotion":"idle","action":"waiting"}]
```
Minimal signal — agent at rest.

### Minimal Valid Event

```json
{"emotion":"idle","action":"responding"}
```

Only `emotion` and `action` are required. `prop` defaults to `"none"`, `intensity` defaults to `"medium"`.

### Maximal Valid Event

```json
{"emotion":"excited","action":"celebrating","prop":"scroll","intensity":"high"}
```

All fields specified.

---

## Versioning

### Strategy

The schema uses semantic versioning: `MAJOR.MINOR.PATCH`.

- **MAJOR** (breaking): Removing or renaming fields, changing field types, removing enum values
- **MINOR** (additive): Adding new enum values, adding optional fields
- **PATCH** (cosmetic): Documentation fixes, example updates

### Version Negotiation

The WebSocket envelope includes the schema version in the relay response:

```json
{
  "type": "avatar_event",
  "version": "1.0.0",
  "data": { ... },
  "timestamp": 1709913600000
}
```

The avatar app checks the version:
- Same MAJOR: proceed normally (MINOR/PATCH differences are forward-compatible)
- Different MAJOR: warn the user that the skill and app may be out of sync

### Evolution Rules

**Adding a new emotion** (e.g., `amused`):
- Schema version: 1.1.0 (MINOR)
- Relay accepts it immediately (enum validation is updated)
- Avatar app: unknown emotions fall back to `idle` (graceful degradation)
- Skill prompt: updated to include new emotion

**Adding a new field** (e.g., `speech_text` for lip sync):
- Schema version: 1.1.0 (MINOR)
- Existing clients ignore unknown fields
- New clients use it if present

**Changing field type** (e.g., `intensity` from enum to float):
- Schema version: 2.0.0 (MAJOR)
- Requires coordinated update of filter, relay, and app
- Migration guide in release notes

### Backwards Compatibility Promise

v1.x avatar apps MUST handle:
- Unknown emotion values (fall back to `idle`)
- Unknown action values (fall back to `waiting`)
- Unknown prop values (fall back to `none`)
- Unknown fields (ignore them)
- Missing optional fields (use defaults)

This ensures a newer skill can talk to an older app without breaking.
