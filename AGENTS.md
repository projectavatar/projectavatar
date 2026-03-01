# AGENTS.md — Project Avatar

Coding agent context for this repository.

## Repo Structure

Monorepo with independently deployable packages:

- `packages/shared/` — shared types, validation, constants. Imported by all packages.
- `packages/avatar-engine/` — **3D rendering engine**. Three.js + VRM animation, expressions, weight-based multi-clip blending with body part scoping, transition stabilization. Shared by `packages/web/` and `packages/clip-manager/`.
- `packages/openclaw-avatar/` — OpenClaw plugin. TypeScript, loaded via jiti — **no build step**.
- `packages/relay/` — Cloudflare Worker + Durable Object. Deployed to `relay.projectavatar.io`.
- `packages/web/` — React + Vite avatar viewer. Deployed to Cloudflare Pages at `app.projectavatar.io`.
- `packages/desktop/` — **Tauri v2 desktop app**. Wraps `web/` in a native window: transparent, borderless, always-on-top. WindowChrome component adds hover border + resize/drag/rotate controls. Builds for Windows + macOS via GitHub Actions.
- `packages/clip-manager/` — Dev-only Vite app for managing FBX clips, tags, action/emotion mappings, body part masking, and animation blending. Port 5174. Assets served from `packages/web/public/` via shared `publicDir`.

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
- **AnimationController** — weight-based multi-clip blending. Splits clips into per-body-part sub-actions. Finger bone retargeting (30 Mixamo→VRM mappings). Detects clip finger tracks and signals IdleLayer to skip procedural curl.
- **ClipRegistry** — data-driven clip resolver (v3). Resolves action + emotion + intensity + group index → final clip set with body part scoping. `selectGroup()` for weighted random selection, `isActionLooping()`, `getGroupCount()`. Dynamic fallback chain: action → idle action → first clip in registry.
- **ExpressionController** — VRM blend shapes + additive head bone rotation per emotion.
- **BlinkController** — random blink + micro-glance.
- **PropManager** — GLB prop loading + hand bone attachment.
- **StateMachine** — coordinates all controllers, dispatches avatar events, manages idle timeout.
- **AvatarScene** — scene, camera, lighting, render loop. Dynamic framing: orbit target lerps body→face based on zoom distance. Vertical orbit locked ±22° in prod (`dev: true` unlocks). Options: `{ grid, orbit, dev, desktop }`. `desktop: true` disables left-click rotation (reserved for window drag in Tauri). Supports custom render callback for postprocessing (bloom). Camera distance used by avatar-canvas to auto-switch idle modes.
- **VrmManager** — normalizes all VRMs to 1.6m height, centers hips at origin (0,0,0). Exposes `bodyCenter` & `faceCenter` for camera framing.
- **IdleLayer** — procedural idle animation with smooth mode blending. Air mode: hover bob, body tilt, backward lean, leg dangle with asymmetric tuck. Ground mode: breathing, sway, weight shift. Modes crossfade via `modeBlend` (exponential lerp). Auto-switches to ground when zoomed in (distance < threshold). Head tracking follows cursor with configurable influence. Runs after mixer.
- **EffectsManager** — orchestrates toggleable visual effects (particle aura, energy trails, bloom, holographic). All effects gate on `modelReady` and use exponential lerp fade.

### Visual Effects (`packages/avatar-engine/src/effects/`)
Four toggleable effects, all off by default, persisted to localStorage:
- **ParticleAura** — 80 orbiting particles with custom ShaderMaterial, additive blending
- **EnergyTrails** — ribbon geometry following middle finger distal bones
- **BloomEffect** — UnrealBloomPass + SMAAPass via EffectComposer, strength 0.4. Uses `AvatarScene.setCustomRender()`.
- **Holographic** — overlay SkinnedMesh clones as siblings in VRM scene graph. Custom scan line + fresnel ShaderMaterial with `skinning: true`.

**Important:** VRM uses MToon materials. Shader injection via `onBeforeCompile` breaks MToon. Overlay meshes must be siblings in the VRM scene graph (not external Group) to share skeleton references.

