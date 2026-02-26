# Avatar App

The avatar app is the visual side of Project Avatar — a 3D anime-style character that reacts in real-time to your AI agent's state.

**The browser app is the primary product.** Go to [app.projectavatar.io](https://app.projectavatar.io) — no install, works immediately, OBS Browser Source ready.

The desktop app (Tauri) is optional and adds exactly two things: always-on-top window and system tray. If you don't need those, use the browser app.

It comes in two forms from the same codebase:

- **Browser app** — primary, `app.projectavatar.io`, zero install, OBS-ready
- **Desktop app** (Tauri) — optional, native window, always-on-top, system tray

The rendering core (`web/src/avatar/`) is pure TypeScript + Three.js — no Tauri or browser-specific dependencies — so it runs identically in both contexts.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Avatar App                         │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │ WebSocket    │    │     Avatar Renderer        │   │
│  │ Client       │───▶│                           │   │
│  │              │    │  StateMachine             │   │
│  │ reconnects   │    │    ├── ExpressionCtrl     │   │
│  │ on drop      │    │    ├── AnimationCtrl      │   │
│  └──────────────┘    │    └── PropManager        │   │
│                      │                           │   │
│  ┌──────────────┐    │  AvatarScene (Three.js)   │   │
│  │ Settings     │    │    ├── VrmManager         │   │
│  │ (Zustand)    │───▶│    ├── Camera / Lights    │   │
│  │              │    │    └── Render loop        │   │
│  └──────────────┘    └──────────────────────────┘   │
│                                                      │
│  Desktop only:       Browser only:                   │
│  ├── Tauri tray      └── TokenSetup page            │
│  ├── Always-on-top                                   │
│  └── Native file picker                              │
└─────────────────────────────────────────────────────┘
```

---

## Tauri Setup

### Window Configuration

The desktop app renders as a transparent, frameless, always-on-top window:

```json
{
  "app": {
    "windows": [
      {
        "title": "Project Avatar",
        "width": 400,
        "height": 600,
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": true,
        "resizable": true,
        "skipTaskbar": false,
        "shadow": false
      }
    ]
  }
}
```

The transparent window means the canvas renders with `alpha: true` — the avatar floats directly on the desktop with no background. `decorations: false` removes the OS chrome; a custom draggable `<TitleBar />` component is rendered instead.

### IPC Commands

Tauri IPC bridges Rust ↔ React for native operations:

```rust
// src-tauri/src/commands.rs

#[tauri::command]
fn set_always_on_top(window: tauri::Window, value: bool) {
    window.set_always_on_top(value).ok();
}

#[tauri::command]
fn get_window_position(window: tauri::Window) -> (i32, i32) {
    let pos = window.outer_position().unwrap_or_default();
    (pos.x, pos.y)
}

#[tauri::command]
async fn pick_vrm_file() -> Option<String> {
    // Opens native file picker filtered to .vrm files
    // Returns file path or None if cancelled
    tauri::api::dialog::FileDialogBuilder::new()
        .add_filter("VRM Model", &["vrm"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned())
}
```

---

## VRM Loading and Model Management

### VRM Format

VRM is a 3D avatar format built on top of glTF 2.0. It adds:
- Standardized humanoid skeleton (VRMHumanoid)
- Expression/blend shape system (VRMExpressionManager)
- Spring bones for secondary motion (VRMSpringBoneManager)
- Material and metadata specs

All conforming VRM 1.0 models implement the same standard expressions and bone structure, which is why the avatar app's expression and animation systems work across any VRM without model-specific configuration.

### Loading

```typescript
// avatar/VrmManager.ts

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';

export class VrmManager {
  private loader: GLTFLoader;
  private currentVrm: VRM | null = null;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.loader.register(parser => new VRMLoaderPlugin(parser));
  }

  async load(url: string, onProgress?: (pct: number) => void): Promise<VRM> {
    // Remove previous model
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      this.currentVrm.dispose();
    }

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const vrm = gltf.userData.vrm as VRM;
          // VRM models face +Z; rotate to face -Z (toward camera)
          vrm.scene.rotation.y = Math.PI;
          this.scene.add(vrm.scene);
          this.currentVrm = vrm;
          resolve(vrm);
        },
        (evt) => onProgress?.(evt.loaded / evt.total),
        reject
      );
    });
  }

  update(delta: number): void {
    this.currentVrm?.update(delta);
  }
}
```

### Bundled Models

3-5 models ship with the app, stored in `app/src/assets/models/`. Each model has:
- `model.vrm` — the VRM file
- `thumbnail.png` — shown in the model picker (256×256)
- `meta.json` — name, author, license, VRM spec version

Model selection is stored in settings and persists across sessions.

### Custom VRM Import

Users can load any VRM from VRoid Hub or custom creations:

**Desktop:** Tauri file picker → file copied to app data directory → added to model list.

**Browser:** HTML `<input type="file" accept=".vrm">` → `URL.createObjectURL()` → loaded directly. The model stays in memory for the session; it is not persisted.

---

## Expression System

### VRM Standard Expressions

VRM 1.0 defines standard expressions all conforming models must implement:

```
Emotion expressions: happy, angry, sad, relaxed, surprised, neutral
Procedural expressions: blink, blinkLeft, blinkRight, lookUp, lookDown, lookLeft, lookRight
```

### Emotion → Expression Mapping

Each avatar emotion maps to a blend of VRM expressions with weights:

```typescript
const EMOTION_MAP: Record<Emotion, Array<{ name: string; weight: number }>> = {
  idle:      [{ name: 'neutral',   weight: 1.0 }],
  thinking:  [{ name: 'neutral',   weight: 0.7 }, { name: 'lookUp',   weight: 0.3 }],
  focused:   [{ name: 'neutral',   weight: 0.5 }, { name: 'relaxed',  weight: 0.3 }],
  excited:   [{ name: 'happy',     weight: 0.8 }, { name: 'surprised',weight: 0.2 }],
  confused:  [{ name: 'surprised', weight: 0.4 }, { name: 'neutral',  weight: 0.3 }],
  satisfied: [{ name: 'happy',     weight: 0.6 }, { name: 'relaxed',  weight: 0.4 }],
  concerned: [{ name: 'sad',       weight: 0.3 }, { name: 'neutral',  weight: 0.4 }],
};
```

### Smooth Blending

Transitions use frame-rate independent exponential decay:

```typescript
// In update(delta):
const next = THREE.MathUtils.lerp(current, target, 1 - Math.exp(-blendSpeed * delta));
vrm.expressionManager?.setValue(expressionName, next);
```

`blendSpeed = 3.0` gives a ~300ms transition to 90% of target weight — smooth but responsive.

### Intensity Scaling

`intensity: "high"` scales expression weights up (capped at 1.0); `"low"` scales them down:

```typescript
const scale = { low: 0.5, medium: 1.0, high: 1.2 }[intensity];
targetWeight = Math.min(baseWeight * scale, 1.0);
```

### Idle Animations (Auto)

Independent of agent events, the avatar runs continuous micro-animations:
- **Blink:** random interval 3–7s, 150ms close + 150ms open, uses `blink` expression
- **Breathing:** sinusoidal chest bone Y rotation (amplitude 0.01 rad, 3s period)
- **Micro-glance:** occasional subtle eye direction shift (5–15% of the time on blink)

These blend additively with the current expression state.

---

## Animation System

### Pre-Authored Clips

Actions map to pre-authored `.glb` animation clips:

```
responding    → talking.glb         (head bobs, hand gestures)
searching     → searching.glb       (eyes shift, hand raises)
coding        → typing.glb          (arms forward, finger movement)
reading       → reading.glb         (head tilts down, eyes track)
waiting       → idle_breathe.glb    (subtle sway, breathing)
error         → confused_scratch.glb (head tilt, hand to head)
celebrating   → celebrate.glb       (arms raise, bounce)
```

Animations are authored in Blender targeting VRM humanoid bone names directly — no retargeting needed.

### Crossfading

The `AnimationMixer` handles smooth transitions between clips:

```typescript
// Fade out current, fade in new
currentAction.fadeOut(0.5);  // 500ms fade out
newAction.reset().fadeIn(0.5).play();
```

### Intensity → Playback Speed

```typescript
const speedMap = { low: 0.7, medium: 1.0, high: 1.3 };
newAction.timeScale = speedMap[intensity];
```

A `high` intensity agent response plays the talking animation 30% faster — more energetic. `low` plays it slower — more measured.

---

## Prop System

Props are small 3D models (GLTF/GLB) that attach to the avatar's right hand bone.

### Available Props

```
keyboard          → appears on coding action
magnifying_glass  → appears on searching action
coffee_cup        → appears on idle/waiting
book              → appears on reading action
phone             → general purpose
scroll            → reading / thinking
none              → no prop (default)
```

### Attaching Props

```typescript
// Get the right hand bone from VRM humanoid
const handBone = vrm.humanoid.getNormalizedBoneNode('rightHand');

