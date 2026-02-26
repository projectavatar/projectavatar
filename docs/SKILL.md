# Agent Skill

The skill layer teaches your AI agent to emit avatar signals. It's two things:

1. **A prompt addition** — text you add to your agent's system prompt once
2. **An output filter** — a small script that intercepts signal tags, strips them from the response, and forwards them to the relay

Both are agent-agnostic. This works with OpenClaw, ChatGPT, Claude API, raw Ollama, LangChain — anything that lets you set a system prompt and intercept output.

---

## How It Works

```
Agent output (raw):
  "[avatar:{"emotion":"focused","action":"coding","prop":"keyboard"}]
   Here's how to fix the bug: change line 42 to..."

Output filter:
  1. Regex matches [avatar:{...}] at start of response
  2. Parses JSON payload
  3. Strips tag from text
  4. POSTs payload to relay: POST /push/:token
  5. Returns clean text to user

User sees:
  "Here's how to fix the bug: change line 42 to..."

Avatar reacts:
  → expression: focused
  → animation: typing
  → prop: keyboard appears in hand
```

---

## Prompt Template

Add this to your agent's system prompt. Put it near the end, after any other instructions.

```
## Avatar Presence

You have a visual avatar that reacts to your state in real-time. At the START of every
response, emit exactly one signal tag on its own line before your actual reply:

[avatar:{"emotion":"<emotion>","action":"<action>"}]

Available emotions: idle, thinking, focused, excited, confused, satisfied, concerned
Available actions: responding, searching, coding, reading, waiting, error, celebrating

Optional fields:
- "prop": keyboard | magnifying_glass | coffee_cup | book | phone | scroll | none
- "intensity": low | medium | high  (default: medium)

Examples:
[avatar:{"emotion":"focused","action":"coding","prop":"keyboard"}]
[avatar:{"emotion":"thinking","action":"searching","prop":"magnifying_glass"}]
[avatar:{"emotion":"excited","action":"responding"}]
[avatar:{"emotion":"confused","action":"error","intensity":"high"}]
[avatar:{"emotion":"satisfied","action":"celebrating"}]

Rules:
- Always emit exactly one tag at the very start of your response
- The tag appears BEFORE your reply, on its own line
- Choose the emotion and action that genuinely match what you're doing
- The tag is invisible to the user — do not mention it or reference it
- Do not explain the tag or the avatar system in your responses
```

**Token budget:** The prompt addition is ~200 tokens. The tag itself is ~30 tokens per response. Acceptable overhead for the functionality it enables.

---

## Output Filter: Node.js

### Installation

```bash
npm install @project-avatar/filter
```

### Basic Usage (non-streaming)

```typescript
import { filterResponse } from '@project-avatar/filter';

const config = {
  relayUrl: 'https://relay.projectavatar.dev',
  token: 'your-token-here',
  enabled: true,
};

// After getting the agent's response:
const cleanText = await filterResponse(rawResponse, config);
// → cleanText has the [avatar:...] tag stripped
// → event was pushed to relay asynchronously
```

### Streaming Usage

```typescript
import { StreamingAvatarFilter } from '@project-avatar/filter';

const filter = new StreamingAvatarFilter(config, (cleanChunk) => {
  // Forward clean chunk to user
  process.stdout.write(cleanChunk);
});

// Feed chunks as they arrive:
for await (const chunk of agentStream) {
  filter.processChunk(chunk);
}
filter.flush();
```

### Manual (no package)

Copy `skill/filters/node/filter.ts` directly into your project. It has no dependencies beyond `fetch` (built into Node 18+).

```typescript
const AVATAR_TAG_REGEX = /^\[avatar:(\{[^}]+\})\]\s*\n?/m;

export async function filterResponse(text: string, config: FilterConfig): Promise<string> {
  try {
    const match = text.match(AVATAR_TAG_REGEX);
    if (!match) return text;

    const event = JSON.parse(match[1]);
    const cleanText = text.replace(match[0], '').trimStart();

    // Fire and forget — never block on relay push
    fetch(`${config.relayUrl}/push/${config.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => {}); // Non-critical

    return cleanText;
  } catch {
    return text; // On any failure, return original text unmodified
  }
}
```

---

## Output Filter: Python

```python
pip install httpx  # Only dependency
```

```python
# Copy from skill/filters/python/filter.py

