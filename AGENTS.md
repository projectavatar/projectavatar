# AGENTS.md — Project Avatar

Coding agent context for this repository.

## Repo Structure

Monorepo with independently deployable packages:

- `packages/shared/` — shared types, validation, constants. Imported by all packages.
- `packages/avatar-engine/` — **3D rendering engine**. Three.js + VRM animation, expressions, procedural idle layer. Shared by `web/` and `clip-manager/`.
- `packages/openclaw-avatar/` — OpenClaw plugin. TypeScript, loaded via jiti — **no build step**.
- `relay/` — Cloudflare Worker + Durable Object. Deployed to `relay.projectavatar.io`.
- `web/` — React + Vite avatar viewer. Deployed to Cloudflare Pages at `app.projectavatar.io`.
- `clip-manager/` — Dev-only Vite app for managing FBX clips, tags, action/emotion mappings, body part masking, and animation layer testing. Port 5174. Assets served from `web/public/` via shared `publicDir`.
- `skill/` — Agent skill layer (prompt template + output filters for non-OpenClaw agents).

## Branches

- `master` — production. Never push directly. PRs only.
- Feature branches off `master`: `feat/...`, `fix/...`, `chore/...`, `refactor/...`

## Architecture: Source of Truth

**The Durable Object owns channel state.** Model selection and `lastAgentEventAt` live in DO storage. The web app's localStorage is a cache only — DO always wins on connect.

- Token: identifies a channel (DO instance). Stored in plugin env var (`AVATAR_TOKEN`) and URL param.
- Model: stored in DO, synced to all WebSocket clients via `model_changed` broadcast.
- Share link format: `?token=abc123` — no model in URL.

## Animation Data Pipeline

```
clips.json (web/src/data/) — source of truth for all clip metadata + mappings
    ↓ passed at runtime
ClipRegistry (avatar-engine) — resolver (resolveClips, getActionDuration, getAllClipFiles)
    ↓
AnimationController (avatar-engine) — runtime playback via Three.js AnimationMixer

Clip Manager (clip-manager/) — dev UI for editing clips.json
    ↓ POST /api/save-clips (Vite dev server)
clips.json
```

- `scripts/generate-clips-json.ts` — bootstrap script: generates clips.json from legacy clip-map data
- `npm run clips` — starts clip manager on port 5174
- `npm run clips:gen` — regenerates clips.json from scratch

## `@project-avatar/avatar-engine`

The shared rendering engine. No React, no WebSocket — pure Three.js + VRM.

Key classes:
- **AvatarScene** — scene, camera, lighting, render loop. Options: `{ grid: true }` for clip manager.
- **VrmManager** — VRM loading, VRM 0.x/1.0 normalization, placeholder cube fallback.
- **AnimationController** — accepts `ClipRegistry` instance. Hybrid FBX mixer + procedural idle layer. Layer toggles (`LayerState`): fbxClips, idleNoise, expressions, headOffset, blink.
- **ExpressionController** — VRM blend shapes + additive head bone rotation per emotion.
- **BlinkController** — random blink + micro-glance.
- **PropManager** — GLB prop loading + hand bone attachment.
- **ClipRegistry** — data-driven clip resolver. Accepts `ClipsJsonData` at construction (no static import). Both web and clip-manager pass their clips data.
- **StateMachine** — coordinates all controllers, dispatches avatar events, manages idle timeout.
- **Body parts** — bone ↔ body part mapping (head/torso/arms/legs), used by clip manager for bone masking.

Peer dependencies: `three`, `@pixiv/three-vrm`, `@project-avatar/shared`.

## WebSocket Protocol

Server → client messages (`WebSocketServerMessage`):
- `channel_state` — sent on connect. Includes model, lastAgentEventAt, lastEvent, connectedClients.
- `avatar_event` — live agent activity.
- `model_changed` — broadcasted when any client calls `set_model`.

Client → server messages (`WebSocketClientMessage`):
- `set_model` — persisted to DO storage, echoed back to sender + all other clients.

## Key Files

### Avatar Engine (`packages/avatar-engine/`)
- `src/avatar-scene.ts` — Three.js scene setup, render loop, visibility handling, optional grid.
- `src/animation-controller.ts` — FBX playback + procedural idle + layer toggles.
- `src/expression-controller.ts` — Blend shape weights + head bone euler offsets.
- `src/clip-registry.ts` — Data-driven clip resolver (ClipRegistry class).
- `src/state-machine.ts` — Event dispatch + idle timeout.
- `src/mixamo-loader.ts` — FBX → VRM retargeting.
- `src/body-parts.ts` — Bone ↔ body part mapping.
- `src/procedural/idle-layer.ts` — Breathing, sway, head drift (dual-sine noise).

