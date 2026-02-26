import { validateAvatarEvent } from '../../packages/shared/src/schema.js';
import { PROTOCOL_VERSION, RATE_LIMITS } from '../../packages/shared/src/constants.js';
import type { AvatarEvent } from '../../packages/shared/src/schema.js';
import type { Env, WebSocketMessage } from './types.js';

/**
 * Channel Durable Object — one instance per token.
 *
 * Responsibilities:
 * - Holds the set of connected WebSocket clients (via hibernation API)
 * - Receives pushed avatar events and fans them out to all connected clients
 * - Stores the last known event to replay to new connections
 * - Cleans up dead connections on each push
 */
export class Channel implements DurableObject {
  private state: DurableObjectState;
  private lastEvent: AvatarEvent | null = null;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/push') {
      return this.handlePush(request);
    }

    if (url.pathname === '/stream') {
      return this.handleStream(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  // ─── Push Handler ──────────────────────────────────────────────────────────

  private async handlePush(request: Request): Promise<Response> {
    // Enforce payload size limit before reading
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > RATE_LIMITS.maxPayloadBytes) {
      return jsonResponse({ error: 'Payload too large' }, 413);
    }

    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > RATE_LIMITS.maxPayloadBytes) {
        return jsonResponse({ error: 'Payload too large' }, 413);
      }
      body = JSON.parse(text);
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const validation = validateAvatarEvent(body);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, 400);
    }

    const event = body as AvatarEvent;

    // Store last event for replay on new connections
    this.lastEvent = event;

    // Fan out to all connected WebSocket clients
    const sockets = this.state.getWebSockets();
    const message: WebSocketMessage = {
      type: 'avatar_event',
      version: PROTOCOL_VERSION,
      data: event,
      timestamp: Date.now(),
      replay: false,
    };
    const payload = JSON.stringify(message);

    let delivered = 0;
    for (const ws of sockets) {
      try {
        ws.send(payload);
        delivered++;
      } catch {
        // Dead connection — DO hibernation API handles cleanup automatically
      }
    }

    return jsonResponse({ ok: true, clients: delivered }, 200);
  }

  // ─── WebSocket Stream Handler ──────────────────────────────────────────────

  private handleStream(request: Request): Response {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Create the WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Accept via hibernation API — the DO can sleep when no connections are active
    this.state.acceptWebSocket(server);

    // Send last known state immediately on connect (state replay)
    if (this.lastEvent) {
      const replayMessage: WebSocketMessage = {
        type: 'avatar_event',
        version: PROTOCOL_VERSION,
        data: this.lastEvent,
        timestamp: Date.now(),
        replay: true,
      };
      server.send(JSON.stringify(replayMessage));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket Lifecycle (Hibernation API) ─────────────────────────────────

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // Clients send periodic pings — Cloudflare handles pong automatically.
    // No application-level messages expected from clients in v1.
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Hibernation API removes the socket from state.getWebSockets() automatically.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Same — hibernation API handles cleanup.
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
