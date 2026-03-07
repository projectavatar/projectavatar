import { isValidToken, tokenToChannelName } from './auth.js';
import { CORS_HEADERS } from '../../shared/src/constants.js';
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

      return routeToChannel(env, token, '/push', request, { 'X-Rate-Limit-Id': token });
    }

    // ── Stream endpoint: GET /stream/:token (WebSocket) ─────────────────────
    const streamMatch = path.match(/^\/stream\/([^/]+)$/);
    if (streamMatch && request.method === 'GET') {
      const token = streamMatch[1];

      if (!isValidToken(token)) {
        return errorResponse('Invalid token format', 400);
      }

      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      return routeToChannel(env, token, '/stream', request, { 'X-Rate-Limit-Id': clientIp });
    }

    // ── Channel state: GET /channel/:token/state ────────────────────────────
    const stateMatch = path.match(/^\/channel\/([^/]+)\/state$/);
    if (stateMatch && request.method === 'GET') {
      const token = stateMatch[1];

      if (!isValidToken(token)) {
        return errorResponse('Invalid token format', 400);
      }

      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      // Reusing the 'stream' rate limit bucket — intentional shortcut for v1.1.
      return routeToChannel(env, token, '/state', request, { 'X-Rate-Limit-Id': clientIp });
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
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const channelName = await tokenToChannelName(token);
  const id = env.CHANNEL.idFromName(channelName);
  const stub = env.CHANNEL.get(id);

  // Forward to the DO with the path the DO expects
  const doUrl = new URL(request.url);
  doUrl.pathname = doPath;

  const headers = new Headers(request.headers);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }

  return stub.fetch(new Request(doUrl.toString(), { ...request, headers }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}


