# Relay Server

The relay is a lightweight Cloudflare Worker that sits between the agent's output filter and the avatar app. It accepts avatar events via HTTP POST and fans them out to connected WebSocket clients, scoped by token.

No database. No accounts. Just tokens, Durable Objects, and WebSockets.

---

## Architecture

```
Output Filter                    Relay (Cloudflare)                Avatar Client
─────────────                    ──────────────────                ─────────────
POST /push/:token  ─────────▶   Worker routes to DO  ─────────▶  WS /stream/:token
{ emotion, action }              DO fans out to all               receives event,
                                 connected WS clients             drives avatar
```

One **Durable Object** instance per token. The DO holds the set of connected WebSocket clients and broadcasts incoming events to all of them. It uses Cloudflare's WebSocket Hibernation API, so it sleeps when idle and costs nothing.

---

## API Endpoints

### `POST /push/:token`

Push an avatar event from the output filter.

**Request:**
```
POST /push/abc123...
Content-Type: application/json

{
  "emotion": "focused",
  "action": "coding",
  "prop": "keyboard",
  "intensity": "medium"
}
```

**Response (200):**
```json
{ "ok": true, "clients": 1 }
```
`clients` is the number of avatar app instances that received the event.

**Response (400):** Invalid payload — missing required fields or unknown enum values.

**Response (429):** Rate limit exceeded. Includes `Retry-After` header.

---

### `GET /stream/:token` (WebSocket Upgrade)

Connect the avatar app to the event stream.

**Upgrade:**
```
GET /stream/abc123...
Upgrade: websocket
Connection: Upgrade
```

On successful upgrade, the connection is held open. The server:
- Immediately sends the last known event (replay), if any, with `"replay": true`
- Forwards all subsequent events pushed to `/push/:token`

**Message format (server → client):**
```json
{
  "type": "avatar_event",
  "data": {
    "emotion": "focused",
    "action": "coding",
    "prop": "keyboard",
    "intensity": "medium"
  },
  "timestamp": 1700000000000,
  "replay": false
}
```

**Ping/Pong:** The client should send a WebSocket ping every 30 seconds to keep the connection alive through proxies and firewalls. The server responds with pong automatically (Cloudflare DO handles this).

---

### `GET /health`

Health check. Returns 200 with version info. No auth required.

```json
{ "status": "ok", "version": "1.0.0" }
```

---

## Token Model

Tokens are **48-character base62 strings** generated client-side in the avatar app. The relay never stores tokens — it derives a Durable Object ID from a hash of the token.

```
token: "A3x9kQmP2nR7vB4wY8uL1zT6..."  (48 chars, ~285 bits of entropy)
   │
   ▼
SHA-256 hash
   │
   ▼
Durable Object ID  →  one DO instance per token
```

**Properties:**
- Any valid-format token creates its own channel (no pre-registration needed)
- Brute-force is infeasible at 48 chars
- Rotate your token in the avatar app settings at any time
- Tokens have no expiry — the channel persists as long as events arrive

**Generating a token (in the avatar app):**
```typescript
function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}
```

---

## Rate Limiting

Rate limiting runs in the Worker before routing to the Durable Object.

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /push/:token` | 60 requests | per token per minute |
| `GET /stream/:token` | 10 connections | per IP per minute |
| Payload size | 1 KB max | per push request |

Limits are enforced using Cloudflare KV as a sliding window counter. Exceeding a limit returns `429 Too Many Requests` with a `Retry-After: <seconds>` header.

**Why 60 push/minute?** Most conversations produce 1–2 avatar events per response. 60/min = 1/second sustained, which is more than enough even for rapid back-and-forth. The limit mainly prevents runaway scripts from hammering the relay.

---

## WebSocket Protocol

### Connection Lifecycle

```
Client                              Server (DO)
──────                              ───────────
  │──── WS Upgrade ────────────────────▶ │
  │◀─── 101 Switching Protocols ──────── │
  │                                       │
  │◀─── {type:"avatar_event", replay:true} (last known state, if any)
  │                                       │
  │                          [push event arrives via POST]
  │◀─── {type:"avatar_event", replay:false}
  │                                       │
  │──── ping (every 30s) ───────────────▶ │
  │◀─── pong ─────────────────────────── │
  │                                       │
  │──── close ──────────────────────────▶ │
  │                              (removed from session set)