### Relay
- `relay/src/channel.ts` — Durable Object. Handles push, stream, state, set_model.
- `relay/src/index.ts` — Worker entry. Routes: `POST /push/:token`, `GET /stream/:token`, `GET /channel/:token/state`, `GET /skill/install`.

### Web App
- `web/src/avatar/avatar-canvas.tsx` — React wrapper: creates engine instances + wires WebSocket.
- `web/src/state/store.ts` — Zustand store. `applyChannelState()` is the single write path for DO state.
- `web/src/ws/web-socket-client.ts` — WebSocket client with keepalive (60s dead-connection timer).
- `web/src/components/dev-panel.tsx` — Layer toggles, event sender, clip inspector.
- `web/src/data/clips.json` — Animation clip registry (45 clips, 29 actions, 14 emotions).
- `web/src/app.tsx` — Routing: no token → TokenSetup, no model → ModelPickerOverlay, both → avatar.

### Clip Manager
- `clip-manager/src/app.tsx` — Three-panel layout: library, editor, preview.
- `clip-manager/src/preview/clip-preview.ts` — Composes engine primitives (AvatarScene + VrmManager + loadMixamoAnimation). Supports bone masking + optional full engine mode with layer toggles.
- `clip-manager/src/preview/preview-panel.tsx` — Preview UI with transport controls, layer toggles (idle, blink, expressions, etc.), body part masking.
- `clip-manager/src/components/body-part-picker.tsx` — Toggleable body part chips (uses engine's body-parts).
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
cd clip-manager && npm run build          # clip manager build
npx tsc -p packages/avatar-engine/tsconfig.json --noEmit  # engine type check
```

## Current State

Phases complete: 1–4 (relay, web, skill, plugin, identity sync, presence, keepalive, expressions, multi-session arbitration).

Current: Clip Manager + JSON-driven animation registry + shared avatar engine.

## Animation System

Hybrid FBX + procedural. All animation logic lives in `packages/avatar-engine/`:

- **FBX clips**: Mixamo animations retargeted to VRM via `loadMixamoAnimation()`, played through `THREE.AnimationMixer`.
- **Procedural idle layer**: breathing, weight shift, micro-sway, head drift, shoulder settle, arm swing — layered dual-sine waves at irrational frequency ratios (never repeats).
- **Expressions**: VRM blend shapes + additive head bone euler offsets, lerped smoothly.
- **Layer toggles**: FBX clips, idle noise, expressions, head offset, blink — each independently toggleable. Available in both web app (dev panel) and clip manager (preview panel).

### clips.json Schema
- `clips`: per-clip metadata (file, loop, mustFinish, fadeIn/Out, category, energy, bodyParts, tags, layering rules)
  - `bodyParts`: active bone mask — `['head','torso','arms','legs']` by default. Disabling a part strips those bone tracks from playback. Legs includes hips (root motion).
- `actions`: 29 actions, each with primary clip + optional layers + duration override
- `emotions`: 14 emotions, each with weightScale + action overrides + extra layers

### ClipRegistry (data-driven)
The `ClipRegistry` class accepts clips data at construction — no static JSON import. This allows:
- `web/` to pass its build-time-imported clips.json
- `clip-manager/` to pass the live-edited state (changes reflected in preview without reload)

## Multi-Session Arbitration

Priority-based with first-mover tiebreaker. Lower priority = higher importance. Main sessions = 0, sub-agents = 1, nested = 2+. Stale sessions evicted after 60s silence.

Each push event carries `sessionId` (stable opaque string) and `priority` (lower = higher importance).

The Durable Object maintains an in-memory session registry. On push:
1. Register/update session entry — `firstPushAt` set once
2. Prune stale entries (> 60s silence)
3. Resolve winner: lowest priority; ties broken by earliest `firstPushAt`
4. Fan out only if pushing session is winner; suppressed pushes return `{ suppressed: true }`

Priority derivation: count `:subagent:` segments in sessionKey. Main = 0, sub-agent = 1, nested = 2+.

Key constants: `SESSION_ACTIVE_WINDOW_MS = 10_000`, `SESSION_EVICT_AFTER_MS = 60_000`.
