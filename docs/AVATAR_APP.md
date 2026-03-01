# Avatar App

The avatar app renders a 3D anime-style character that reacts in real-time to your AI agent's state.

**The browser app is the primary product.** Go to [app.projectavatar.io](https://app.projectavatar.io) — no install, works immediately, OBS Browser Source ready.

The desktop app (Tauri) is optional — adds always-on-top, borderless window, system tray, and autostart.

Both share the same rendering core (`packages/avatar-engine/`) — pure TypeScript + Three.js, no platform-specific dependencies.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Avatar App                             │
│                                                          │
│  ┌──────────────┐    ┌────────────────────────────────┐ │
│  │ WebSocket    │    │     Avatar Engine                │ │
│  │ Client       │───▶│                                 │ │
│  │              │    │  StateMachine                   │ │
│  │ auto-        │    │    ├── AnimationController      │ │
│  │ reconnect    │    │    ├── ExpressionController     │ │
│  └──────────────┘    │    ├── BlinkController          │ │
│                      │    ├── IdleLayer                │ │
│  ┌──────────────┐    │    ├── PropManager              │ │
│  │ Zustand      │    │    ├── EffectsManager           │ │
│  │ Store        │───▶│    └── VfxManager               │ │
│  │              │    │                                 │ │
│  └──────────────┘    │  AvatarScene (Three.js)         │ │
│                      │    ├── VrmManager               │ │
│                      │    ├── Camera + Lights          │ │
│                      │    └── Render loop              │ │
│                      └────────────────────────────────┘ │
│                                                          │
│  Desktop only:           Browser only:                   │
│  ├── WindowChrome        └── SetupWizard / TokenSetup   │
│  ├── Always-on-top                                       │
│  ├── Autostart                                           │
│  └── Updater                                             │
└─────────────────────────────────────────────────────────┘
```

---

## Expression System

Emotions map to VRM blend shape expressions via `ExpressionController`:

| Emotion | VRM Blend Shapes |
|---------|-----------------|
| idle | neutral (1.0) |
| thinking | neutral (0.4), lookUp (0.45) |
| excited | happy (1.0), surprised (0.35) |
| confused | surprised (0.65), neutral (0.2) |
| happy | happy (1.0) |
| angry | angry (1.0) |
| sad | sad (1.0) |
| surprised | surprised (1.0) |
| bashful | happy (0.4), neutral (0.5) |
| nervous | neutral (0.3), surprised (0.4) |

Expressions interpolate smoothly (exponential lerp, speed 3.0). Intensity scales blend weights: low = 0.5x, medium = 1.0x, high = 1.2x (clamped to 1.0).

---

## Animation System (v3)

Weight-based multi-clip blending with body part scoping. All logic in `packages/avatar-engine/`.

### clips.json v3 Schema

Source of truth: `packages/web/src/data/clips.json`

- **clips{}** — per-clip metadata (file, loop, fadeIn/Out, category, energy, bodyParts, tags)
- **actions{}** — each with `groups[]` — animation groups with weighted random selection
  - Each group has `rarity` (probability weight) + `clips[]` (layers with weight + bodyParts)
  - On action trigger, one group is randomly selected based on rarity
  - Looping actions re-roll group on each cycle
- **emotions{}** — 10 emotions with `weightScale` + action `overrides` + extra `layers`

### 12 Actions
`idle`, `talking`, `typing`, `nodding`, `laughing`, `celebrating`, `dismissive`, `searching`, `nervous`, `sad`, `plotting`, `greeting`

### Blending Model
All clips play simultaneously on `THREE.AnimationMixer`. Each clip is split into per-body-part sub-clips (track filtering). Weights normalized per body-part group.

Body parts: `head`, `torso`, `arms` (includes fingers), `legs`, `feet`.

### Crossfade
Outgoing fadeOut duration matches incoming fadeIn for complementary curves (old + new = 1.0). Uses `crossFadeTo(action, duration, warp=true)`.

Fade values by category:
- **Idle** (0.6/0.6) — slow, gentle
- **Continuous** (0.4/0.4) — responsive
- **Emotion** (0.5/0.5) — gradual mood shifts
- **Gesture high-energy** (0.1 in / 0.35 out) — snap in, ease out
- **Gesture medium** (0.15 in / 0.3 out)

### Idle Layer (Procedural)

`IdleLayer` adds procedural animation on top of mixer clips:

**Air mode** (default): hover bob (double sine wave), body tilt, backward lean, leg dangle with asymmetric tuck, head tracking toward camera/cursor.

**Ground mode**: breathing, torso sway, weight shift. Activates when camera is zoomed in.

Modes crossfade via exponential lerp. Runs AFTER the mixer (additive).

### Finger Animation
30 Mixamo→VRM bone retargeting mappings. Clips with finger tracks use clip data; clips without get procedural finger curl from IdleLayer.

---

## Prop System

Props are GLB models placed in **world space** (not bone-attached). Configured per-clip in `clips.json` via `ClipPropBinding`:

```typescript
interface ClipPropBinding {
  prop: string;           // GLB filename (without extension)
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  material: 'solid' | 'holographic' | 'ghostly';
}
```

**Material styles:**
- **solid** — original GLB materials
- **holographic** — scanline + fresnel shader, additive blending, cyan glow
- **ghostly** — simple transparency with emissive fresnel

Props fade in/out over 0.35s on action transitions. Only one prop active at a time.

Prop models: `packages/web/public/props/` (keyboard.glb, tablet.glb).

**Idle layer bob sync:** When a prop is active, PropManager reads `IdleLayer.getBobOffset()` and adjusts the prop's Y position to follow the avatar's hover bob — prop floats with the body instead of staying fixed in space.

---

## Visual Effects

### Toggleable Effects (`EffectsManager`)
Four toggleable effects, all off by default, persisted to localStorage:

| Effect | Description |
|--------|-------------|
| ParticleAura | 80 orbiting particles with custom ShaderMaterial, additive blending |
| EnergyTrails | Ribbon geometry following fingertip bones |
| BloomEffect | UnrealBloomPass + SMAAPass (WebGL needs SMAA for postprocessing FBOs) |
| Holographic | Overlay SkinnedMesh clones as siblings in VRM scene graph, scanline + fresnel shader |

### Emotion VFX (`VfxManager`)
Data-driven particle effects per emotion/action, configured in `clips.json`:

Engine-supported types: `thought-bubbles`, `sparkles`, `hearts`, `rain`, `embers`, `confetti`, `particle-aura`, `sweat-drops`, `warm-dust`. Not all are actively used in clips.json — types are available for binding via the clip manager.

Each binding has type, color, intensity, and vertical offset.

---

## WebSocket Client

`packages/web/src/ws/web-socket-client.ts`

- Connects to `wss://relay.projectavatar.io/stream/:token`
- Auto-reconnects with backoff on disconnect
- 60s dead-connection timer (reset by any message or keepalive ping)
- Dispatches events to the StateMachine

---

## Desktop App (Tauri v2)

`packages/desktop/` — wraps the web app in a native window.

### Window Features
- Transparent, borderless, always-on-top
- `WindowChrome`: hover border (dashed, rounded), edge/corner resize handles
- Left-drag anywhere to move window (skip buttons via `data-no-drag`)
- Right-drag to rotate avatar (OrbitControls)
- Close (✕) and always-on-top toggle (📌) buttons
- Auto-hide UI after 1s idle (`useIdleHide(1000)`)

### Desktop-Only Features
- **Autostart** with OS (macOS LaunchAgent, Windows registry)
- **Auto-updater** (checks GitHub releases, NSIS on Windows)
- **Cursor head tracking** — avatar follows mouse cursor, returns to camera after 5s idle

### Configuration
- `packages/desktop/src-tauri/tauri.conf.json` — window config, CSP, updater
- `packages/desktop/src-tauri/capabilities/default.json` — Tauri permissions

---

## Browser App

### Onboarding Flow

**New users** → `SetupWizard`:
1. **Model Picker** — choose VRM model from grid, token auto-generated silently
2. **Setup Screen** — avatar renders in background, floating overlay shows Avatar URL + Skill Install URL, auto-dismisses on first WebSocket event

**Returning users** (token + model in localStorage/URL) → straight to avatar.

### URL State

```
https://app.projectavatar.io/?token=YOUR_TOKEN
```

URL params win over localStorage. `history.replaceState` keeps URL in sync.

### Loading

Remote assets loaded via `AssetResolver` — models and animations fetched from web CDN with loading progress bar overlay.

### OBS Browser Source

1. Add Browser Source in OBS
2. URL: `https://app.projectavatar.io/?token=YOUR_TOKEN`
3. Width: 400, Height: 600
4. Transparent background — composites directly over your stream

---

## Settings

Persisted to localStorage. Available in the Settings drawer:

| Setting | Default | Description |
|---------|---------|-------------|
| Token | auto-generated | Relay channel identifier |
| Relay URL | `https://relay.projectavatar.io` | Relay server base URL |
| Model | — | Selected VRM model |
| Render Scale | 1x | Pixel ratio (1x/2x/3x) |
| Effects | all off | Particle aura, energy trails, bloom, holographic |
| Layer toggles | all on | FBX clips, idle layer, expressions, blink |

---

## Deployment

### Browser (Cloudflare Pages)
Auto-deployed from `packages/web/` on push to `master`. Custom domain: `app.projectavatar.io`.

### Desktop (Tauri)
CI builds via GitHub Actions — matrix across macOS (arm64, x64), Windows (x64), Linux (x64). Produces `.dmg`, `.msi`/`.exe` (NSIS), `.AppImage`/`.deb`. Draft releases on tag push.
