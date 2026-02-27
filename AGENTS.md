# AGENTS.md — Project Avatar

Coding agent context for this repository.

## Repo Structure

Monorepo with three independently deployable packages:

- `packages/shared/` — shared types, validation, constants. Imported by relay and web. The plugin copies what it needs (standalone, no cross-package deps at runtime).
- `packages/openclaw-avatar/` — OpenClaw plugin. TypeScript, loaded by OpenClaw via jiti — **no build step**. Entry: `src/index.ts`.
- `relay/` — Cloudflare Worker + Durable Object. Deployed to `relay.projectavatar.io`.
- `web/` — React + Vite app. Deployed to Cloudflare Pages at `app.projectavatar.io`.
- `skill/` — Agent skill layer (prompt template + output filters for non-OpenClaw agents).

## Branches

- `master` — production. Never push directly. PRs only.
- Feature branches off `master`: `feat/...`, `fix/...`, `chore/...`

## Architecture: Source of Truth

**The Durable Object owns channel state.** Model selection and `lastAgentEventAt` live in DO storage. The web app's localStorage is a cache only — DO always wins on connect.

- Token: identifies a channel (DO instance). Stored in plugin env var (`AVATAR_TOKEN`) and URL param.
- Model: stored in DO, synced to all WebSocket clients via `model_changed` broadcast.
- Share link format: `?token=abc123` — no model in URL.

## WebSocket Protocol

Server → client messages (`WebSocketServerMessage`):
- `channel_state` — sent on connect. Includes model, lastAgentEventAt, lastEvent, connectedClients.
- `avatar_event` — live agent activity.
- `model_changed` — broadcasted when any client calls `set_model`.

Client → server messages (`WebSocketClientMessage`):
- `set_model` — persisted to DO storage, echoed back to sender + all other clients.

## Key Files

### Relay
- `relay/src/channel.ts` — Durable Object. Handles push, stream, state, set_model.
- `relay/src/index.ts` — Worker entry. Routes: `POST /push/:token`, `GET /stream/:token`, `GET /channel/:token/state`, `GET /skill/install`.

### Web App
- `web/src/state/store.ts` — Zustand store. `applyChannelState()` is the single write path for DO state.
- `web/src/ws/web-socket-client.ts` — WebSocket client with keepalive (60s dead-connection timer).
- `web/src/avatar/avatar-canvas.tsx` — Mounts Three.js scene + WS client. Provides `WsContext` (sendSetModel).
- `web/src/avatar/avatar-scene.ts` — Three.js scene setup, render loop, visibility handling.
- `web/src/avatar/expression-controller.ts` — Blend shape weights + head bone movement + idle breathing.
- `web/src/app.tsx` — Routing: no token → TokenSetup, no model → ModelPickerOverlay, both → avatar.

### Plugin
- `packages/openclaw-avatar/src/index.ts` — Registers lifecycle hooks + `/avatar` command.
- `packages/openclaw-avatar/src/types.ts` — Standalone types (no shared package dep at runtime).
- `packages/openclaw-avatar/openclaw.plugin.json` — Manifest with configSchema + commands.

### Shared
- `packages/shared/src/schema.ts` — AvatarEvent, ChannelState, WebSocketServerMessage, WebSocketClientMessage, isValidModelId.
- `packages/shared/src/constants.ts` — TOKEN_REGEX, generateToken, CORS_HEADERS, RATE_LIMITS.

## Plugin: No Build Step

OpenClaw loads TypeScript via jiti. The plugin ships `src/*.ts` directly. No `tsc`, no `dist/`. CI runs tests only before publishing to npm.

## Testing

```bash
cd packages/openclaw-avatar && npm test   # vitest, 39 tests
cd relay && npx tsc --noEmit              # type check relay
cd web && npm run build                   # full web build (catches type errors)
```

## Current State

Phases complete:
- Phase 1: Relay server ✅
- Phase 2: Web app + avatar core ✅
- Phase 3: Agent skill + output filter ✅
- Phase 4: OpenClaw plugin ✅
- Phase 4.1: Identity persistence + multi-screen sync ✅
- Phase 4.2: Agent presence + /avatar command ✅
- Phase 4.3: WebSocket keepalive ✅
- Phase 4.4: Expression improvements ✅
- Phase 4.5: Multi-session arbitration ✅

Next: Phase 5 (Polish + Desktop).

## Animation System (v1.1.1)

