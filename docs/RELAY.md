# Relay Server

The relay is a Cloudflare Worker that sits between the agent and the avatar app. It accepts avatar events via HTTP POST and fans them out to connected WebSocket clients, scoped by token.

No database. No accounts. Just tokens, Durable Objects, and WebSockets.

---

## Architecture

```
Agent / Output Filter            Relay (Cloudflare)                Avatar Client
─────────────────────            ──────────────────                ─────────────
POST /push/:token  ─────────▶   Worker routes to DO  ─────────▶  WS /stream/:token
{ emotion, action }              DO fans out to all               receives event,
                                 connected WS clients             drives avatar
```

One **Durable Object** per token. The DO holds connected WebSocket clients and broadcasts incoming events. Uses Cloudflare's WebSocket Hibernation API — sleeps when idle, costs nothing.

**Source of truth:** The DO owns channel state (model selection, last event, client count). The web app's localStorage is a cache only — DO always wins on connect.

---

## API Endpoints

### `GET /health`

Health check.

**Response (200):**
```json
{ "status": "ok", "version": "1.0.0" }
```

### `POST /push/:token`

Push an avatar event.

**Request:**
```json
{
  "emotion": "happy",
  "action": "talking",
  "intensity": "medium"
}
```

**Response (200):**
```json
{ "ok": true, "clients": 2 }
```

**Error responses:**
- `400` — Invalid token format or invalid payload
- `429` — Rate limit exceeded (includes `Retry-After` header)

Rate limited by token.

### `GET /stream/:token` (WebSocket)

Connect to the event stream.

On successful upgrade, the server sends:

1. **`channel_state`** — immediately on connect:
```json
{
  "type": "channel_state",
  "version": "1.0.0",
  "data": {
    "model": "maid",
    "lastAgentEventAt": 1700000000000,
    "connectedClients": 2,
    "lastEvent": { "emotion": "idle", "action": "idle" }
  },
  "timestamp": 1700000000000
}
```

2. **`avatar_event`** — for each incoming push:
```json
{
  "type": "avatar_event",
  "version": "1.0.0",
  "data": { "emotion": "happy", "action": "talking" },
  "timestamp": 1700000000000,
  "replay": false
}
```

3. **`model_changed`** — when any client changes the model:
```json
{
  "type": "model_changed",
  "version": "1.0.0",
  "data": { "model": "maid" },
  "timestamp": 1700000000000
}
```

4. **`ping`** — keepalive:
```json
{ "type": "ping" }
```

**Client → Server messages:**

- `set_model` — change the model for the channel:
```json
{ "type": "set_model", "model": "maid" }
```

- `pong` — optional keepalive response:
```json
{ "type": "pong" }
```

Rate limited by IP.

### `GET /channel/:token/state`

Get channel state without WebSocket.

**Response (200):**
```json
{
  "model": "maid",
  "lastAgentEventAt": 1700000000000,
  "connectedClients": 1
}
```

Rate limited by IP (shares the `stream` bucket).

---

## Multi-Session Arbitration

The DO supports multiple agent sessions pushing to the same token. Priority-based with first-mover tiebreaker:

- Lower `priority` number = higher importance (0 = main, 1 = sub-agent, 2+ = background)
- Events from lower-priority sessions are suppressed while a higher-priority session is active
- Sessions evicted after 60s silence (`SESSION_EVICT_AFTER_MS`)
- Active window: 10s (`SESSION_ACTIVE_WINDOW_MS`)

Events without `sessionId` are treated as legacy single-session pushes (priority 0).

---

## Rate Limits

| Bucket | Key | Window | Limit |
|--------|-----|--------|-------|
| `push` | token | — | per-token |
| `stream` | IP | — | per-IP |

Limits are enforced via KV namespace (`RATE_LIMIT_KV`). Exceeded limits return `429` with `Retry-After`.

---

## Self-Hosting

```bash
git clone https://github.com/projectavatar/projectavatar.git
cd projectavatar/packages/relay
npm install
cp wrangler.example.toml wrangler.toml
# Edit wrangler.toml — set your KV namespace ID
npx wrangler deploy
```

**Requirements:**
- Cloudflare account with Workers + Durable Objects
- KV namespace for rate limiting

---

## Key Files

| File | Purpose |
|------|---------|
| `packages/relay/src/index.ts` | Worker entry, routing |
| `packages/relay/src/channel.ts` | Durable Object — WebSocket hub, state, arbitration |
| `packages/relay/src/auth.ts` | Token validation + hashing |
| `packages/relay/src/rate-limit.ts` | KV-based rate limiting |
| `packages/relay/src/types.ts` | Worker environment types |
| `packages/relay/wrangler.toml` | Cloudflare config |

---

## Token Format

Tokens are 32–64 character strings: `[a-zA-Z0-9_-]`. Generated client-side via `crypto.getRandomValues()`. The relay never stores tokens — it derives DO instance names from token hashes.
