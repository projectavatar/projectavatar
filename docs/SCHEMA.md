# Avatar Signal Schema

Version: `1.0.0`

The structured data that drives the avatar's expression, animation, and props.

---

## Signal Format

Avatar signals are JSON objects pushed to the relay server via HTTP POST. For OpenClaw users, the `@projectavatar/openclaw-avatar` plugin emits signals automatically from agent lifecycle hooks. For other agents, a skill teaches the agent to emit `[avatar:{...}]` tags in its output, which an output filter strips and forwards.

### Tag Syntax (non-OpenClaw agents)

```
[avatar:{"emotion":"happy","action":"talking"}]
```

- Starts with `[avatar:` (case-sensitive), ends with `]`
- Single-line JSON object, no nested objects/arrays
- One tag per response (first match wins)
- Output filter strips the tag before the user sees it

### Wire Format

The relay receives the JSON payload via `POST /push/:token`:

```json
{
  "emotion": "happy",
  "action": "talking",
  "intensity": "medium"
}
```

And wraps it for WebSocket delivery:

```json
{
  "type": "avatar_event",
  "version": "1.0.0",
  "data": {
    "emotion": "happy",
    "action": "talking",
    "intensity": "medium"
  },
  "timestamp": 1700000000000,
  "replay": false
}
```

---

## Field Reference

### `emotion` (required)

The agent's emotional state. Maps to VRM facial expression blend shapes.

| Value | VRM Expressions | When to Use |
|-------|----------------|-------------|
| `idle` | neutral (1.0) | No active task, waiting for input |
| `thinking` | neutral (0.4), lookUp (0.45) | Analyzing, planning a response |
| `excited` | happy (1.0), surprised (0.35) | Found a solution, good news |
| `confused` | surprised (0.65), neutral (0.2) | Ambiguous input, unexpected result |
| `happy` | happy (1.0) | Positive outcome, greeting |
| `angry` | angry (1.0) | Error, frustration |
| `sad` | sad (1.0) | Bad news, failure |
| `surprised` | surprised (1.0) | Unexpected input |
| `bashful` | happy (0.4), neutral (0.5) | Flattered, shy |
| `nervous` | neutral (0.3), surprised (0.4) | Uncertain, anxious |

### `action` (required)

The agent's current activity. Maps to body animation clips.

| Value | Description |
|-------|-------------|
| `idle` | At rest, waiting for input |
| `talking` | Speaking, responding |
| `typing` | Writing code, text input |
| `nodding` | Agreeing, acknowledging |
| `laughing` | Amused |
| `celebrating` | Success, achievement |
| `dismissive` | Brushing off, unimpressed |
| `searching` | Looking something up |
| `nervous` | Anxious body language |
| `sad` | Dejected posture |
| `plotting` | Scheming, deep thought |
| `greeting` | Waving, hello |

### `prop` (optional, default: `"none"`)

A 3D object positioned in world space, configured per-clip in clips.json.

| Value | Description |
|-------|-------------|
| `none` | No prop (default) |
| `keyboard` | Holographic keyboard |
| `magnifying_glass` | Magnifying glass |
| `coffee_cup` | Coffee mug |
| `book` | Open book |
| `phone` | Smartphone |
| `scroll` | Scroll/document |

Props are positioned in world space (not hand-bone attached). Transform, position, and material style (holographic/solid/ghostly) are configured per-clip in `clips.json`.

### `intensity` (optional, default: `"medium"`)

Controls expression strength and animation energy.

| Value | Expression Scale | Description |
|-------|-----------------|-------------|
| `low` | 0.5x | Calm, casual |
| `medium` | 1.0x | Normal operation |
| `high` | 1.2x (clamped) | Urgent, excited |

### `sessionId` (optional)

Opaque string identifying the agent session. Used by the relay for multi-session arbitration — lower-priority sessions are suppressed while a higher-priority session is active.

### `priority` (optional, default: `0`)

Session priority for arbitration. Lower number = higher priority.

| Value | Meaning |
|-------|---------|
| 0 | Main/interactive session |
| 1 | Sub-agent |
| 2+ | Background tasks |

---

## TypeScript Types

```typescript
type Emotion = 'idle' | 'thinking' | 'excited' | 'confused' | 'happy'
             | 'angry' | 'sad' | 'surprised' | 'bashful' | 'nervous';

type Action = 'idle' | 'talking' | 'typing' | 'nodding' | 'laughing'
            | 'celebrating' | 'dismissive' | 'searching' | 'nervous'
            | 'sad' | 'plotting' | 'greeting';

type Prop = 'none' | 'keyboard' | 'magnifying_glass' | 'coffee_cup'
          | 'book' | 'phone' | 'scroll';

type Intensity = 'low' | 'medium' | 'high';

interface AvatarEvent {
  emotion: Emotion;
  action: Action;
  prop?: Prop;
  intensity?: Intensity;
  sessionId?: string;
  priority?: number;
}
```

Source of truth: `packages/shared/src/schema.ts`

---

## Validation

The relay validates all incoming events via `validateAvatarEvent()`:

- `emotion` and `action` are required and must be valid enum values
- `prop`, `intensity`, `sessionId`, `priority` are optional
- Unknown fields are rejected (strict schema)
- Invalid events return HTTP 400 with a descriptive error message

---

## Examples

```json
// Minimal
{ "emotion": "idle", "action": "idle" }

// Typical agent response
{ "emotion": "thinking", "action": "typing", "intensity": "medium" }

// With prop
{ "emotion": "happy", "action": "typing", "prop": "keyboard", "intensity": "high" }

// Multi-session
{ "emotion": "excited", "action": "celebrating", "sessionId": "agent:main", "priority": 0 }
```