Real Mixamo FBX animations via Three.js AnimationMixer.

### Files
- `web/src/avatar/mixamo-loader.ts` — loads FBX, retargets to VRM 0.x.
- `web/src/avatar/animation-controller.ts` — AnimationMixer wrapper. `loadAnimations()` loads all 7 FBX clips. `playAction()` fades between clips (0.6s).
- `web/public/animations/` — 7 Mixamo FBX files (downloaded "without skin", 30fps).

### Action → file mapping
waiting→idle.fbx, responding→responding.fbx, searching→searching.fbx, coding→coding.fbx, reading→reading.fbx, error→error.fbx, celebrating→celebrating.fbx

## Expression System (v1.2)

Facial expressions + head bone movement driven by `ExpressionController`.

### How it works
- **Blend shapes**: `expressionManager.setValue(name, weight)` — frame-rate independent exponential decay lerp (speed 3.0)
- **Head bone**: `humanoid.getNormalizedBoneNode('head')` — per-emotion euler offsets, lerped at speed 2.5
- **Breathing**: slow sine wave on head pitch (0.008 rad amplitude, ~11 breaths/min), always running

### Emotion → expression mapping
Weights are intentionally strong (0.65–1.0) — VRM blending is designed for full-weight combinations:
- `excited` → happy 1.0 + surprised 0.35, head up + right tilt
- `confused` → surprised 0.65, head side-tilt (z: 0.07)
- `concerned` → sad 0.65, head down + slight turn
- `satisfied` → happy 0.75 + relaxed 0.5, slight nod
- `thinking` → neutral 0.4 + lookUp 0.45, head up + tilt
- `focused` → neutral 1.0, slight forward lean

### VRM 0.x name normalization (three-vrm handles this automatically)
`joy→happy`, `sorrow→sad`, `fun→relaxed`, `lookup→lookUp`, etc.

### Model requirements
**Must have blend shape binds.** The VRM spec lists expressions but doesn't require mesh bindings — many models have the labels with 0 binds (silent no-ops). Always verify with:
```js
vrm0.blendShapeMaster.blendShapeGroups.forEach(g =>
  console.log(g.presetName, 'binds:', (g.binds||[]).length)
)
```
Any `binds: 0` = that expression does nothing on that model.

### Bundled models
- `web/public/models/avatarsample_c.vrm` — Official Pixiv VRoid sample (CC0). Full expressions, all binds wired. **Primary model.**
- `web/public/models/potato.vrm` — Lip-sync + blink only, no emotion expressions. Animation testing only.
- `web/src/assets/models/manifest.json` — model registry for the picker.

## Multi-Session Arbitration (v1.3)

Multiple concurrent agent sessions pushing to the same channel are handled by the relay via priority-based arbitration with a first-mover tiebreaker.

### How it works

Each push event carries two optional fields:
- `sessionId` — stable opaque string identifying the session (OpenClaw sessionKey passed as-is)
- `priority` — integer derived from sessionKey structure; lower = higher priority

The Durable Object maintains an in-memory session registry (`Map<sessionId, SessionEntry>`).
On each push:
1. Register/update the session entry — `firstPushAt` is set once and never changed
2. Prune stale entries (> 60s silence, lazy GC on write)
3. Resolve the active winner: lowest priority tier; ties broken by earliest `firstPushAt`
4. Fan out only if the pushing session is the winner; suppressed pushes return `{ ok: true, suppressed: true }`

The registry is ephemeral (in-memory only) — DO hibernation resets it. Sessions re-announce on their next push.

### Priority derivation (plugin side)

Priority = number of `:subagent:` segments in the OpenClaw sessionKey:
- Main/channel sessions → 0 (highest priority)
- Sub-agents → 1
- Nested sub-agents → 2
- Cron/isolated sessions → 1 (same as sub-agents)

### Tiebreaker: first-mover holds

Two concurrent sessions at the same priority (e.g. two channel agents sharing a token) both get priority 0. The one that pushed first holds the avatar until it goes idle (10s silence). Only then does the other session's next push win.

### Backward compatibility

Events without `sessionId` bypass arbitration entirely and always fan out — single-session and skill-based setups are unaffected.

### Key constants (relay/src/channel.ts)
- `SESSION_ACTIVE_WINDOW_MS = 10_000` — how long a session stays "active" after its last push
- `SESSION_EVICT_AFTER_MS = 60_000` — stale entry TTL (lazy GC)
