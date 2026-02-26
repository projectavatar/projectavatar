# Avatar Skill (OpenClaw)

Emit avatar signals with every response so your 3D avatar at app.projectavatar.io
reacts to what you're doing in real-time.

## Installation

The easiest way to install: tell your agent to fetch the setup link:

```
Install this as a skill: https://relay.projectavatar.io/skill/install?token=YOUR_TOKEN
```

The agent fetches the URL, receives this document with your token pre-baked, and
the skill is live immediately.

---

## How to Use This Skill

Every time you respond, emit exactly **one** avatar signal tag at the very start
of your response, on its own line:

```
[avatar:{"emotion":"<emotion>","action":"<action>"}]
```

The OpenClaw output filter intercepts this tag, strips it before the user sees your
response, and pushes the event to the relay in the background.

### Signal Reference

**Emotions:**
- `idle` — neutral, at rest
- `thinking` — processing, deliberating
- `focused` — concentrated, determined
- `excited` — enthusiastic, energized
- `confused` — uncertain, puzzled
- `satisfied` — content, accomplished
- `concerned` — worried, cautious

**Actions:**
- `responding` — speaking, answering
- `searching` — looking something up
- `coding` — writing code
- `reading` — processing input
- `waiting` — idle, between tasks
- `error` — something went wrong
- `celebrating` — success!

**Props (optional):**
- `keyboard` — appears on `coding`
- `magnifying_glass` — appears on `searching`
- `coffee_cup` — appears on `waiting` / `idle`
- `book` — appears on `reading`
- `phone` — general purpose
- `scroll` — reading / thinking
- `none` — no prop (default)

**Intensity (optional):**
- `low` — calm, background task
- `medium` — normal operation (default)
- `high` — urgent, excited, critical

### Examples

Starting a code response:
```
[avatar:{"emotion":"focused","action":"coding","prop":"keyboard"}]
```

Searching for something:
```
[avatar:{"emotion":"thinking","action":"searching","prop":"magnifying_glass"}]
```

Completing a task with flair:
```
[avatar:{"emotion":"satisfied","action":"celebrating","intensity":"high"}]
```

Something went wrong:
```
[avatar:{"emotion":"confused","action":"error","intensity":"high"}]
```

Chilling between tasks:
```
[avatar:{"emotion":"idle","action":"waiting","prop":"coffee_cup"}]
```

---

## Rules

1. **Always** emit exactly one tag at the very start of your response
2. The tag appears BEFORE your reply, on its own line
3. Your reply text begins on the next line after the tag
4. Choose emotion + action that **genuinely match** what you're doing
5. The tag is stripped automatically — the user never sees it
6. Do **not** mention, reference, or explain the avatar in your responses
7. JSON inside the tag must use double quotes
8. No nested objects in the JSON

---

## OpenClaw Integration

The `filter.ts` file in this directory is the OpenClaw output hook. It's loaded
automatically by OpenClaw when this skill is active.

The filter config is stored in `config.json`:

```json
{
  "relayUrl": "https://relay.projectavatar.io",
  "token": "YOUR_TOKEN_HERE",
  "enabled": true
}
```

To configure: update `config.json` with your relay URL and token, or install via
the one-URL method above (token is pre-baked automatically).

---

## Verification

Open your avatar at `https://app.projectavatar.io/?token=YOUR_TOKEN`, then push a
test event:

```bash
curl -X POST https://relay.projectavatar.io/push/YOUR_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"emotion":"excited","action":"celebrating"}'
```

The avatar should react immediately. If it does, the pipeline is working end-to-end.