// Clone the prop model and attach
const propModel = await loadGLTF(PROP_PATHS[prop]);
applyPropTransform(propModel, prop); // Scale + offset per prop, tuned manually
handBone.add(propModel);
```

Props appear instantly when the event arrives. They disappear when `prop: "none"` is received or when a different prop is requested.

**No IK in v1.** Props snap to the hand bone; the pre-authored animations already position the hand appropriately for each action/prop combination. IK-based dynamic reach is a v2 feature.

---

## WebSocket Client

The avatar app connects to the relay via WebSocket and maintains the connection automatically.

### Connection

```typescript
const ws = new WebSocket(`wss://relay.projectavatar.io/stream/${token}`);
```

### Reconnection

Exponential backoff with jitter:

```typescript
private scheduleReconnect(): void {
  const delay = Math.min(
    1000 * Math.pow(2, this.attempts) + Math.random() * 1000,
    30_000  // Max 30s between attempts
  );
  this.attempts++;
  setTimeout(() => this.connect(), delay);
}
```

### Connection States

The UI shows a status badge:
- **Connected** (green) — receiving events
- **Reconnecting** (yellow) — with attempt count and next retry time
- **Disconnected** (red) — after many failures, shows manual retry button

### Avatar State During Disconnect

The avatar holds its last known state when disconnected. On reconnect, the relay replays the last event, snapping the avatar back to current state. If the agent has been idle for a while, the idle timeout fires and returns the avatar to the idle state regardless.

---

## Settings and Configuration

Settings are persisted via Tauri's `Store` plugin (desktop) or `localStorage` (browser).

### Available Settings

| Setting | Type | Default | Persisted in | Description |
|---------|------|---------|--------------|-------------|
| `token` | string | — | URL + localStorage | Relay token (required) |
| `modelId` | string | — | URL + localStorage | Selected VRM model ID |
| `relayUrl` | string | `https://relay.projectavatar.io` | localStorage | Relay base URL |
| `idleTimeoutMs` | number | `30000` | localStorage | Ms before returning to idle |
| `theme` | `'dark'` \| `'transparent'` | `'dark'` | localStorage | Background mode |
| `alwaysOnTop` | boolean | `true` | app settings | Desktop only |
| `windowSize` | `{w, h}` | `{400, 600}` | app settings | Desktop only |

