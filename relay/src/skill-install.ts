import { isValidToken, CORS_HEADERS } from '../../packages/shared/src/constants.js';
import { renderSkillDoc } from '../../packages/shared/src/skill-template.js';

/**
 * GET /skill/install?token=:token&model=:model
 *
 * Serves a pre-configured skill document with the token baked in.
 * The user can tell their agent "install this skill: <URL>" and it
 * will receive ready-to-use instructions including the relay token.
 *
 * The optional `model` param is included in the avatar URL so the
 * correct model loads automatically when the user opens the link.
 *
 * No auth required — the token itself is the secret. Anyone who
 * has the URL can install the skill for that channel.
 *
 * The document content is rendered from the shared skill template in
 * packages/shared/src/skill-template.ts — single source of truth for
 * what agents receive. skill/openclaw/SKILL.md is auto-generated from
 * the same template via scripts/gen-skill-md.ts.
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

  const avatarUrl = model
    ? `${avatarBase}/?token=${token}&model=${model}`
    : `${avatarBase}/?token=${token}`;

  const skillDoc = renderSkillDoc({
    token,
    relayUrl: relayBase,
    avatarUrl,
  });

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
 * Convention: relay lives at relay.<domain>, app lives at app.<domain>.
 * Uses a regex anchored to the start of the hostname to avoid misreplacements
 * if "relay" appears elsewhere in the URL.
 *
 * Falls back to the canonical production app URL for non-subdomain or local
 * environments (localhost, IPs, custom domains).
 *
 * Intentional: local dev and non-relay-subdomain environments always embed
 * the production avatar URL in skill docs. The skill doc is agent-facing and
 * should always point to production.
 */
function deriveAvatarBase(relayUrl: URL): string {
  const hostname = relayUrl.hostname;

  if (/^relay\./.test(hostname)) {
    const avatarHostname = hostname.replace(/^relay\./, 'app.');
    return `${relayUrl.protocol}//${avatarHostname}`;
  }

  return 'https://app.projectavatar.io';
}