```

### Reconnection (Client Responsibility)

The avatar app handles reconnection automatically with exponential backoff:

```
Disconnect detected
  → wait 1s + jitter → reconnect attempt 1
  → wait 2s + jitter → reconnect attempt 2
  → wait 4s + jitter → reconnect attempt 3
  → ... (doubles each time, max 30s)
```

On successful reconnect, the server replays the last known event so the avatar immediately snaps to the correct state.

---

## Durable Object Design

```typescript
export class Channel implements DurableObject {
  // Active WebSocket sessions
  private sessions: Set<WebSocket>;

  // Last event received — replayed to new connections
  private lastEvent: AvatarEvent | null;

  // On push: broadcast to all sessions, clean up dead ones
  // On WS connect: add to sessions, send lastEvent
  // On WS close/error: remove from sessions
  // On hibernation wake: restore sessions from state.getWebSockets()
}
```

**Hibernation:** When no WebSocket connections are open and no requests arrive, the DO hibernates automatically. Memory is freed, billing stops. On next request, it wakes up and reconnects existing WebSocket sessions. This is transparent to clients — they receive the standard WebSocket close event and reconnect.

**Eviction:** If a DO is evicted (e.g., no activity for 10+ minutes), `lastEvent` is lost. The avatar app simply holds its last state until the next event arrives.

**DO ID derivation:**
```typescript
async function getChannel(env: Env, token: string): Promise<DurableObjectStub> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token)
  );
  const id = env.CHANNEL.idFromName(
    Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  );
  return env.CHANNEL.get(id);
}
```

---

## Self-Hosting

You can run your own relay instead of using `relay.projectavatar.dev`. You need a Cloudflare account with Workers and Durable Objects enabled (both available on the free tier).

### Deploy

```bash
# Clone
git clone https://github.com/linh-n/projectavatar.git
cd projectavatar/relay

# Install dependencies
npm install

# Copy and configure wrangler
cp wrangler.example.toml wrangler.toml
# Edit wrangler.toml: set your account_id

# Deploy
npx wrangler deploy
```

### wrangler.toml

```toml
name = "project-avatar-relay"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[durable_objects.bindings]]
name = "CHANNEL"
class_name = "Channel"

[[migrations]]
tag = "v1"
new_classes = ["Channel"]

[vars]
RELAY_VERSION = "1.0.0"
```

### Configure the Avatar App

In Settings → Relay URL, change from `https://relay.projectavatar.dev` to your Worker URL (e.g., `https://project-avatar-relay.your-subdomain.workers.dev`).

For the output filter, update `AVATAR_RELAY_URL` in your filter config.

### Cost

At typical usage (1–2 events/minute per user), Cloudflare Workers free tier (100,000 requests/day) supports thousands of active users. Durable Objects free tier is equally generous. Self-hosting costs are effectively zero unless you're running a public relay for many users.

---

## Security Considerations

**The token is the only auth.** Anyone with your token can push events to your avatar and read your event stream. Keep it private.

**The event payload is non-sensitive.** It only contains emotion/action/prop/intensity. No message content, no user data. Even if a token leaks, the worst case is someone making your avatar look confused.

**End-to-end encryption is not implemented in v1.** For most use cases, the payload sensitivity doesn't justify the complexity. If you need it, contribute it.

**CORS is open (`*`).** The relay accepts cross-origin requests because the output filter runs from various origins (Tauri, browser, Node.js process). The token scopes access.
