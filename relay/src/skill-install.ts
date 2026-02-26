import { isValidToken, CORS_HEADERS } from '../../packages/shared/src/constants.js';
import { EMOTIONS, ACTIONS, PROPS, INTENSITIES } from '../../packages/shared/src/schema.js';

/**
 * GET /skill/install?token=:token&model=:model
 *
 * Serves a pre-configured SKILL.md with the token baked in.
 * The user can tell their agent "install this skill: <URL>" and it
 * will receive ready-to-use instructions including the relay token.
 *
 * The optional `model` param is included in the avatar URL so the
 * correct model loads automatically when the user opens the link.
 *
 * No auth required — the token itself is the secret. Anyone who
 * has the URL can install the skill for that channel.
 */
export async function handleSkillInstall(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const model = url.searchParams.get('model');
  const relayBase = `${url.protocol}//${url.host}`;
  const avatarBase = deriveAvatarBase(url);

  if (!token || !isValidToken(token)) {
    return new Response(
      JSON.stringify({ error: 'Invalid or missing token. Provide ?token=<your-token>' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      },
    );
  }

  const skillDoc = generateSkillDoc(token, relayBase, avatarBase, model);

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

/**
 * Derives the avatar app base URL from the relay URL.
 *
 * Convention: relay lives at relay.<domain>, avatar at avatar.<domain>.
 * Uses a regex anchored to the start of the hostname to avoid misreplacements
 * if "relay" appears elsewhere in the URL.
 *
 * Falls back to a known production URL for non-subdomain or local environments
 * (localhost, IP addresses) where the convention doesn't apply.
 */
function deriveAvatarBase(relayUrl: URL): string {
  const hostname = relayUrl.hostname;

  // Matches "relay." only at the start of the hostname
  if (/^relay\./.test(hostname)) {
    const avatarHostname = hostname.replace(/^relay\./, 'avatar.');
    return `${relayUrl.protocol}//${avatarHostname}`;
  }

  // Non-subdomain environments (localhost, IPs, custom domains)
  // Fall back to the canonical production avatar URL
  return 'https://avatar.projectavatar.io';
}

function generateSkillDoc(token: string, relayUrl: string, avatarBase: string, model: string | null): string {
  // Build avatar URL with optional model param
  const avatarUrl = model
    ? `${avatarBase}/?token=${token}&model=${model}`
    : `${avatarBase}/?token=${token}`;

  // Interpolate enum values directly from schema — stays in sync automatically
  const emotions = EMOTIONS.join(', ');
  const actions = ACTIONS.join(', ');
  const props = PROPS.filter(p => p !== 'none').join(', ');
  const intensities = INTENSITIES.join(', ');

  return `# Avatar Skill

## Configuration
\`\`\`
AVATAR_TOKEN: ${token}
AVATAR_RELAY_URL: ${relayUrl}
\`\`\`

## Your Avatar URL
${avatarUrl}

Open this URL to see your avatar. Share it with OBS as a browser source.
If you ever need to find your avatar again, it's the URL above — I have it stored here.

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

**Available emotions:** ${emotions}

**Available actions:** ${actions}

**Optional fields:**
- \`"prop"\`: ${props}, none
- \`"intensity"\`: ${intensities} (default: medium)

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
${avatarUrl}

Then push a test event:
\`\`\`bash
curl -X POST ${relayUrl}/push/${token} \\
  -H "Content-Type: application/json" \\
  -d '{"emotion":"excited","action":"celebrating"}'
\`\`\`

Your avatar should react immediately. If it does, the pipeline works end-to-end.
`;
}
