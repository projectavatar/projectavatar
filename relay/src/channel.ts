import { validateAvatarEvent, isValidModelId } from '../../packages/shared/src/schema.js';
import { PROTOCOL_VERSION, RATE_LIMITS, CORS_HEADERS } from '../../packages/shared/src/constants.js';
import type {
  AvatarEvent,
  ChannelState,
  ChannelStateMessage,
  ModelChangedMessage,
  AvatarEventMessage,
  WebSocketClientMessage,
} from '../../packages/shared/src/schema.js';
import type { Env } from './types.js';

const LAST_EVENT_KEY        = 'lastEvent';
const MODEL_KEY             = 'model';
const LAST_AGENT_EVENT_AT_KEY = 'lastAgentEventAt';

/**
 * Channel Durable Object — one instance per token.
 *
 * Responsibilities:
 * - Holds the set of connected WebSocket clients (via hibernation API)
 * - Receives pushed avatar events and fans them out to all connected clients
 * - Persists the last known event, model, and lastAgentEventAt to DO storage
 * - Sends full channel state to new clients on WebSocket connect
 * - Handles `set_model` messages from clients and broadcasts `model_changed`
 * - Exposes GET /state for the plugin's share-link generation
 *
 * ## Source of truth
 * The DO owns channel identity state: model selection and agent activity
 * timestamp. Clients (web app, plugin) derive their state from the DO.
 * localStorage in the web app is a cache only — DO always wins on conflict.
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
 * All persistent state is stored in DO storage so it survives eviction.
 */
export class Channel implements DurableObject {
  private state: DurableObjectState;

  // In-memory caches — populated lazily from storage on first use.
  // `undefined` means "not yet loaded from storage".
  private lastEventCache: AvatarEvent | null | undefined = undefined;
  private modelCache: string | null | undefined = undefined;
  private lastAgentEventAtCache: number | null | undefined = undefined;

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

    if (url.pathname === '/state' && request.method === 'GET') {
      return this.handleGetState();
    }

    return new Response('Not Found', { status: 404 });
  }

  // ─── Push Handler ──────────────────────────────────────────────────────────

  private async handlePush(request: Request): Promise<Response> {
    let text: string;
    try {
      text = await request.text();
    } catch {
      return jsonResponse({ error: 'Failed to read request body' }, 400);
    }

    if (new TextEncoder().encode(text).length > RATE_LIMITS.maxPayloadBytes) {
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
    const now = Date.now();

    // Persist event + activity timestamp in a single atomic write
    await this.state.storage.put({
      [LAST_EVENT_KEY]:          event,
      [LAST_AGENT_EVENT_AT_KEY]: now,
    });
    this.lastEventCache          = event;
    this.lastAgentEventAtCache   = now;

    // Fan out to all connected WebSocket clients
    const sockets = this.state.getWebSockets();
    const message: AvatarEventMessage = {
      type:      'avatar_event',
      version:   PROTOCOL_VERSION,
      data:      event,
      timestamp: now,
      replay:    false,
    };
    const payload = JSON.stringify(message);

    let delivered = 0;
    for (const ws of sockets) {
      try {
        ws.send(payload);
        delivered++;
      } catch {
        // Dead connection — hibernation API handles cleanup automatically
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

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);

    // Load all state in parallel — may hit storage if cache is cold
    const [model, lastAgentEventAt, lastEvent] = await Promise.all([
      this.getModel(),
      this.getLastAgentEventAt(),
      this.getLastEvent(),
    ]);

    // Send channel_state FIRST — client needs model before rendering avatar
    const channelStateMsg: ChannelStateMessage = {
      type:      'channel_state',
      version:   PROTOCOL_VERSION,
      data:      {
        model,
        lastAgentEventAt,
        connectedClients: this.state.getWebSockets().length, // includes this new socket
        lastEvent,
      },
      timestamp: Date.now(),
    };
    server.send(JSON.stringify(channelStateMsg));

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── HTTP State Handler ────────────────────────────────────────────────────

  private async handleGetState(): Promise<Response> {
    const [model, lastAgentEventAt] = await Promise.all([
      this.getModel(),
      this.getLastAgentEventAt(),
    ]);

    const body: ChannelState = {
      model,
      lastAgentEventAt,
      connectedClients: this.state.getWebSockets().length,
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  // ─── WebSocket Lifecycle (Hibernation API) ─────────────────────────────────

  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return; // Binary not supported

    let msg: unknown;
    try {
      msg = JSON.parse(message);
    } catch {
      return; // Malformed message — ignore silently
    }

    const m = msg as Record<string, unknown>;
    if (m['type'] === 'set_model') {
      const model = m['model'] ?? null;
      // Validate: must be a valid model ID string or explicit null
      if (model !== null && !isValidModelId(model)) return;
      void this.handleSetModel(model as string | null);
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Hibernation API removes the socket from state.getWebSockets() automatically.
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.error('[Channel] WebSocket error:', error);
    try {
      ws.close(1011, 'WebSocket error');
    } catch {
      // Already closed — ignore
    }
  }

  // ─── Model Management ─────────────────────────────────────────────────────

  private async handleSetModel(model: string | null): Promise<void> {
    this.modelCache = model;
    await this.state.storage.put(MODEL_KEY, model);

    const broadcast: ModelChangedMessage = {
      type:      'model_changed',
      version:   PROTOCOL_VERSION,
      data:      { model },
      timestamp: Date.now(),
    };
    const payload = JSON.stringify(broadcast);

    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Dead socket — hibernation API cleans up
      }
    }
  }

  // ─── Storage Helpers (lazy cache pattern) ─────────────────────────────────

  private async getLastEvent(): Promise<AvatarEvent | null> {
    if (this.lastEventCache !== undefined) return this.lastEventCache;
    const stored = await this.state.storage.get<AvatarEvent>(LAST_EVENT_KEY);
    this.lastEventCache = stored ?? null;
    return this.lastEventCache;
  }

  private async getModel(): Promise<string | null> {
    if (this.modelCache !== undefined) return this.modelCache;
    const stored = await this.state.storage.get<string | null>(MODEL_KEY);
    this.modelCache = stored ?? null;
    return this.modelCache;
  }

  private async getLastAgentEventAt(): Promise<number | null> {
    if (this.lastAgentEventAtCache !== undefined) return this.lastAgentEventAtCache;
    const stored = await this.state.storage.get<number>(LAST_AGENT_EVENT_AT_KEY);
    this.lastAgentEventAtCache = stored ?? null;
    return this.lastAgentEventAtCache;
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
