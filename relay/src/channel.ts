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

const LAST_EVENT_KEY          = 'lastEvent';
const MODEL_KEY               = 'model';
const LAST_AGENT_EVENT_AT_KEY = 'lastAgentEventAt';

/**
 * How long (ms) a session remains "active" after its last push.
 * A higher-priority session that has been silent for this window is considered
 * idle, and the next push from any lower-priority session will win arbitration.
 *
 * 10s is intentionally generous — a main session that pauses between tool calls
 * should still hold the avatar. Sub-agents only surface when the main session is
 * genuinely idle, not just between steps.
 */
const SESSION_ACTIVE_WINDOW_MS = 10_000;

/**
 * How long (ms) before a session entry is evicted from the in-memory registry.
 * Lazy cleanup: pruning happens on each push, not on a timer.
 * Sessions that stop pushing (crash, end) are removed after this window.
 */
const SESSION_EVICT_AFTER_MS = 60_000;

/**
 * In-memory registry entry for a single session.
 * The registry is ephemeral — not persisted to DO storage. If the DO hibernates
 * and wakes, the registry starts empty and sessions re-announce on their next push.
 */
interface SessionEntry {
  priority:    number;    // Lower = higher priority (0 = main session)
  lastPushAt:  number;    // Unix ms of last push from this session
  lastEvent:   AvatarEvent; // Last event from this session (for replay on handoff)
}

/**
 * Channel Durable Object — one instance per token.
 *
 * Responsibilities:
 * - Holds the set of connected WebSocket clients (via hibernation API)
 * - Receives pushed avatar events and fans them out to connected clients
 * - Arbitrates between multiple concurrent sessions — only the highest-priority
 *   active session's events are broadcast; lower-priority events are absorbed
 * - Persists the last known event, model, and lastAgentEventAt to DO storage
 * - Sends full channel state to new clients on WebSocket connect
 * - Handles `set_model` messages from clients and broadcasts `model_changed`
 * - Exposes GET /state for the plugin's share-link generation
 *
 * ## Multi-session arbitration
 * Sessions declare their priority in each push event (optional field).
 * The DO maintains an in-memory session registry keyed by sessionId.
 * On each push:
 *   1. Register/update the pushing session's entry
 *   2. Prune stale session entries (> SESSION_EVICT_AFTER_MS since last push)
 *   3. Find the "active winner" — lowest priority number among sessions that
 *      pushed within SESSION_ACTIVE_WINDOW_MS
 *   4. Fan out the event only if the pushing session IS the active winner
 *   5. If the pushing session just became winner (higher-priority session went
 *      idle), replay this event — the avatar transitions naturally
 *
 * Legacy events (no sessionId) are treated as priority 0 and always fan out
 * immediately (same as pre-arbitration behavior for single-session setups).
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
 * The session registry is in-memory only and resets on hibernation — sessions
 * re-announce naturally on their next push, so this is safe.
 */
export class Channel implements DurableObject {
  private state: DurableObjectState;

  // In-memory caches — populated lazily from storage on first use.
  // `undefined` means "not yet loaded from storage".
  private lastEventCache: AvatarEvent | null | undefined = undefined;
  private modelCache: string | null | undefined = undefined;
  private lastAgentEventAtCache: number | null | undefined = undefined;

  /**
   * In-memory session registry. Keyed by sessionId.
   * Ephemeral — resets on DO hibernation. Sessions re-register on next push.
   * Only populated when events include sessionId — legacy events bypass this entirely.
   */
  private sessions: Map<string, SessionEntry> = new Map();

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
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

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
    const now   = Date.now();

    // ── Multi-session arbitration ──────────────────────────────────────────
    //
    // Legacy events (no sessionId) bypass arbitration entirely — they fan out
    // immediately. This preserves backward compatibility for skill-based agents
    // and single-session setups that don't set sessionId.
    //
    // For session-aware events:
    //   1. Register/update the session entry
    //   2. Prune stale entries (lazy GC — no timers)
    //   3. Determine the active winner (lowest priority with recent push)
    //   4. Only fan out if this session IS the winner

    let shouldFanOut = true;

    if (event.sessionId !== undefined) {
      const sessionId = event.sessionId;
      const priority  = event.priority ?? 0;

      // Update this session's entry
      this.sessions.set(sessionId, {
        priority,
        lastPushAt: now,
        lastEvent:  event,
      });

      // Lazy prune: remove sessions silent for > SESSION_EVICT_AFTER_MS
      for (const [id, entry] of this.sessions) {
        if (now - entry.lastPushAt > SESSION_EVICT_AFTER_MS) {
          this.sessions.delete(id);
        }
      }

      // Find the active winner: lowest priority number among recently active sessions
      let winnerPriority = Infinity;
      for (const entry of this.sessions.values()) {
        if (now - entry.lastPushAt <= SESSION_ACTIVE_WINDOW_MS) {
          if (entry.priority < winnerPriority) {
            winnerPriority = entry.priority;
          }
        }
      }

      // Fan out only if this session's priority matches the winner
      shouldFanOut = priority === winnerPriority;
    }

    if (!shouldFanOut) {
      // Suppressed: a higher-priority session is currently active.
      // Return 200 so the plugin doesn't retry — this is intentional suppression.
      return jsonResponse({ ok: true, clients: 0, suppressed: true }, 200);
    }

    // Persist event + activity timestamp in a single atomic write
    await this.state.storage.put({
      [LAST_EVENT_KEY]:          event,
      [LAST_AGENT_EVENT_AT_KEY]: now,
    });
    this.lastEventCache        = event;
    this.lastAgentEventAtCache = now;

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
    // getWebSockets() includes the newly accepted socket — so connectedClients
    // reflects the accurate post-connect count (including this client). This is
    // intentional: the client sees itself counted among the viewers immediately.
    const channelStateMsg: ChannelStateMessage = {
      type:    'channel_state',
      version: PROTOCOL_VERSION,
      data:    {
        model,
        lastAgentEventAt,
        connectedClients: this.state.getWebSockets().length,
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
    if (typeof message !== 'string') return; // Binary frames not supported

    let msg: unknown;
    try {
      msg = JSON.parse(message);
    } catch {
      return; // Malformed JSON — ignore silently
    }

    const m = msg as Record<string, unknown>;
    if (m['type'] === 'set_model') {
      const model = m['model'] ?? null;
      // Validate: must be a valid model ID string or explicit null (to clear model)
      if (model !== null && !isValidModelId(model)) return;
      void this.handleSetModel(model as string | null);
    } else {
      // Unknown message type — log at debug level for easier diagnostics
      console.debug('[Channel] Unknown WebSocket message type:', m['type']);
    }
  }

  webSocketClose(_ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    // Hibernation API removes the socket from state.getWebSockets() automatically.
    console.debug('[Channel] WebSocket closed:', code, reason || '(no reason)');
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
    // Deduplicate: skip storage write + broadcast if the model hasn't changed.
    // Prevents storage churn if a client spams set_model with the same value.
    // modelCache uses the sentinel pattern: undefined = not yet loaded from storage.
    // A loaded null and a loaded 'some-model' are both valid values.
    if (this.modelCache !== undefined && this.modelCache === model) return;

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
  //
  // Sentinel convention: `undefined` means "not yet loaded from storage".
  // `null` means "loaded but no value stored". Both `undefined` and `null`
  // from storage.get() are collapsed to `null` via `?? null` — they represent
  // the same thing: no value. Never assign `undefined` to a cache field after
  // initialization; doing so would bypass the cache on every subsequent call.

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
