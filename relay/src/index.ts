import { isValidToken, tokenToChannelName } from './auth.js';
import { checkRateLimit } from './rate-limit.js';
import { CORS_HEADERS } from '../../packages/shared/src/constants.js';
import { handleSkillInstall } from './skill-install.js';
import type { Env } from './types.js';

export { Channel } from './channel.js';

// ─── Worker Entry ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Health check ────────────────────────────────────────────────────────
    if (path === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          version: env.RELAY_VERSION || '1.0.0',
        }),
        {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        },
      );
    }

    // ── Push endpoint: POST /push/:token ────────────────────────────────────
    const pushMatch = path.match(/^\/push\/([^/]+)$/);
    if (pushMatch && request.method === 'POST') {
      const token = pushMatch[1];

      if (!isValidToken(token)) {
        return errorResponse('Invalid token format', 400);
      }

      // Rate limit by token
      const rl = await checkRateLimit(env, 'push', token);
      if (!rl.allowed) {
        return rateLimitResponse(rl.retryAfterSeconds);
      }

      return routeToChannel(env, token, '/push', request);
    }

    // ── Stream endpoint: GET /stream/:token (WebSocket) ─────────────────────
    const streamMatch = path.match(/^\/stream\/([^/]+)$/);
    if (streamMatch && request.method === 'GET') {
      const token = streamMatch[1];

      if (!isValidToken(token)) {
        return errorResponse('Invalid token format', 400);
      }

      // Rate limit by IP
      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env, 'stream', clientIp);
      if (!rl.allowed) {
        return rateLimitResponse(rl.retryAfterSeconds);
      }

      return routeToChannel(env, token, '/stream', request);
    }

    // ── Skill install: GET /skill/install?token=... ─────────────────────────
    if (path === '/skill/install' && request.method === 'GET') {
      return handleSkillInstall(request);
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  },
};

// ─── Route to Durable Object ─────────────────────────────────────────────────

async function routeToChannel(
  env: Env,
  token: string,
  doPath: string,
  request: Request,
): Promise<Response> {
  const channelName = await tokenToChannelName(token);
  const id = env.CHANNEL.idFromName(channelName);
  const stub = env.CHANNEL.get(id);

  // Forward to the DO with the path the DO expects
  const doUrl = new URL(request.url);
  doUrl.pathname = doPath;

  return stub.fetch(new Request(doUrl.toString(), request));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
        ...CORS_HEADERS,
      },
    },
  );
}
