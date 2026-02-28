# AGENTS.md — Project Avatar

Coding agent context for this repository.

## Repo Structure

Monorepo with independently deployable packages:

- `packages/shared/` — shared types, validation, constants. Imported by relay, web, and clip-manager.
- `packages/openclaw-avatar/` — OpenClaw plugin. TypeScript, loaded via jiti — **no build step**.
- `relay/` — Cloudflare Worker + Durable Object. Deployed to `relay.projectavatar.io`.
- `web/` — React + Vite avatar viewer. Deployed to Cloudflare Pages at `app.projectavatar.io`.
- `clip-manager/` — Dev-only Vite app for managing FBX clips, tags, action/emotion mappings, and body part masking. Port 5174. Assets served from `web/public/` via shared `publicDir`.
- `skill/` — Agent skill layer (prompt template + output filters for non-OpenClaw agents).

## Branches

- `master` — production. Never push directly. PRs only.
- Feature branches off `master`: `feat/...`, `fix/...`, `chore/...`

## Architecture: Source of Truth

**The Durable Object owns channel state.** Model selection and `lastAgentEventAt` live in DO storage. The web app's localStorage is a cache only — DO always wins on connect.

- Token: identifies a channel (DO instance). Stored in plugin env var (`AVATAR_TOKEN`) and URL param.
- Model: stored in DO, synced to all WebSocket clients via `model_changed` broadcast.
- Share link format: `?token=abc123` — no model in URL.

## Animation Data Pipeline

```
clips.json (web/src/data/) — source of truth for all clip metadata + mappings
    ↓ imported at build time
clip-registry.ts — resolver (resolveClips, getActionDuration, getAllClipFiles)
    ↓
animation-controller.ts — runtime playback via Three.js AnimationMixer

Clip Manager (clip-manager/) — dev UI for editing clips.json
    ↓ POST /api/save-clips (Vite dev server)
clips.json
```

- `scripts/generate-clips-json.ts` — bootstrap script: generates clips.json from legacy clip-map data
- `npm run clips` — starts clip manager on port 5174
- `npm run clips:gen` — regenerates clips.json from scratch

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
- `web/src/avatar/clip-registry.ts` — Loads clips.json, resolves action+emotion+intensity → clip set.
- `web/src/data/clips.json` — Animation clip registry (45 clips, 29 actions, 14 emotions).
- `web/src/avatar/mixamo-loader.ts` — Loads Mixamo FBX, retargets to VRM 0.x/1.0.
- `web/src/app.tsx` — Routing: no token → TokenSetup, no model → ModelPickerOverlay, both → avatar.

### Clip Manager
- `clip-manager/src/app.tsx` — Three-panel layout: library, editor, preview.
- `clip-manager/src/preview/clip-preview.ts` — Standalone VRM + FBX preview engine with bone masking.
- `clip-manager/src/preview/preview-panel.tsx` — Preview UI with transport controls, masking driven by body parts.
- `clip-manager/src/body-parts.ts` — Body part → VRM bone mapping (head/torso/arms/legs).
- `clip-manager/src/components/body-part-picker.tsx` — Toggleable body part chips, drives both metadata and preview masking.
- `clip-manager/src/state.ts` — useReducer-based state management.
- `clip-manager/src/types.ts` — clips.json schema types.
- `clip-manager/vite.config.ts` — Includes `saveClipsPlugin()` — POST /api/save-clips writes to disk.

### Plugin
- `packages/openclaw-avatar/src/index.ts` — Registers lifecycle hooks + `/avatar` command.
- `packages/openclaw-avatar/openclaw.plugin.json` — Manifest with configSchema + commands.

### Shared
- `packages/shared/src/schema.ts` — AvatarEvent, ChannelState, WebSocketServerMessage, WebSocketClientMessage.
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

Phases complete: 1–4 (relay, web, skill, plugin, identity sync, presence, keepalive, expressions, multi-session arbitration).

Current: Clip Manager + JSON-driven animation registry.

## Animation System

Hybrid FBX + procedural: Mixamo FBX clips via AnimationMixer, additive procedural idle layer (breathing, sway, head drift), expression blend shapes.

### clips.json Schema
- `clips`: per-clip metadata (file, loop, mustFinish, fadeIn/Out, category, energy, bodyParts, tags, layering rules)
  - `bodyParts`: active bone mask — `['head','torso','arms','legs']` by default. Disabling a part strips those bone tracks from playback. Legs includes hips (root motion).
- `actions`: 29 actions, each with primary clip + optional layers + duration override
- `emotions`: 14 emotions, each with weightScale + action overrides + extra layers

### Expression System
- Blend shapes via `expressionManager.setValue(name, weight)` — exponential decay lerp
- Head bone euler offsets per emotion
- Breathing: sine wave on head pitch, always running

## Multi-Session Arbitration

Priority-based with first-mover tiebreaker. Lower priority = higher importance. Main sessions = 0, sub-agents = 1, nested = 2+. Stale sessions evicted after 60s silence.

## Expression System Detail

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

### Model requirements
**Must have blend shape binds.** The VRM spec lists expressions but doesn't require mesh bindings — many models have the labels with 0 binds (silent no-ops). Always verify with:
```js
vrm0.blendShapeMaster.blendShapeGroups.forEach(g =>
  console.log(g.presetName, 'binds:', (g.binds||[]).length)
)
```

## Multi-Session Arbitration Detail

Each push event carries `sessionId` (stable opaque string) and `priority` (lower = higher importance).

The Durable Object maintains an in-memory session registry. On push:
1. Register/update session entry — `firstPushAt` set once
2. Prune stale entries (> 60s silence)
3. Resolve winner: lowest priority; ties broken by earliest `firstPushAt`
4. Fan out only if pushing session is winner; suppressed pushes return `{ suppressed: true }`

Priority derivation: count `:subagent:` segments in sessionKey. Main = 0, sub-agent = 1, nested = 2+.

Key constants: `SESSION_ACTIVE_WINDOW_MS = 10_000`, `SESSION_EVICT_AFTER_MS = 60_000`.
