import { validateAvatarEvent, isValidModelId } from '../../shared/src/schema.js';
import { PROTOCOL_VERSION, RATE_LIMITS, CORS_HEADERS, KEEPALIVE } from '../../shared/src/constants.js';
import { RateLimiter } from './rate-limit.js';
import type {
  AvatarEvent,
  ChannelState,
  ChannelStateMessage,
  ModelChangedMessage,
  AvatarEventMessage,
  WebSocketClientMessage,
} from '../../shared/src/schema.js';
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

// Keepalive interval imported from shared constants (KEEPALIVE.pingIntervalMs)

/** Pre-serialized keepalive ping payload. */
const PING_PAYLOAD = JSON.stringify({ type: 'ping' });

/**
 * In-memory registry entry for a single session.
 * The registry is ephemeral — not persisted to DO storage. If the DO hibernates
 * and wakes, the registry starts empty and sessions re-announce on their next push.
 */
interface SessionEntry {
  priority:    number;    // Lower = higher priority (0 = main session)
  firstPushAt: number;    // Unix ms of the very first push — used as tiebreaker; never updated
  lastPushAt:  number;    // Unix ms of most recent push
  lastEvent:   AvatarEvent;
}

/**
 * Resolve which session wins the right to fan out.
 *
 * Single-pass selection with a compound comparison:
 *   - A session wins if it has a lower priority number than the current winner.
 *   - On a tie (same priority), the session with the earlier firstPushAt wins
 *     ("first mover holds").
 *
 * Returns the winning sessionId, or null if no active sessions exist (degenerate
 * case — the pushing session should always be in the registry by call time).
 *
 * ## Why first-mover wins on ties
 *
 * Two concurrent sessions at the same priority (e.g. two channel agents sharing
 * a token) would thrash last-writer-wins without a tiebreaker. "First mover holds"
 * is deterministic and stable: whichever session pushed first controls the avatar
 * until it goes idle (SESSION_ACTIVE_WINDOW_MS of silence). Only then does another
 * session of the same priority win. No coordination between sessions is required.
 */
function resolveWinner(sessions: Map<string, SessionEntry>, now: number): string | null {
  let winnerPriority  = Infinity;
  let winnerFirstPush = Infinity;
  let winnerId: string | null = null;

  for (const [id, entry] of sessions) {
    // Only consider sessions that pushed recently
    if (now - entry.lastPushAt > SESSION_ACTIVE_WINDOW_MS) continue;

    if (
      entry.priority < winnerPriority ||
      (entry.priority === winnerPriority && entry.firstPushAt < winnerFirstPush)
    ) {
      winnerPriority  = entry.priority;
      winnerFirstPush = entry.firstPushAt;
      winnerId        = id;
    }
  }

  return winnerId;
}

/**
 * Strip internal arbitration fields from an event before sending to WebSocket clients.
 *
 * `sessionId` and `priority` are relay implementation details — the web app has no
 * use for them and they bloat every WS frame. Clients only need the display fields.
 */
function toClientEvent(event: AvatarEvent): AvatarEvent {
  const clean: AvatarEvent = {
    emotions:  event.emotions,
    action:    event.action,
    prop:      event.prop,
    intensity: event.intensity,
    color:     event.color,
    talking:   event.talking,
  };
  return clean;
}

