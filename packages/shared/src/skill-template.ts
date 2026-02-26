/**
 * Skill document template — single source of truth for what agents receive
 * when they fetch /skill/install?token=...
 *
 * This template is used by:
 *   - relay/src/skill-install.ts  → generates the per-token document served at runtime
 *   - scripts/gen-skill-md.ts     → generates skill/openclaw/SKILL.md for the repo
 *
 * Placeholders (replaced at render time):
 *   {{TOKEN}}       – the user's relay token
 *   {{RELAY_URL}}   – relay base URL (e.g. https://relay.projectavatar.io)
 *   {{AVATAR_URL}}  – full avatar app URL with token + model params
 *   {{EMOTIONS}}    – comma-separated emotion enum values
 *   {{ACTIONS}}     – comma-separated action enum values
 *   {{PROPS}}       – comma-separated prop enum values (excluding "none")
 *   {{INTENSITIES}} – comma-separated intensity enum values
 *
 * The template uses plain {{PLACEHOLDER}} syntax (no delimiters that could
 * conflict with markdown code fences or JSON examples).
 */

import { EMOTIONS, ACTIONS, PROPS, INTENSITIES } from './schema.js';

export const SKILL_TEMPLATE = `# Avatar Skill

## Configuration
\`\`\`
AVATAR_TOKEN: {{TOKEN}}
AVATAR_RELAY_URL: {{RELAY_URL}}
\`\`\`

## Your Avatar URL
{{AVATAR_URL}}

Open this URL to see your avatar. Share it with OBS as a browser source.
If you ever need to find your avatar again, it's the URL above — I have it stored here.

## What This Skill Does
You have a visual avatar at {{AVATAR_URL}} that reacts to your emotional state and
actions in real-time. This skill teaches you to emit avatar signals with every response
so your avatar stays in sync with what you're doing.

## Instructions

At the START of every response, emit exactly one signal tag on its own line **before**
your reply text:

\`\`\`
[avatar:{"emotion":"<emotion>","action":"<action>"}]
\`\`\`

**Available emotions:** {{EMOTIONS}}

**Available actions:** {{ACTIONS}}

**Optional fields:**
- \`"prop"\`: {{PROPS}}, none
- \`"intensity"\`: {{INTENSITIES}} (default: medium)

**Examples:**
\`\`\`
[avatar:{"emotion":"focused","action":"coding","prop":"keyboard"}]
[avatar:{"emotion":"thinking","action":"searching","prop":"magnifying_glass"}]
[avatar:{"emotion":"excited","action":"responding"}]
[avatar:{"emotion":"confused","action":"error","intensity":"high"}]
[avatar:{"emotion":"satisfied","action":"celebrating"}]
\`\`\`

## Rules
- **Always** emit exactly one tag at the very start of your response
- The tag appears BEFORE your reply, on its own line
- Choose the emotion and action that genuinely match what you're doing
- The tag is stripped automatically before the user sees your response
- Do **not** mention, reference, or explain the avatar system in your responses
- The JSON inside the tag must use **double quotes**

## Output Filter Configuration

To strip avatar tags and forward them to the relay, configure your output filter:

\`\`\`json
{
  "relayUrl": "{{RELAY_URL}}",
  "token": "{{TOKEN}}",
  "enabled": true
}
\`\`\`

Filter implementations (Node.js and Python) are available in the project repo.

## Verification

To test the full pipeline, open your avatar at:
{{AVATAR_URL}}

Then push a test event:
\`\`\`bash
curl -X POST {{RELAY_URL}}/push/{{TOKEN}} \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"emotion":"excited","action":"celebrating"}'
\`\`\`

Your avatar should react immediately. If it does, the pipeline works end-to-end.
`;

export interface SkillDocParams {
  token: string;
  relayUrl: string;
  avatarUrl: string;
}

/**
 * Render the skill document template with the given parameters.
 * Enum values are interpolated from the shared schema — they stay in sync automatically.
 */
export function renderSkillDoc(params: SkillDocParams): string {
  const emotions = EMOTIONS.join(', ');
  const actions = ACTIONS.join(', ');
  const props = PROPS.filter((p) => p !== 'none').join(', ');
  const intensities = INTENSITIES.join(', ');

  return SKILL_TEMPLATE
    .replaceAll('{{TOKEN}}', params.token)
    .replaceAll('{{RELAY_URL}}', params.relayUrl)
    .replaceAll('{{AVATAR_URL}}', params.avatarUrl)
    .replaceAll('{{EMOTIONS}}', emotions)
    .replaceAll('{{ACTIONS}}', actions)
    .replaceAll('{{PROPS}}', props)
    .replaceAll('{{INTENSITIES}}', intensities);
}
