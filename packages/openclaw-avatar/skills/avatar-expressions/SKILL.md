---
name: avatar-expressions
description: "Emit VRM expression + animation tags at the start of each response for the real-time 3D avatar."
user-invocable: false
metadata: {"openclaw": {"emoji": "🧿", "requires": {"env": ["AVATAR_TOKEN"]}}}
---

# Avatar Expressions

You have a visual avatar that reacts to your emotional state and actions in real-time.
At the START of every response, emit exactly one signal tag on its own line **before**
your reply text:

```
[avatar:{"emotion":"<emotion>","action":"<action>"}]
```

**Emotions** (VRM 1.0 facial expressions):
idle, thinking, focused, excited, confused, satisfied, concerned, happy, angry, sad, relaxed, surprised, bashful, nervous

**Actions** (body animations):
idle, talking, typing, nodding, waving, greeting, laughing, pointing, fist_pump, dismissive, plotting, sarcastic, looking_around, shading_eyes, telling_secret, victory, head_shake, relief, cautious_agree, angry_fist, rallying, sad_idle, nervous_look, terrified, scratching_head, cocky, questioning, phone, celebrating

**Optional fields:**
- `"prop"`: keyboard, magnifying_glass, coffee_cup, book, phone, scroll, none
- `"intensity"`: low, medium, high (default: medium)

**Quick reference:**

| Situation | Example tag |
|-----------|-------------|
| Writing code | `[avatar:{"emotion":"focused","action":"typing","prop":"keyboard"}]` |
| Searching for info | `[avatar:{"emotion":"thinking","action":"shading_eyes","prop":"magnifying_glass"}]` |
| Greeting / enthusiastic | `[avatar:{"emotion":"excited","action":"waving"}]` |
| Task completed | `[avatar:{"emotion":"satisfied","action":"celebrating"}]` |
| Something went wrong | `[avatar:{"emotion":"confused","action":"head_shake","intensity":"high"}]` |
| Waiting for input | `[avatar:{"emotion":"idle","action":"idle","prop":"coffee_cup"}]` |
| Delivering a warning | `[avatar:{"emotion":"concerned","action":"cautious_agree"}]` |
| Sharing a secret/tip | `[avatar:{"emotion":"bashful","action":"telling_secret"}]` |
| Explaining with humor | `[avatar:{"emotion":"happy","action":"laughing"}]` |
| Scheming / planning | `[avatar:{"emotion":"thinking","action":"plotting"}]` |

**Rules:**
- Always emit exactly one tag at the very start of your response
- The tag appears on its own line, then your reply begins on the next line
- Choose emotion and action that genuinely match what you're doing
- The tag is stripped automatically — the user never sees it
- Do not mention, reference, or explain the avatar in your responses
- JSON inside the tag must use double quotes
