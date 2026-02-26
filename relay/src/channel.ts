import { validateAvatarEvent } from '../../packages/shared/src/schema.js';
import { PROTOCOL_VERSION, RATE_LIMITS, CORS_HEADERS } from '../../packages/shared/src/constants.js';
import type { AvatarEvent } from '../../packages/shared/src/schema.js';
import type { Env, WebSocketMessage } from './types.js';

// Re-export so existing imports from './channel.js' still work
export { CORS_HEADERS } from '../../packages/shared/src/constants.js';

const LAST_EVENT_KEY = 'lastEvent';

/**
 * Channel Durable Object — one instance per token.
 *
 * Responsibilities:
 * - Holds the set of connected WebSocket clients (via hibernation API)
 * - Receives pushed avatar events and fans them out to all connected clients
 * - Persists the last known event to DO storage so it survives hibernation eviction
 * - Replays the last event to new connections immediately on join
 *
 * ## Token security model
 * This DO instance is identified by SHA-256(token), derived in the Worker
 * before routing here. The DO itself does NOT validate tokens — validation
 * happens at the Worker layer (auth.ts + index.ts). Never expose DO instances
 * directly without the Worker authentication layer in front.
 *
 * ## Hibernation
 * The DO uses the WebSocket Hibernation API (`state.acceptWebSocket`). This
 * means the DO can sleep when idle (zero cost) and wake on the next request.
 * `lastEvent` is persisted to DO storage so replay works correctly even after
 * the DO has been evicted from memory.
 */
export class Channel implements DurableObject {
  private state: DurableObjectState;
  // In-memory cache of last event — populated lazily from storage on first push/stream
  private lastEventCache: AvatarEvent | null | undefined = undefined; // undefined = not yet loaded

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
    // Read the full body with a hard byte cap.
    // Note: content-length is client-supplied and unreliable — it is NOT used
    // as a security boundary. The actual limit is enforced on the raw text length.
    let text: string;
    try {
      text = await request.text();
    } catch {
      return jsonResponse({ error: 'Failed to read request body' }, 400);
    }

    if (text.length > RATE_LIMITS.maxPayloadBytes) {
      return jsonResponse({ error: 'Payload too large' }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const validation = validateAvatarEvent(body);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, 400);
    }

    const event = body as AvatarEvent;

    // Persist to DO storage so replay survives hibernation eviction
    await this.state.storage.put(LAST_EVENT_KEY, event);
    this.lastEventCache = event;

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

  private async handleStream(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Explicit property access — Object.values() order is not guaranteed
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Accept via hibernation API — the DO can sleep when no connections are active
    this.state.acceptWebSocket(server);

    // Send last known state immediately on connect (state replay)
    // Load from storage if not in memory (handles post-eviction wake)
    const lastEvent = await this.getLastEvent();
    if (lastEvent) {
      const replayMessage: WebSocketMessage = {
        type: 'avatar_event',
        version: PROTOCOL_VERSION,
        data: lastEvent,
        timestamp: Date.now(),
        replay: true,
      };
      server.send(JSON.stringify(replayMessage));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket Lifecycle (Hibernation API) ─────────────────────────────────

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // Clients may send pings — no application messages expected from clients in v1.
    // Cloudflare handles WebSocket ping/pong at the protocol level automatically.
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Hibernation API removes the socket from state.getWebSockets() automatically.
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    // Log the error for debugging. The hibernation API will clean up the socket.
    console.error('[Channel] WebSocket error:', error);
    try {
      ws.close(1011, 'WebSocket error');
    } catch {
      // Already closed — ignore
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Returns the last known avatar event, loading from DO storage if needed.
   * Uses an in-memory cache to avoid repeated storage reads within a single
   * DO instance lifetime.
   */
  private async getLastEvent(): Promise<AvatarEvent | null> {
    if (this.lastEventCache !== undefined) {
      return this.lastEventCache;
    }
    const stored = await this.state.storage.get<AvatarEvent>(LAST_EVENT_KEY);
    this.lastEventCache = stored ?? null;
    return this.lastEventCache;
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