**URL persistence:** `token` and `modelId` are written to the URL via `history.replaceState` whenever they change. This makes the URL always shareable and correct — copy it from the address bar at any time.

### Token Generation

```typescript
function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}
```

Tokens are generated **silently on first visit**, before the user even sees the model picker. The token is stored in localStorage and written into the URL immediately — the user can see it in the address bar or copy it from the Setup Screen. If lost, generate a new one (update filter config to match).

---

## Browser App Specifics

The browser app at `app.projectavatar.io` is the primary product. Differences from the desktop app:

### Onboarding Flow

New users go through a two-step wizard (`SetupWizard.tsx`):

**Step 1 — Model Picker (`ModelPickerStep`)**
- Token is auto-generated silently in the background (user never sees this)
- User picks their VRM model from a grid of thumbnails
- "I already have a token" link at the bottom for returning users who want to swap tokens

**Step 2 — Setup Screen (`SetupStep`)**
- The chosen avatar renders immediately in the background, idling
- A floating overlay shows:
  - The full **Avatar URL** (with `?token=...&model=...`) — one-click copy
  - The **Skill Install URL** for the relay — one-click copy
  - Connection status badge ("Waiting for connection...")
- When the first WebSocket event arrives (skill installed + filter running), the overlay auto-dismisses

