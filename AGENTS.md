# AGENTS.md — Project Avatar

Coding agent context for this repository.

## Repo Structure

Monorepo with independently deployable packages:

- `packages/shared/` — shared types, validation, constants. Imported by all packages.
- `packages/avatar-engine/` — **3D rendering engine**. Three.js + VRM animation, expressions, weight-based multi-clip blending with body part scoping, transition stabilization. Shared by `web/` and `clip-manager/`.
- `packages/openclaw-avatar/` — OpenClaw plugin. TypeScript, loaded via jiti — **no build step**.
- `relay/` — Cloudflare Worker + Durable Object. Deployed to `relay.projectavatar.io`.
- `web/` — React + Vite avatar viewer. Deployed to Cloudflare Pages at `app.projectavatar.io`.
- `clip-manager/` — Dev-only Vite app for managing FBX clips, tags, action/emotion mappings, body part masking, and animation blending. Port 5174. Assets served from `web/public/` via shared `publicDir`.
- `skill/` — Agent skill layer (prompt template + output filters for non-OpenClaw agents).

## Branches

- `master` — production. Never push directly. PRs only.
- Feature branches off `master`: `feat/...`, `fix/...`, `chore/...`, `refactor/...`

## Architecture: Source of Truth

**The Durable Object owns channel state.** Model selection and `lastAgentEventAt` live in DO storage. The web app's localStorage is a cache only — DO always wins on connect.

- Token: identifies a channel (DO instance). Stored in plugin env var (`AVATAR_TOKEN`) and URL param.
- Model: stored in DO, synced to all WebSocket clients via `model_changed` broadcast.
- Share link format: `?token=abc123` — no model in URL.

## Animation System (v3)

Weight-based multi-clip blending with body part scoping. All animation logic lives in `packages/avatar-engine/`.

### clips.json v3 Schema
- `clips{}`: per-clip metadata (file, loop, fadeIn/Out, category, energy, bodyParts, tags)
- `actions{}`: each with `groups[]` — animation groups with weighted random selection
  - Each group has `rarity` (probability weight) + `clips[]` (clip layers with weight + bodyParts)
  - When an action fires, one group is randomly selected based on rarity weights
  - For looping actions (idle), a new group is re-rolled after each animation cycle
  - `durationOverride` at the action level (shared across all groups)
- `emotions{}`: 10 emotions with `weightScale` + action `overrides` + extra `layers`

### Actions (12)
`idle`, `talking`, `typing`, `nodding`, `laughing`, `celebrating`, `dismissive`, `searching`, `nervous`, `sad`, `plotting`, `greeting`

### Emotions (10)
`idle`, `thinking`, `excited`, `confused`, `happy`, `angry`, `sad`, `surprised`, `bashful`, `nervous`

### Blending Model
All clips play simultaneously on `THREE.AnimationMixer`. Each clip is split into per-body-part sub-clips (track filtering). Weights normalized per body-part group so total influence always sums to 1.0.

Body parts: `head`, `torso`, `arms`, `legs` (hips + upper/lower leg), `feet`.

### Crossfade Convention
Three.js mixer does NOT normalize weights — if total weight < 1.0, rest pose (T-pose) bleeds through. Outgoing fadeOut duration always matches incoming fadeIn to ensure complementary curves (old + new = 1.0 at every frame).

**Fade philosophy by category:**
- **Idle** (0.6/0.6): slow, gentle transitions between idle variations
- **Continuous** (0.4/0.4): responsive but smooth for talking/typing
- **Emotion** (0.5/0.5): gradual mood shifts
- **Gesture high-energy** (0.1 in / 0.35 out): snap into the gesture, ease out
- **Gesture medium** (0.15 in / 0.3 out): slightly softer entry

Note: per-clip `fadeOut` values in clips.json are metadata only. The actual fade-out duration used at runtime is always the incoming clip's `fadeIn` (for weight complementarity).

### Key Engine Classes
- **AnimationController** — weight-based multi-clip blending. Splits clips into per-body-part sub-actions. Integrates TransitionStabilizer for smooth transitions.
- **TransitionStabilizer** — masks crossfade artifacts for hips and hands via soft positional pinning. Foot skating is handled by per-body-part crossfade timing (fast feet, slow hips) instead of procedural arcs.
- **ClipRegistry** — data-driven clip resolver (v3). Resolves action + emotion + intensity + group index → final clip set with body part scoping. `selectGroup()` for weighted random selection, `isActionLooping()`, `getGroupCount()`. Dynamic fallback chain: action → idle action → first clip in registry.
- **ExpressionController** — VRM blend shapes + additive head bone rotation per emotion.
- **BlinkController** — random blink + micro-glance.
- **PropManager** — GLB prop loading + hand bone attachment.
- **StateMachine** — coordinates all controllers, dispatches avatar events, manages idle timeout.
- **AvatarScene** — scene, camera, lighting, render loop. Dynamic framing: orbit target lerps body→face based on zoom distance. Vertical orbit locked ±22° in prod (`dev: true` unlocks). Options: `{ grid, orbit, dev }`.
- **VrmManager** — normalizes all VRMs to 1.6m height, centers hips at origin (0,0,0). Exposes `bodyCenter` & `faceCenter` for camera framing.

