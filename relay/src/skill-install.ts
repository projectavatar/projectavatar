import { isValidToken } from '../../packages/shared/src/constants.js';
import { CORS_HEADERS } from './channel.js';

/**
 * GET /skill/install?token=:token
 *
 * Serves a pre-configured SKILL.md with the token baked in.
 * The user can tell their agent "install this skill: <URL>" and it
 * will receive ready-to-use instructions including the relay token.
 *
 * No auth required — the token itself is the secret. Anyone who
 * has the URL can install the skill for that channel.
 */
export async function handleSkillInstall(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const relayBase = `${url.protocol}//${url.host}`;
  const avatarBase = relayBase.replace('relay.', 'avatar.');

  if (!token || !isValidToken(token)) {
    return new Response(
      JSON.stringify({ error: 'Invalid or missing token. Provide ?token=<your-token>' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      },
    );
  }

  const skillDoc = generateSkillDoc(token, relayBase, avatarBase);

  return new Response(skillDoc, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'inline; filename="avatar-skill.md"',
      // Short-lived: discourage caching to avoid stale tokens
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

function generateSkillDoc(token: string, relayUrl: string, avatarUrl: string): string {
  return `# Avatar Skill

## Configuration
\`\`\`
AVATAR_TOKEN: ${token}
AVATAR_RELAY_URL: ${relayUrl}
\`\`\`

## What This Skill Does
You have a visual avatar at ${avatarUrl} that reacts to your emotional state and
actions in real-time. This skill teaches you to emit avatar signals with every response
so your avatar stays in sync with what you're doing.

## Instructions

At the START of every response, emit exactly one signal tag on its own line **before**
your reply text:

\`\`\`
[avatar:{"emotion":"<emotion>","action":"<action>"}]
\`\`\`

**Available emotions:** idle, thinking, focused, excited, confused, satisfied, concerned

**Available actions:** responding, searching, coding, reading, waiting, error, celebrating

**Optional fields:**
- \`"prop"\`: keyboard | magnifying_glass | coffee_cup | book | phone | scroll | none
- \`"intensity"\`: low | medium | high (default: medium)

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
  "relayUrl": "${relayUrl}",
  "token": "${token}",
  "enabled": true
}
\`\`\`

Filter implementations (Node.js and Python) are available in the project repo.

## Verification

To test the full pipeline, open your avatar at:
${avatarUrl}/?token=${token}

Then push a test event:
\`\`\`bash
curl -X POST ${relayUrl}/push/${token} \\
  -H "Content-Type: application/json" \\
  -d '{"emotion":"excited","action":"celebrating"}'
\`\`\`

Your avatar should react immediately. If it does, the pipeline works end-to-end.
`;
}