/**
 * Channel Durable Object — one instance per token.
 *
 * Responsibilities:
 * - Holds the set of connected WebSocket clients (via hibernation API)
 * - Receives pushed avatar events and fans them out to connected clients
 * - Arbitrates between multiple concurrent sessions
 * - Persists the last known event, model, and lastAgentEventAt to DO storage
 * - Sends full channel state to new clients on WebSocket connect
 * - Handles `set_model` messages from clients and broadcasts `model_changed`
 * - Sends periodic keepalive pings to prevent client-side timeouts
 * - Exposes GET /state for the plugin's share-link generation
 *
 * ## Multi-session arbitration (details)
 *
 * - Lower priority number wins (0 = main session, 1 = sub-agent, depth-based)
 * - On priority tie, the session that pushed FIRST holds until it goes idle
 * - Lower-priority or later-starting same-priority events are silently absorbed
 *
 * ## Keepalive mechanism
 *
 * The DO uses Cloudflare's alarm API to send `{"type":"ping"}` to all connected
 * WebSocket clients every KEEPALIVE.pingIntervalMs (30s). This prevents the client's
 * 60s dead-connection timer from firing during idle periods when no avatar events
 * are being pushed.
 *
 * The alarm is scheduled when the first WebSocket connects and self-reschedules
 * as long as clients remain connected. When the last client disconnects, the
 * alarm is not rescheduled and the DO can hibernate cleanly.
 *
 * On hibernation wake (alarm fires after DO was hibernated), the alarm handler
 * runs normally — getWebSockets() returns the hibernated sockets, pings go out,
 * and the alarm reschedules if clients are still connected.
 *
 * ## lastAgentEventAt semantics
 *
 * `lastAgentEventAt` is updated ONLY when a push fans out (i.e. the pushing session
 * is the winner). Suppressed pushes do NOT update it.
 *
 * Rationale: `lastAgentEventAt` is used by the web app's online/offline indicator.
 * It reflects "when did the avatar last visibly react" — which is exactly when a
 * push won arbitration. Updating it on suppressed pushes would show the avatar as
 * "online" even during stretches when nothing visible is happening, which defeats
 * the purpose of the indicator.
 *
 * Consequence: if only a sub-agent is active while the main session is suppressing
 * it, `lastAgentEventAt` will appear stale to web clients. This is acceptable —
 * the indicator reflects the avatar's visible state, not raw push activity.
 *
 * ## Multi-session arbitration
 * See resolveWinner() and SESSION_ACTIVE_WINDOW_MS / SESSION_EVICT_AFTER_MS above.
 *
 * ## Source of truth
 * The DO owns channel identity state: model selection and agent activity
 * timestamp. Clients (web app, plugin) derive their state from the DO.
 * localStorage in the web app is a cache only — DO always wins on conflict.
 *
 * ## Token security model
 * This DO instance is identified by SHA-256(token), derived in the Worker
 * before routing here. The DO itself does NOT validate tokens — validation
 * happens at the Worker layer (auth.ts + index.ts).
 *
 * ## Hibernation
 * Uses the WebSocket Hibernation API. The session registry is in-memory only —
 * it resets on hibernation. Sessions re-announce on their next push.
 * On wake: firstPushAt is re-set for each session on first push post-wake.
 * Sessions re-race naturally within a few pushes. Acceptable tradeoff for zero
 * hibernation cost.
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

  /** Rate limiter backed by DO SQL storage — atomic, no KV needed. */
  readonly rateLimiter: RateLimiter;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.rateLimiter = new RateLimiter(state.storage.sql);
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

  // ─── Alarm Handler (Keepalive Pings) ───────────────────────────────────────

  async alarm(): Promise<void> {
    const sockets = this.state.getWebSockets();

    if (sockets.length === 0) {
      // No clients connected — don't reschedule. The DO can hibernate.
      return;
    }

    // Send ping to all connected clients
    for (const ws of sockets) {
      try {
        ws.send(PING_PAYLOAD);
      } catch {
        // Dead socket — hibernation API handles cleanup
      }
    }

    // Reschedule for the next ping
    await this.state.storage.setAlarm(Date.now() + KEEPALIVE.pingIntervalMs);
  }

  /**
   * Ensure the keepalive alarm is scheduled.
   * Called when a new WebSocket connects. Safe to call multiple times —
   * only schedules if no alarm is currently pending.
   */
  private async ensurePingAlarm(): Promise<void> {
    const existing = await this.state.storage.getAlarm();
    if (existing === null) {
      await this.state.storage.setAlarm(Date.now() + KEEPALIVE.pingIntervalMs);
    }
  }

  // ─── Push Handler ──────────────────────────────────────────────────────────

  private async handlePush(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // Rate limit by token (extracted from X-Rate-Limit-Id header, set by Worker)
    const rateLimitId = request.headers.get('X-Rate-Limit-Id');
    if (rateLimitId) {
      const rl = this.rateLimiter.check('push', rateLimitId);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds), ...CORS_HEADERS },
        });
      }
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
    // and single-session setups.
    //
    // For session-aware events:
    //   1. Register/update the session entry (firstPushAt is set once, never changed)
    //   2. Prune stale entries (lazy GC — no timers needed)
    //   3. Resolve the active winner via resolveWinner()
    //   4. Fan out only if this session IS the winner

    let shouldFanOut = true;

    if (event.sessionId !== undefined) {
      const sessionId = event.sessionId;
      const priority  = event.priority ?? 0;

      // Register or update — preserve firstPushAt so the tiebreaker is stable
      const existing = this.sessions.get(sessionId);
      this.sessions.set(sessionId, {
        priority,
        firstPushAt: existing?.firstPushAt ?? now,  // first push timestamp never changes
        lastPushAt:  now,
        lastEvent:   event,
      });

      // Lazy prune: remove sessions silent for > SESSION_EVICT_AFTER_MS.
      // Deleting from a Map during for...of is safe per the ES2015 Map iterator spec —
      // the iterator skips deleted entries and visits entries added during iteration.
      for (const [id, entry] of this.sessions) {
        if (now - entry.lastPushAt > SESSION_EVICT_AFTER_MS) {
          this.sessions.delete(id);
        }
      }

      const winnerId = resolveWinner(this.sessions, now);
      shouldFanOut   = winnerId === sessionId;
    }

    if (!shouldFanOut) {
      return jsonResponse({ ok: true, clients: 0, suppressed: true }, 200);
    }

    await this.state.storage.put({
      [LAST_EVENT_KEY]:          event,
      [LAST_AGENT_EVENT_AT_KEY]: now,
    });
    this.lastEventCache        = event;
    this.lastAgentEventAtCache = now;

    const clientEvent = toClientEvent(event);
    const sockets     = this.state.getWebSockets();
    const message: AvatarEventMessage = {
      type:      'avatar_event',
      version:   PROTOCOL_VERSION,
      data:      clientEvent,
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
    // Rate limit by IP (extracted from X-Rate-Limit-Id header, set by Worker)
    const rateLimitId = request.headers.get('X-Rate-Limit-Id');
    if (rateLimitId) {
      const rl = this.rateLimiter.check('stream', rateLimitId);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds), ...CORS_HEADERS },
        });
      }
    }

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

    // Send channel_state FIRST — client needs model before rendering avatar.
    const channelStateMsg: ChannelStateMessage = {
      type:    'channel_state',
      version: PROTOCOL_VERSION,
      data:    {
        model,
        lastAgentEventAt,
        connectedClients: this.state.getWebSockets().length,
        lastEvent: lastEvent ? toClientEvent(lastEvent) : null,
      },
      timestamp: Date.now(),
    };
    server.send(JSON.stringify(channelStateMsg));

    // Ensure keepalive alarm is running now that we have a client
    await this.ensurePingAlarm();

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
    if (typeof message !== 'string') return;

    let msg: unknown;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    const m = msg as Record<string, unknown>;
    if (m['type'] === 'set_model') {
      const model = m['model'] ?? null;
      if (model !== null && !isValidModelId(model)) return;
      void this.handleSetModel(model as string | null);
    } else if (m['type'] === 'pong') {
      // Client keepalive response — acknowledged, no action needed.
      // The Hibernation API keeps the socket alive regardless; this is
      // just confirmation the client is responsive.
    } else {
      console.debug('[Channel] Unknown WebSocket message type:', m['type']);
    }
  }

  webSocketClose(_ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    console.debug('[Channel] WebSocket closed:', code, reason || '(no reason)');
    // No explicit cleanup needed — hibernation API manages socket lifecycle.
    // The ping alarm checks getWebSockets().length and stops when 0.
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