**Returning users** (token + model in localStorage or URL): skip the wizard entirely, go straight to the avatar.

### URL-Based State

Both token and model are persisted in the URL:

```
https://app.projectavatar.io/?token=YOUR_TOKEN&model=MODEL_ID
```

**Why URL params?**
- OBS browser sources don't have localStorage — URL is the only reliable persistence
- Shareable: paste the URL anywhere and it connects with the right model
- `model=MODEL_ID` uses a short stable identifier (e.g. `maid-v1`), not a path — the manifest maps IDs to files

**Priority:** URL params always win over localStorage. localStorage is the fallback for users who just bookmark the base URL.

The URL stays in sync — when the user picks a model or generates a token, `history.replaceState` updates the URL bar immediately. No reload.

**Skill install URL** also includes the model param:

```
https://relay.projectavatar.io/skill/install?token=TOKEN&model=MODEL_ID
```

This bakes the full avatar URL (with model) into the skill doc. If the user loses their avatar URL, they can ask their AI agent to recall it from the installed skill.

### OBS Browser Source Setup

1. In OBS, add a Browser Source
2. URL: `https://app.projectavatar.io/?token=YOUR_TOKEN&model=MODEL_ID`
   (copy this directly from the Setup Screen — it's the Avatar URL shown there)
3. Width: 400, Height: 600 (or your preferred size)
4. Check "Shutdown source when not visible" to save resources
5. The page renders with `background: transparent` — OBS composites the avatar over your stream

### Background Tab Throttling

Browsers reduce `requestAnimationFrame` to ~1fps in background tabs. Mitigation:

```typescript
// Use Page Visibility API to detect background state
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Switch to setInterval at 10fps for background rendering
    startBackgroundRenderer();
  } else {
    // Return to requestAnimationFrame for full fps
    stopBackgroundRenderer();
    startForegroundRenderer();
  }
});
```

This keeps the avatar alive in background tabs at reduced framerate (enough for state changes to be visible). For OBS browser source, this is irrelevant — OBS renders browser sources continuously regardless of visibility.

---

## Packaging and Distribution

### Desktop (Tauri)

```bash
npm run tauri build
```

Produces platform-native packages:

| Platform | Output |
|----------|--------|
| macOS | `.dmg` (Universal or per-arch) |
| Windows | `.msi` + `.exe` (NSIS installer) |
| Linux | `.AppImage` + `.deb` |

CI/CD via GitHub Actions — matrix build across all platforms on tag push.

Bundle size target: **< 50MB** (Tauri shell + WebView + VRM assets).

### Browser (Cloudflare Pages)

```bash
cd web && npm run build
# dist/ → deploy to Cloudflare Pages
```

Auto-deployed from `web/` directory on push to `master` via Cloudflare Pages GitHub integration.

Custom domain: `app.projectavatar.io`
