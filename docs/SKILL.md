# Agent Skill

The skill layer teaches your AI agent to emit avatar signals via response tags. It works with **any agent** — not just OpenClaw — by adding a prompt template and an output filter to your setup.

**If you use OpenClaw:** install the `@projectavatar/openclaw-avatar` plugin instead. It's hook-driven, requires no prompt changes, and reacts in real-time to tool calls — not just response output. See [the plugin docs](../packages/openclaw-plugin/README.md) or run:
```bash
openclaw plugins install @projectavatar/openclaw-avatar
openclaw secrets set AVATAR_TOKEN <your-token>
```

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

## One-URL Install (Recommended)

**Step 1:** Open [app.projectavatar.io](https://app.projectavatar.io) — your token is generated automatically.

**Step 2:** Click "Get Setup Link". You get a URL like:
```
https://relay.projectavatar.io/skill/install?token=A3x9kQmP2nR7vB4w...
```

**Step 3:** Go to your agent and say:
```
Install this as a skill: https://relay.projectavatar.io/skill/install?token=A3x9kQmP...
```

The agent fetches the URL, receives a complete SKILL.md with your token already inside, and installs it. Done.

**Security note:** The setup link contains your token. Don't share it publicly.

---

## Prompt Template

Add this to your agent's system prompt:

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
- The JSON inside the tag must use double quotes
```

**Token budget:** ~200 tokens for the prompt addition, ~30 tokens per response for the tag.

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
  relayUrl: 'https://relay.projectavatar.io',
  token: 'your-token-here',
  enabled: true,
};

const cleanText = await filterResponse(rawResponse, config);
```

### Streaming Usage

```typescript
import { StreamingAvatarFilter } from '@project-avatar/filter';

const filter = new StreamingAvatarFilter(config, (cleanChunk) => {
  process.stdout.write(cleanChunk);
});

for await (const chunk of agentStream) {
  filter.processChunk(chunk);
}
filter.flush();
```

### Manual (no package)

Copy `skill/filters/node/filter.ts` directly into your project — no dependencies beyond `fetch` (built into Node 18+).

```typescript
const AVATAR_TAG_REGEX = /^\[avatar:(\{[^}]+\})\]\s*\n?/m;

export async function filterResponse(text: string, config: FilterConfig): Promise<string> {
  try {
    const match = text.match(AVATAR_TAG_REGEX);
    if (!match) return text;

    const event = JSON.parse(match[1]);
    const cleanText = text.replace(match[0], '').trimStart();

    fetch(`${config.relayUrl}/push/${config.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => {}); // Non-critical

    return cleanText;
  } catch {
    return text;
  }
}
```

---

## Output Filter: Python

```bash
pip install httpx
```

```python
import re, json, asyncio, httpx

AVATAR_TAG_PATTERN = re.compile(r'^\[avatar:(\{[^}]+\})\]\s*\n?', re.MULTILINE)

async def filter_response(text: str, relay_url: str, token: str) -> str:
    match = AVATAR_TAG_PATTERN.search(text)
    if not match:
        return text
    try:
        event = json.loads(match.group(1))
        clean_text = (text[:match.start()] + text[match.end():]).lstrip()
        asyncio.create_task(push_event(relay_url, token, event))
        return clean_text
    except Exception:
        return text

async def push_event(relay_url: str, token: str, event: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(f"{relay_url}/push/{token}", json=event)
    except Exception:
        pass
```

---

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `AVATAR_RELAY_URL` | Relay server base URL | `https://relay.projectavatar.io` |
| `AVATAR_TOKEN` | Your relay token (required) | — |
| `AVATAR_ENABLED` | Enable/disable avatar signaling | `true` |
| `AVATAR_BUFFER_LIMIT` | Max chars to buffer for tag detection in streams | `200` |

---

## Testing Your Setup

### Test the relay directly

```bash
curl -X POST https://relay.projectavatar.io/push/YOUR_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"emotion":"excited","action":"celebrating"}'
```

The avatar should react immediately. If it does, the pipeline works.

### Test the filter

```bash
node -e "
const { filterResponse } = require('@project-avatar/filter');
const raw = '[avatar:{\"emotion\":\"focused\",\"action\":\"coding\"}]\nHere is your answer.';
filterResponse(raw, { relayUrl: 'https://relay.projectavatar.io', token: 'test', enabled: false })
  .then(clean => console.log('Clean:', clean));
"
```

Expected: `Clean: Here is your answer.`

---

## Troubleshooting

**The tag is showing up in chat.**
The filter isn't running before the response reaches the user. For streaming, use `StreamingAvatarFilter`.

**The avatar isn't reacting.**
1. Is the avatar app open and showing "Connected"?
2. Is the relay URL correct?
3. Is the token the same in both filter config and avatar app?
4. Run the curl test above to verify the relay is reachable.
5. Check relay health: `GET https://relay.projectavatar.io/health`

**The agent sometimes skips the tag.**
Move the prompt addition to the very top of the system prompt or make the instruction more emphatic. Common with smaller models.

**The tag is malformed.**
The filter silently passes through malformed tags. Log `text.match(/^\[avatar:[^\]]+\]/)` to debug. Most common cause: model uses single quotes instead of double quotes.

**Streaming: tag appears split across chunks.**
Increase `AVATAR_BUFFER_LIMIT`. The streaming buffer accumulates the first 200 chars before deciding whether a tag is present.