### Animation Data Pipeline

```
clips.json (packages/web/src/data/) — source of truth for all clip metadata + mappings
    ↓ passed at runtime
ClipRegistry (avatar-engine) — resolver (resolveClips, getActionDuration, getAllClipFiles)
    ↓
AnimationController (avatar-engine) — runtime playback via Three.js AnimationMixer
    ↓ post-mixer
~~TransitionStabilizer~~ (dead code, not imported) — foot skating handled by crossfade timing

Clip Manager (packages/clip-manager/) — dev UI for editing clips.json (groups, clips, rarity)
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
- `src/animation-controller.ts` — Weight-based multi-clip blending + body part sub-actions + finger track detection.
- `src/expression-controller.ts` — Blend shape weights + head bone euler offsets.
- `src/clip-registry.ts` — Data-driven clip resolver (ClipRegistry class).
- `src/state-machine.ts` — Event dispatch + idle timeout.
- `src/mixamo-loader.ts` — FBX → VRM retargeting (includes 30 finger bone mappings).
- `src/body-parts.ts` — Bone ↔ body part mapping (finger bones in `arms` group).
- `src/idle-layer.ts` — Procedural idle (air/ground modes, leg dangle, backward lean, finger curl).
- `src/avatar-scene.ts` — Three.js scene setup, render loop, visibility handling, optional grid, custom render callback.
- `src/effects/` — Visual effects: particle-aura, energy-trails, bloom-effect, holographic, effects-manager.

### Relay
- `packages/relay/src/channel.ts` — Durable Object. Handles push, stream, state, set_model.
- `packages/relay/src/index.ts` — Worker entry. Routes: `POST /push/:token`, `GET /stream/:token`, `GET /channel/:token/state`, 

### Web App
- `packages/web/src/avatar/avatar-canvas.tsx` — React wrapper: creates engine instances + wires WebSocket.
- `packages/web/src/state/store.ts` — Zustand store. `applyChannelState()` is the single write path for DO state.
- `packages/web/src/ws/web-socket-client.ts` — WebSocket client with keepalive (60s dead-connection timer).
- `packages/web/src/components/dev-panel.tsx` — Layer toggles, event sender, clip inspector.
- `packages/web/src/data/clips.json` — Animation clip registry.
- `packages/web/src/app.tsx` — Routing: no token → TokenSetup, no model → ModelPickerOverlay, both → avatar.

### Clip Manager
- `packages/clip-manager/src/app.tsx` — Three-panel layout: library, editor, preview.
- `packages/clip-manager/src/preview/clip-preview.ts` — Composes engine primitives. Supports bone masking + full engine mode with layer toggles.
- `packages/clip-manager/src/preview/preview-panel.tsx` — Preview UI with transport controls, layer toggles, body part masking.
- `packages/clip-manager/src/components/body-part-picker.tsx` — Toggleable body part chips.
- `packages/clip-manager/src/state.ts` — useReducer-based state management.

### Desktop App (`packages/desktop/`)
- `src/desktop-app.tsx` — Wraps web `<App />`, forces transparent theme, suppresses context menu.
- `src/window-chrome.tsx` — Hover border (dashed, rounded), edge/corner resize, left-drag to move, right-click to rotate.
- `src-tauri/tauri.conf.json` — Window config: transparent, no decorations, always-on-top.
- `src-tauri/capabilities/default.json` — Tauri permissions for dragging, resizing, closing.

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
cd packages/relay && npm run test                 # vitest, 55 tests + type check
cd packages/web && npm run build                   # full web build
cd packages/clip-manager && npm run build          # clip manager build
npx tsc -p packages/avatar-engine/tsconfig.json --noEmit  # engine type check
```

## Multi-Session Arbitration

Priority-based with first-mover tiebreaker. Lower priority = higher importance. Main sessions = 0, sub-agents = 1, nested = 2+. Stale sessions evicted after 60s silence.

Key constants: `SESSION_ACTIVE_WINDOW_MS = 10_000`, `SESSION_EVICT_AFTER_MS = 60_000`.