### Animation Data Pipeline

```
clips.json (web/src/data/) — source of truth for all clip metadata + mappings
    ↓ passed at runtime
ClipRegistry (avatar-engine) — resolver (resolveClips, getActionDuration, getAllClipFiles)
    ↓
AnimationController (avatar-engine) — runtime playback via Three.js AnimationMixer
    ↓ post-mixer
TransitionStabilizer (avatar-engine) — soft pins for hips/hands; foot skating handled by crossfade timing

Clip Manager (clip-manager/) — dev UI for editing clips.json (groups, clips, rarity)
    ↓ POST /api/save-clips (Vite dev server)
clips.json
```

## Clip Manager

Default tab: Actions. Tab order: Actions → Emotions → Clips.

All lists sorted alphabetically. Three-panel layout: left list, center editor, right preview.

Dev servers: web `:5173`, clip-manager `:5174`.

## WebSocket Protocol

Server → client messages (`WebSocketServerMessage`):
- `channel_state` — sent on connect. Includes model, lastAgentEventAt, lastEvent, connectedClients.
- `avatar_event` — live agent activity.
- `model_changed` — broadcasted when any client calls `set_model`.

Client → server messages (`WebSocketClientMessage`):
- `set_model` — persisted to DO storage, echoed back to sender + all other clients.

## Key Files

### Avatar Engine (`packages/avatar-engine/`)
- `src/animation-controller.ts` — Weight-based multi-clip blending + body part sub-actions.
- `src/transition-stabilizer.ts` — Pins hips/hands during transitions (soft constraints). Foot skating handled by per-body-part crossfade timing in animation-controller.
- `src/expression-controller.ts` — Blend shape weights + head bone euler offsets.
- `src/clip-registry.ts` — Data-driven clip resolver (ClipRegistry class).
- `src/state-machine.ts` — Event dispatch + idle timeout.
- `src/mixamo-loader.ts` — FBX → VRM retargeting.
- `src/body-parts.ts` — Bone ↔ body part mapping.
- `src/avatar-scene.ts` — Three.js scene setup, render loop, visibility handling, optional grid.

### Relay
- `relay/src/channel.ts` — Durable Object. Handles push, stream, state, set_model.
- `relay/src/index.ts` — Worker entry. Routes: `POST /push/:token`, `GET /stream/:token`, `GET /channel/:token/state`, 

### Web App
- `web/src/avatar/avatar-canvas.tsx` — React wrapper: creates engine instances + wires WebSocket.
- `web/src/state/store.ts` — Zustand store. `applyChannelState()` is the single write path for DO state.
- `web/src/ws/web-socket-client.ts` — WebSocket client with keepalive (60s dead-connection timer).
- `web/src/components/dev-panel.tsx` — Layer toggles, event sender, clip inspector.
- `web/src/data/clips.json` — Animation clip registry.
- `web/src/app.tsx` — Routing: no token → TokenSetup, no model → ModelPickerOverlay, both → avatar.

### Clip Manager
- `clip-manager/src/app.tsx` — Three-panel layout: library, editor, preview.
- `clip-manager/src/preview/clip-preview.ts` — Composes engine primitives. Supports bone masking + full engine mode with layer toggles.
- `clip-manager/src/preview/preview-panel.tsx` — Preview UI with transport controls, layer toggles, body part masking.
- `clip-manager/src/components/body-part-picker.tsx` — Toggleable body part chips.
- `clip-manager/src/state.ts` — useReducer-based state management.

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
cd web && npm run build                   # full web build
cd clip-manager && npm run build          # clip manager build
npx tsc -p packages/avatar-engine/tsconfig.json --noEmit  # engine type check
```

## Multi-Session Arbitration

Priority-based with first-mover tiebreaker. Lower priority = higher importance. Main sessions = 0, sub-agents = 1, nested = 2+. Stale sessions evicted after 60s silence.

Key constants: `SESSION_ACTIVE_WINDOW_MS = 10_000`, `SESSION_EVICT_AFTER_MS = 60_000`.
