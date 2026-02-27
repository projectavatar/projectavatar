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

All phases through 4.3 are implemented and on branch `feat/phase-4.1-identity-sync`. See `IMPLEMENTATION.md` for the full technical plan.

Phases complete:
- Phase 1: Relay server ✅
- Phase 2: Web app + avatar core ✅
- Phase 3: Agent skill + output filter ✅
- Phase 4: OpenClaw plugin ✅
- Phase 4.1: Identity persistence + multi-screen sync ✅
- Phase 4.2: Agent presence + /avatar command ✅
- Phase 4.3: WebSocket keepalive ✅

Next: Phase 5 (Polish + Desktop).

## Animation System (v1.1.1)

Real Mixamo FBX animations via Three.js AnimationMixer. No more procedural bone manipulation.

### Files
- `web/src/avatar/mixamo-loader.ts` — loads FBX, retargets to VRM 0.x. Uses `mixamoVRMRigMap` + VRM 0.x coordinate flip (negate X/Z quaternion components, negate X/Z position components).
- `web/src/avatar/animation-controller.ts` — AnimationMixer wrapper. `loadAnimations()` loads all 7 FBX clips in parallel. `playAction()` fades between clips (0.6s).
- `web/public/animations/` — 7 Mixamo FBX files (downloaded "without skin", 30fps).

### Action → file mapping
waiting→idle.fbx, responding→responding.fbx, searching→searching.fbx, coding→coding.fbx, reading→reading.fbx, error→error.fbx, celebrating→celebrating.fbx

### VRM model
- `web/public/models/potato.vrm` — CC0 model from open-source-avatars registry
- `web/src/assets/models/manifest.json` — model registry for the picker