import re
import json
import asyncio
import httpx
from typing import Optional, Tuple

AVATAR_TAG_PATTERN = re.compile(r'^\[avatar:(\{[^}]+\})\]\s*\n?', re.MULTILINE)

async def filter_response(text: str, relay_url: str, token: str) -> str:
    match = AVATAR_TAG_PATTERN.search(text)
    if not match:
        return text

    try:
        event = json.loads(match.group(1))
        clean_text = (text[:match.start()] + text[match.end():]).lstrip()

        # Fire and forget
        asyncio.create_task(push_event(relay_url, token, event))

        return clean_text
    except Exception:
        return text  # Never fail the user

async def push_event(relay_url: str, token: str, event: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(f"{relay_url}/push/{token}", json=event)
    except Exception:
        pass
```

---

## OpenClaw Integration

For OpenClaw, install the skill package:

```bash
# In your OpenClaw workspace
cp -r /path/to/projectavatar/skill/openclaw ~/.openclaw/workspace/skills/avatar
```

Then add to your OpenClaw config or SOUL.md system prompt:

```json
{
  "skills": {
    "avatar": {
      "enabled": true,
      "env": {
        "AVATAR_RELAY_URL": "https://relay.projectavatar.dev",
        "AVATAR_TOKEN": "your-token-here"
      }
    }
  }
}
```

The OpenClaw skill handles:
- Injecting the prompt template into the agent's system context
- Intercepting responses via OpenClaw's output middleware hook
- Stripping tags and pushing to relay automatically

---

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `AVATAR_RELAY_URL` | Relay server base URL | `https://relay.projectavatar.dev` |
| `AVATAR_TOKEN` | Your relay token (required) | — |
| `AVATAR_ENABLED` | Enable/disable avatar signaling | `true` |
| `AVATAR_BUFFER_LIMIT` | Max chars to buffer for tag detection in streams | `200` |

---

## Testing Your Setup

### 1. Test the prompt

Ask your agent: *"What emotion and action are you emitting right now?"*

A correctly prompted agent will say something like "I'm currently in a focused/responding state" without mentioning the tag explicitly, and its response will start with `[avatar:{...}]`.

### 2. Test the filter

Run the filter against a test string:

```bash
node -e "
const { filterResponse } = require('@project-avatar/filter');
const raw = '[avatar:{\"emotion\":\"focused\",\"action\":\"coding\"}]\nHere is your answer.';
filterResponse(raw, { relayUrl: 'https://relay.projectavatar.dev', token: 'test', enabled: false })
  .then(clean => console.log('Clean:', clean));
"
```

Expected output: `Clean: Here is your answer.`

### 3. Test the full pipeline

With the avatar app open and connected:

```bash
curl -X POST https://relay.projectavatar.dev/push/YOUR_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"emotion":"excited","action":"celebrating"}'
```

The avatar should immediately react. If it does, the whole pipeline works.

---

## Troubleshooting

**The tag is showing up in chat.**

The filter isn't running, or it's running after the response is sent to the user. Make sure `filterResponse()` is called before the clean text reaches the output. For streaming, use `StreamingAvatarFilter`.

**The avatar isn't reacting.**

Check in order:
1. Is the avatar app open and showing "Connected"?
2. Is the relay URL correct in the filter config?
3. Is the token the same in both the filter config and the avatar app?
4. Run the curl test above to verify the relay is reachable.
5. Check the relay health: `GET https://relay.projectavatar.dev/health`

**The agent sometimes skips the tag.**

This happens with smaller/faster models that deprioritize format instructions under load. Try moving the prompt addition to the very top of the system prompt (highest priority position) or making the instruction more emphatic: *"ALWAYS begin every response with [avatar:{...}] — this is mandatory."*

**The tag is malformed (JSON parse error).**

The filter silently passes through malformed tags. To debug: log `text.match(/^\[avatar:[^\]]+\]/)` to see what the agent is actually emitting. Common issue: the model uses single quotes instead of double quotes in the JSON. Add to the prompt: *"The JSON inside the tag must use double quotes."*

**Streaming: the tag appears split across chunks.**

This is the streaming buffer's job — it accumulates the first 200 chars before deciding whether a tag is present. If the agent emits a very long tag (unlikely), increase `AVATAR_BUFFER_LIMIT`.
