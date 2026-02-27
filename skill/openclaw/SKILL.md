---
# AUTO-GENERATED — do not edit directly.
# Source: packages/shared/src/skill-template.ts
# Regenerate: npm run gen:skill
name: avatar
description: "Real-time 3D avatar that reacts to your emotional state and actions. Emit one [avatar:{...}] tag per response."
metadata:
  {
    "openclaw":
      {
        "emoji": "🧿",
        "requires": { "env": ["AVATAR_TOKEN"] },
      },
  }
---

# Avatar Skill

## Configuration
```
AVATAR_TOKEN: YOUR_TOKEN_HERE
AVATAR_RELAY_URL: https://relay.projectavatar.io
```

## Your Avatar URL
https://app.projectavatar.io/?token=YOUR_TOKEN_HERE

Open this URL to see your avatar. Share it with OBS as a browser source.
If you ever need to find your avatar again, it's the URL above — I have it stored here.

## What This Skill Does
You have a visual avatar at https://app.projectavatar.io/?token=YOUR_TOKEN_HERE that reacts to your emotional state and
actions in real-time. This skill teaches you to emit avatar signals with every response
so your avatar stays in sync with what you're doing.

## Instructions

At the START of every response, emit exactly one signal tag on its own line **before**
your reply text:

```
[avatar:{"emotion":"<emotion>","action":"<action>"}]
```

**Available emotions:** idle, thinking, focused, excited, confused, satisfied, concerned, happy, angry, sad, relaxed, surprised, bashful, nervous

**Available actions:** idle, talking, typing, nodding, waving, greeting, laughing, pointing, fist_pump, dismissive, plotting, sarcastic, looking_around, shading_eyes, telling_secret, victory, head_shake, relief, cautious_agree, angry_fist, rallying, sad_idle, nervous_look, terrified, scratching_head, cocky, questioning, phone, celebrating

**Optional fields:**
- `"prop"`: keyboard, magnifying_glass, coffee_cup, book, phone, scroll, none
- `"intensity"`: low, medium, high (default: medium)

**Examples:**
```
[avatar:{"emotion":"focused","action":"typing","prop":"keyboard"}]
[avatar:{"emotion":"thinking","action":"shading_eyes","prop":"magnifying_glass"}]
[avatar:{"emotion":"excited","action":"waving"}]
[avatar:{"emotion":"confused","action":"head_shake","intensity":"high"}]
[avatar:{"emotion":"satisfied","action":"celebrating"}]
```

## Rules
- **Always** emit exactly one tag at the very start of your response
- The tag appears BEFORE your reply, on its own line
- Choose the emotion and action that genuinely match what you're doing
- The tag is stripped automatically before the user sees your response
- Do **not** mention, reference, or explain the avatar system in your responses
- The JSON inside the tag must use **double quotes**

## Output Filter Configuration

To strip avatar tags and forward them to the relay, configure your output filter:

```json
{
  "relayUrl": "https://relay.projectavatar.io",
  "token": "YOUR_TOKEN_HERE",
  "enabled": true
}
```

Filter implementations (Node.js and Python) are available in the project repo.

## Verification

To test the full pipeline, open your avatar at:
https://app.projectavatar.io/?token=YOUR_TOKEN_HERE

Then push a test event:
```bash
curl -X POST https://relay.projectavatar.io/push/YOUR_TOKEN_HERE \\
  -H "Content-Type: application/json" \\
  -d '{"emotion":"excited","action":"celebrating"}'
```

Your avatar should react immediately. If it does, the pipeline works end-to-end.
