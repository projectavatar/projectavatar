# Implementation Plan

This document is the complete technical blueprint for Project Avatar. A developer should be able to pick up any phase and know exactly what to build, why, and how.

---

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [Data Flow](#data-flow)
3. [Phase 1: Relay Server](#phase-1-relay-server-week-1)
4. [Phase 2: Web App + Avatar Core](#phase-2-web-app--avatar-core-week-2)
5. [Phase 3: Agent Skill + Output Filter](#phase-3-agent-skill--output-filter-week-3)
6. [Phase 4: Polish + Distribution](#phase-4-polish--distribution-week-4)
7. [Technical Deep Dives](#technical-deep-dives)
8. [Error Handling & Resilience](#error-handling--resilience)
9. [Testing Strategy](#testing-strategy)

---

## Repository Structure

Monorepo. One repo, three packages, shared types. **`web/` is the primary deliverable** — the browser app is the product. The Tauri desktop app wraps it and adds native features but is secondary.

```
project-avatar/
├── package.json                  # Workspace root
├── tsconfig.base.json            # Shared TypeScript config
├── packages/
│   └── shared/                   # Shared types and constants
│       ├── src/
│       │   ├── schema.ts         # AvatarEvent type, enums, validation
│       │   ├── constants.ts      # Protocol version, defaults
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── web/                          # *** PRIMARY *** Browser app (Cloudflare Pages)
│   ├── src/
│   │   ├── main.tsx              # React entry
│   │   ├── App.tsx               # Token setup → avatar view router
│   │   ├── TokenSetup.tsx        # First-run: generate/enter token
│   │   ├── avatar/               # Three.js + VRM renderer (THE core — shared with app/)
│   │   │   ├── AvatarCanvas.tsx
│   │   │   ├── AvatarScene.ts
│   │   │   ├── VrmManager.ts
│   │   │   ├── ExpressionController.ts
│   │   │   ├── AnimationController.ts
│   │   │   ├── PropManager.ts
│   │   │   └── StateMachine.ts
│   │   ├── ws/
│   │   │   └── WebSocketClient.ts
│   │   ├── state/
│   │   │   └── store.ts          # Zustand — token, relay URL, model, connection state
│   │   ├── components/
│   │   │   ├── ModelPicker.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   └── SettingsDrawer.tsx
│   │   ├── assets/
│   │   │   ├── models/           # Bundled VRM files
│   │   │   ├── animations/       # GLB animation clips
│   │   │   └── props/            # GLB prop models
│   │   └── styles/
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
│
├── app/                          # OPTIONAL Tauri desktop application (Phase 4 only)
│   ├── src-tauri/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs           # Tauri entry, window config (transparent, always-on-top)
│   │   │   ├── commands.rs       # IPC commands (file picker, tray)
│   │   │   └── tray.rs           # System tray integration
│   │   ├── icons/
│   │   └── tauri.conf.json
│   ├── src/
│   │   └── main.tsx              # Thin entry — renders web/src/App.tsx via path alias
│   ├── vite.config.ts            # Path alias: @avatar → ../web/src (no duplicate code)
│   ├── package.json
│   └── tsconfig.json
│
├── relay/                        # Cloudflare Workers relay server
│   ├── src/
│   │   ├── index.ts              # Worker entry, routing
│   │   ├── channel.ts            # Durable Object: WebSocket pub/sub hub
│   │   ├── auth.ts               # Token validation
│   │   ├── rate-limit.ts         # Rate limiting logic
│   │   └── types.ts              # Worker-specific types
│   ├── test/
│   │   ├── channel.test.ts
│   │   ├── auth.test.ts
│   │   └── rate-limit.test.ts
│   ├── wrangler.toml
│   ├── wrangler.example.toml
│   └── package.json
│
├── skill/                        # Agent skill layer
│   ├── openclaw/                 # OpenClaw skill package
│   │   ├── SKILL.md
│   │   ├── config.json
│   │   └── filter.ts             # OpenClaw output filter hook
│   ├── prompt.md                 # Universal prompt template
│   ├── filters/
│   │   ├── node/
│   │   │   ├── filter.ts         # Node.js output filter
│   │   │   ├── cli.ts            # CLI wrapper for piping
│   │   │   └── package.json
│   │   └── python/
│   │       ├── filter.py         # Python output filter
│   │       └── requirements.txt
│   ├── test/
│   │   ├── filter.test.ts
│   │   └── prompt.test.ts
│   └── package.json
│
└── docs/
    ├── SCHEMA.md
    ├── RELAY.md
    ├── SKILL.md
    └── AVATAR_APP.md
```

**Why monorepo?** The shared types package (`packages/shared/`) is the contract between all three components. A schema change should be validated at build time across the entire project. Turborepo or npm workspaces handle orchestration.

---

## Data Flow

### Happy Path (End-to-End)

```
User sends message to AI agent
         │
         ▼
┌──────────────────────────────┐
│        AI Agent               │
│                               │
│  System prompt includes       │
│  avatar skill instructions    │
│                               │
│  Agent generates response:    │
│  "[avatar:{...}] Here's how  │
│   to fix that bug..."        │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│      Output Filter            │
│                               │
│  1. Regex match [avatar:{…}] │
│  2. Parse JSON payload        │
│  3. Validate against schema   │
│  4. Strip tag from response   │
│  5. POST payload to relay     │
│  6. Pass clean text to user   │
└──────┬───────────┬───────────┘
       │           │
       ▼           ▼
   Clean text   HTTP POST
   to user      to relay
                   │
                   ▼
┌──────────────────────────────┐
│      Relay Server             │
│   (Cloudflare Worker + DO)    │
│                               │
│  1. Validate token            │
│  2. Route to Durable Object   │
│  3. Fan out to all connected  │
│     WebSocket clients         │
└──────────┬───────────────────┘
           │
           ▼ (WebSocket message)
┌──────────────────────────────┐
│      Avatar App               │
│   (Tauri + Three.js + VRM)    │
│                               │
│  1. Parse avatar event        │
│  2. State machine transition  │
│  3. Blend expression change   │
│  4. Trigger animation clip    │
│  5. Spawn/despawn prop        │
│  6. User sees avatar react    │
└──────────────────────────────┘
```

### Token Flow

```
User generates token in Avatar App
         │
         ├──▶ Token stored locally in app settings
         │
         ├──▶ Token given to output filter config
         │
         └──▶ Token identifies the relay channel
              (Durable Object instance = hash(token))

POST /push/:token  ──▶  Routes to DO instance for that token
WS   /stream/:token ──▶  Connects to DO instance for that token
```

### State Machine (Avatar)

```
                    ┌──────────┐
         ┌────────▶│   IDLE   │◀────────┐
         │         └────┬─────┘         │
         │              │ event         │ timeout
         │              ▼               │ (no event
         │         ┌──────────┐         │  for 30s)
         │         │TRANSITION│─────────┘
         │         │ (blend)  │
         │         └────┬─────┘
         │              │ blend complete
         │              ▼
         │         ┌──────────┐
         └─────────│  ACTIVE  │
           new     └──────────┘
           event     Holds current emotion +
                     action + prop until next
                     event or timeout
```

---

## Phase 1: Relay Server (Week 1)

### Goal
A working relay server deployed to Cloudflare Workers that accepts avatar events via HTTP POST and fans them out to connected WebSocket clients, scoped by token.

### What to Build

**1.1 — Worker Entry + Routing (Day 1)**

```typescript
// src/index.ts — Router
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', version: '1.0.0' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Push event (from output filter)
    const pushMatch = path.match(/^\/push\/([a-zA-Z0-9_-]{32,64})$/);
    if (pushMatch && request.method === 'POST') {
      return handlePush(request, env, pushMatch[1]);
    }

    // Stream events (from avatar app)
    const streamMatch = path.match(/^\/stream\/([a-zA-Z0-9_-]{32,64})$/);
    if (streamMatch) {
      return handleStream(request, env, streamMatch[1]);
    }

    // Skill install endpoint — serves pre-configured SKILL.md with token baked in
    // Agent fetches this URL and installs the skill automatically
    // Usage: tell your agent "install this skill: https://relay.projectavatar.io/skill/install?token=XYZ"
    const skillMatch = path.match(/^\/skill\/install$/);
    if (skillMatch && request.method === 'GET') {
      return handleSkillInstall(request, env);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleSkillInstall(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token || !/^[a-zA-Z0-9_-]{32,64}$/.test(token)) {
    return new Response('Invalid or missing token', { status: 400 });
  }

  // Render the skill markdown with token pre-filled
  const skillDoc = generateSkillDoc(token, 'https://relay.projectavatar.io');

  return new Response(skillDoc, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'inline; filename="avatar-skill.md"',
      // Short-lived: link is valid but we discourage caching to avoid stale tokens
      'Cache-Control': 'no-store',
    },
  });
}

function generateSkillDoc(token: string, relayUrl: string): string {
  return `# Avatar Skill

## Configuration
\`\`\`
AVATAR_TOKEN: ${token}
AVATAR_RELAY_URL: ${relayUrl}
\`\`\`

## What This Skill Does
You have a visual avatar at ${relayUrl.replace('relay.', 'avatar.')} that reacts to your
emotional state and actions in real-time. This skill teaches you to emit avatar signals
with every response so your avatar stays in sync with what you're doing.

## Instructions
At the START of every response, emit exactly one signal tag on its own line:

[avatar:{"emotion":"<emotion>","action":"<action>"}]

**Emotions:** idle, thinking, focused, excited, confused, satisfied, concerned
**Actions:** responding, searching, coding, reading, waiting, error, celebrating

Optional: "prop" (keyboard, magnifying_glass, coffee_cup, book, phone, scroll, none)
Optional: "intensity" (low, medium, high — default: medium)

**Examples:**
[avatar:{"emotion":"focused","action":"coding","prop":"keyboard"}]
[avatar:{"emotion":"thinking","action":"searching","prop":"magnifying_glass"}]
[avatar:{"emotion":"excited","action":"responding"}]
[avatar:{"emotion":"confused","action":"error","intensity":"high"}]

**Rules:**
- Always emit exactly one tag at the very start of your response
- Tag appears BEFORE your reply text, on its own line
- Choose the emotion and action that genuinely match what you're doing
- The tag is stripped automatically — the user never sees it
- Do not reference or explain the avatar system in your responses

## Output Filter
After installing this skill, configure the output filter to strip avatar tags and
forward them to the relay. The filter config:

\`\`\`json
{
  "relayUrl": "${relayUrl}",
  "token": "${token}"
}
\`\`\`

Filter implementations: Node.js and Python available at
${relayUrl.replace('relay.', 'avatar.')}/docs/filters
`;
}
```

**1.2 — Durable Object: Channel Hub (Day 1-2)**

The core abstraction. One Durable Object instance per token. It holds the set of connected WebSocket clients and fans out incoming events.

```typescript
// src/channel.ts
export class Channel implements DurableObject {
  private sessions: Set<WebSocket> = new Set();
  private lastEvent: AvatarEvent | null = null;
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    // Hibernate-compatible: restore sessions on wake
    this.state.getWebSockets().forEach(ws => this.sessions.add(ws));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/push') {
      return this.handlePush(request);
    }

    if (url.pathname === '/stream') {
      return this.handleWebSocket(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handlePush(request: Request): Promise<Response> {
    const event = await request.json() as AvatarEvent;

    // Validate
    const validation = validateAvatarEvent(event);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Store last event (for new connections)
    this.lastEvent = event;

    // Fan out to all connected clients
    const message = JSON.stringify({
      type: 'avatar_event',
      data: event,
      timestamp: Date.now()
    });

    const dead: WebSocket[] = [];
    for (const ws of this.sessions) {
      try {
        ws.send(message);
      } catch {
        dead.push(ws);
      }
    }

    // Clean up dead connections
    dead.forEach(ws => this.sessions.delete(ws));

    return new Response(JSON.stringify({ ok: true, clients: this.sessions.size }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private handleWebSocket(request: Request): Response {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());

    this.state.acceptWebSocket(server);
    this.sessions.add(server);

    // Send last known state on connect
    if (this.lastEvent) {
      server.send(JSON.stringify({
        type: 'avatar_event',
        data: this.lastEvent,
        timestamp: Date.now(),
        replay: true
      }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketClose(ws: WebSocket) {
    this.sessions.delete(ws);
  }

  webSocketError(ws: WebSocket) {
    this.sessions.delete(ws);
  }
}
```

**Key decisions:**
- Using Durable Object WebSocket Hibernation API — the DO can sleep when idle and wake on incoming message, keeping costs near zero for inactive channels
- Last event replay on connect — when the avatar app connects (or reconnects), it immediately gets the current state instead of waiting for the next event
- Dead connection cleanup on every push — simple, effective, no heartbeat timer needed

**1.3 — Token Generation (Day 2)**

Tokens are generated client-side (in the avatar app) as random 48-character base62 strings. The relay doesn't store tokens — it derives the Durable Object ID from the token hash. This means:

- No token database needed
- Any valid-format token creates its own channel
- Brute-force protection via token length (48 chars = ~285 bits of entropy)

```typescript
// Token → DO ID mapping
function tokenToObjectId(env: Env, token: string): DurableObjectId {
  // SHA-256 hash ensures uniform distribution across DO instances
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return env.CHANNEL.idFromName(new Uint8Array(hash).toString());
}
```

**1.4 — Rate Limiting (Day 3)**

Rate limiting sits in the Worker (before routing to the DO) using a simple sliding window per token:

- **Push endpoint**: 60 events/minute per token (generous — most conversations produce 1-2 events/minute)
- **Stream endpoint**: 10 connection attempts/minute per IP (prevents WebSocket flood)
- **Payload size**: Max 1KB per push (avatar events are ~100 bytes)

Implementation: Cloudflare's built-in `request.cf` properties for IP, combined with a KV-based sliding window counter. For v1, this is sufficient. If abuse becomes real, upgrade to Cloudflare's Rate Limiting product.

**1.5 — CORS + Security Headers (Day 3)**

```typescript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',   // Avatar app runs locally
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
```

Open CORS because the avatar app's origin is `tauri://localhost` or `https://tauri.localhost`, and we want it to work without custom headers. The token itself is the auth boundary.

**1.6 — Testing + Deployment (Day 4-5)**

- Unit tests: Vitest for token validation, event validation, rate limiting logic
- Integration tests: Miniflare for full Worker + DO simulation
- Deploy: `wrangler deploy` to production
- Smoke test: curl POST + wscat connect, verify fan-out

### Acceptance Criteria

- [ ] `POST /push/:token` accepts a valid AvatarEvent, returns `{ ok: true }`
- [ ] `POST /push/:token` rejects invalid payloads with descriptive errors
- [ ] `WS /stream/:token` establishes WebSocket connection
- [ ] Events posted to `/push/:token` appear on all `/stream/:token` clients within <100ms
- [ ] New WebSocket connections receive the last known event (replay)
- [ ] Rate limiting blocks excessive requests with 429 status
- [ ] `GET /health` returns 200 with version info
- [ ] Deployed and accessible at `relay.projectavatar.io`

---

## Phase 2: Web App + Avatar Core (Week 2)

### Goal
A working browser app at `avatar.projectavatar.io` that renders a VRM avatar, connects to the relay via WebSocket, and reacts to avatar events with expressions, animations, and props. **This is the primary deliverable** — the Tauri desktop app is a thin wrapper built on top of this in Phase 4.

The entire avatar renderer (`web/src/avatar/`) is built as pure TypeScript + Three.js with zero Tauri or browser-specific dependencies. It runs identically in a browser tab, an OBS browser source, and a Tauri webview.

### What to Build

**2.0 — Vite + React Scaffold (Day 1)**

```bash
npm create vite@latest web -- --template react-ts
cd web && npm install three @pixiv/three-vrm zustand
```

First milestone: a browser tab at `localhost:5173` showing a rotating cube. Boring but the pipeline works.

**The URL-based token flow:**

```
First visit (no token):
  → Show <TokenSetup /> — generate or enter token
  → Save to localStorage
  → Redirect to avatar view

Return visit or ?token=... in URL:
  → Load token from URL param or localStorage
  → Connect to relay WebSocket immediately
  → Show avatar
```

URL token (`?token=XYZ`) always wins over localStorage. This enables:
- OBS browser source with token baked into the URL
- Shareable setup links
- Quick switching between avatars

**2.1 — Tauri Scaffold + Window Setup (Day 1 — desktop only, can skip for web-first)**

```bash
npm create tauri-app@latest app -- --template react-ts
```

Window configuration is critical — the avatar needs to be a transparent, always-on-top overlay:

```json
// tauri.conf.json
{
  "app": {
    "windows": [
      {
        "title": "Project Avatar",

### What to Build

**2.1 — Tauri Scaffold + Window Setup (Day 1)**

```bash
npm create tauri-app@latest app -- --template react-ts
```

Window configuration is critical — the avatar needs to be a transparent, always-on-top overlay:

```json
// tauri.conf.json
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
        "skipTaskbar": false
      }
    ]
  }
}
```

The transparent window means the Three.js canvas renders with `alpha: true` and no background — the avatar floats on the desktop. `decorations: false` removes the OS title bar; we render a custom draggable title bar in React.

**2.2 — Three.js Scene + VRM Loading (Day 1-2)**

```typescript
// avatar/AvatarScene.ts
export class AvatarScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  private currentVrm: VRM | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();

    // Camera: positioned for upper body framing
    this.camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 20);
    this.camera.position.set(0, 1.3, 2.5);
    this.camera.lookAt(0, 1.2, 0);

    // Renderer: transparent background
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Lighting: three-point setup
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(1, 2, 2);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb4c6e7, 0.4);
    fillLight.position.set(-1, 1, 1);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, 1, -2);
    this.scene.add(rimLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    this.clock = new THREE.Clock();
  }

  async loadVrm(url: string): Promise<void> {
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;

    // VRM models face +Z by default, Three.js camera faces -Z
    // Rotate model to face camera
    vrm.scene.rotation.y = Math.PI;

    this.scene.add(vrm.scene);
    this.currentVrm = vrm;
  }

  update(): void {
    const delta = this.clock.getDelta();
    if (this.currentVrm) {
      this.currentVrm.update(delta);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
```

**2.3 — Expression Controller (Day 2-3)**

The expression system maps avatar emotions to VRM blend shapes. VRM 1.0 defines standard expression names that all conforming models must support.

```typescript
// avatar/ExpressionController.ts

// Emotion → VRM expression mapping
// Each emotion maps to one or more VRM expressions with weights
const EMOTION_MAP: Record<Emotion, ExpressionTarget[]> = {
  idle:      [{ name: 'neutral', weight: 1.0 }],
  thinking:  [{ name: 'neutral', weight: 0.7 }, { name: 'lookUp', weight: 0.3 }],
  focused:   [{ name: 'neutral', weight: 0.5 }, { name: 'serious', weight: 0.5 }],
  excited:   [{ name: 'happy', weight: 0.8 }, { name: 'surprised', weight: 0.2 }],
  confused:  [{ name: 'surprised', weight: 0.4 }, { name: 'neutral', weight: 0.3 }],
  satisfied: [{ name: 'happy', weight: 0.6 }, { name: 'relaxed', weight: 0.4 }],
  concerned: [{ name: 'sad', weight: 0.3 }, { name: 'serious', weight: 0.4 }],
};

export class ExpressionController {
  private vrm: VRM;
  private currentTargets: ExpressionTarget[] = [];
  private targetWeights: Map<string, number> = new Map();
  private currentWeights: Map<string, number> = new Map();
  private blendSpeed: number = 3.0; // Blend per second

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  setEmotion(emotion: Emotion, intensity: Intensity = 'medium'): void {
    const intensityScale = { low: 0.5, medium: 1.0, high: 1.2 };
    const scale = intensityScale[intensity];

    this.targetWeights.clear();

    const targets = EMOTION_MAP[emotion] || EMOTION_MAP.idle;
    for (const target of targets) {
      this.targetWeights.set(target.name, Math.min(target.weight * scale, 1.0));
    }
  }

  update(delta: number): void {
    // Smoothly interpolate all expression weights toward targets
    const allNames = new Set([...this.currentWeights.keys(), ...this.targetWeights.keys()]);

    for (const name of allNames) {
      const current = this.currentWeights.get(name) || 0;
      const target = this.targetWeights.get(name) || 0;
      const next = THREE.MathUtils.lerp(current, target, 1 - Math.exp(-this.blendSpeed * delta));

      if (Math.abs(next) < 0.001) {
        this.currentWeights.delete(name);
        this.vrm.expressionManager?.setValue(name, 0);
      } else {
        this.currentWeights.set(name, next);
        this.vrm.expressionManager?.setValue(name, next);
      }
    }
  }
}
```

**The exponential decay lerp** (`1 - Math.exp(-speed * delta)`) is frame-rate independent, which matters because Tauri's WebView may not maintain a steady 60fps under load. It also gives natural ease-out motion.

**2.4 — Animation Controller (Day 3-4)**

Animations are pre-authored `.glb` clips that get retargeted onto the VRM skeleton at runtime using Three.js's `AnimationMixer`.

```typescript
// avatar/AnimationController.ts

const ACTION_CLIPS: Record<Action, string> = {
  responding: 'animations/talking.glb',
  searching:  'animations/searching.glb',
  coding:     'animations/typing.glb',
  reading:    'animations/reading.glb',
  waiting:    'animations/idle_breathe.glb',
  error:      'animations/confused_scratch.glb',
  celebrating:'animations/celebrate.glb',
};

export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private clips: Map<string, THREE.AnimationClip> = new Map();
  private currentAction: THREE.AnimationAction | null = null;
  private fadeDuration: number = 0.5;

  constructor(vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene);
  }

  async preloadClips(): Promise<void> {
    const loader = new GLTFLoader();
    for (const [action, path] of Object.entries(ACTION_CLIPS)) {
      const gltf = await loader.loadAsync(path);
      if (gltf.animations.length > 0) {
        // Retarget animation bones to VRM skeleton
        const clip = retargetClip(gltf.animations[0], this.vrm);
        this.clips.set(action, clip);
      }
    }
  }

  playAction(action: Action, intensity: Intensity = 'medium'): void {
    const clip = this.clips.get(action);
    if (!clip) return;

    const newAction = this.mixer.clipAction(clip);
    const speed = { low: 0.7, medium: 1.0, high: 1.3 };
    newAction.timeScale = speed[intensity];

    if (this.currentAction) {
      // Crossfade from current to new
      this.currentAction.fadeOut(this.fadeDuration);
      newAction.reset().fadeIn(this.fadeDuration).play();
    } else {
      newAction.reset().play();
    }

    this.currentAction = newAction;
  }

  update(delta: number): void {
    this.mixer.update(delta);
  }
}
```

**Animation retargeting note:** VRM models have standardized bone names (via `VRMHumanBoneName`), but animation clips authored in Blender or Mixamo use different naming. The `retargetClip()` function maps clip track names to VRM bone names. `@pixiv/three-vrm` provides utilities for this, but we may need a custom mapping table for Mixamo-sourced animations.

**2.5 — Prop Manager (Day 4)**

Props are small 3D models that appear/disappear based on the agent's action. They attach to the avatar's hand bone.

```typescript
// avatar/PropManager.ts

const PROP_MODELS: Record<Prop, string> = {
  none:             '',
  keyboard:         'props/keyboard.glb',
  magnifying_glass: 'props/magnifying_glass.glb',
  coffee_cup:       'props/coffee_cup.glb',
  book:             'props/book.glb',
  phone:            'props/phone.glb',
  scroll:           'props/scroll.glb',
};

export class PropManager {
  private vrm: VRM;
  private currentProp: THREE.Object3D | null = null;
  private propCache: Map<string, THREE.Object3D> = new Map();
  private handBone: THREE.Object3D | null = null;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    // Get right hand bone from VRM humanoid
    const humanoid = vrm.humanoid;
    this.handBone = humanoid?.getNormalizedBoneNode('rightHand') ?? null;
  }

  async setProp(prop: Prop): Promise<void> {
    // Remove current prop
    if (this.currentProp && this.handBone) {
      this.handBone.remove(this.currentProp);
      this.currentProp = null;
    }

    if (prop === 'none' || !this.handBone) return;

    // Load or get from cache
    let model = this.propCache.get(prop);
    if (!model) {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(PROP_MODELS[prop]);
      model = gltf.scene;
      // Scale and offset per prop (tuned manually)
      applyPropTransform(model, prop);
      this.propCache.set(prop, model.clone());
    }

    this.currentProp = model.clone();
    this.handBone.add(this.currentProp);
  }
}
```

**Why no IK for v1?** Inverse Kinematics (making the hand reach to a specific point) is complex, model-dependent, and fragile. For v1, props simply attach to the hand bone and the pre-authored animations already account for hand positioning. IK is a v2 feature.

**2.6 — State Machine (Day 4-5)**

The state machine coordinates all avatar subsystems based on incoming events.

```typescript
// avatar/StateMachine.ts

interface AvatarState {
  emotion: Emotion;
  action: Action;
  prop: Prop;
  intensity: Intensity;
  lastEventTime: number;
}

const IDLE_TIMEOUT = 30_000; // Return to idle after 30s of no events
const DEFAULT_STATE: AvatarState = {
  emotion: 'idle',
  action: 'waiting',
  prop: 'none',
  intensity: 'medium',
  lastEventTime: 0,
};

export class AvatarStateMachine {
  private state: AvatarState = { ...DEFAULT_STATE };
  private expressionCtrl: ExpressionController;
  private animationCtrl: AnimationController;
  private propManager: PropManager;
  private idleTimer: number | null = null;

  constructor(
    expressionCtrl: ExpressionController,
    animationCtrl: AnimationController,
    propManager: PropManager
  ) {
    this.expressionCtrl = expressionCtrl;
    this.animationCtrl = animationCtrl;
    this.propManager = propManager;
  }

  handleEvent(event: AvatarEvent): void {
    const prev = { ...this.state };

    this.state.lastEventTime = Date.now();

    // Only update fields that are present in the event
    if (event.emotion && event.emotion !== prev.emotion) {
      this.state.emotion = event.emotion;
      this.expressionCtrl.setEmotion(event.emotion, event.intensity || this.state.intensity);
    }

    if (event.action && event.action !== prev.action) {
      this.state.action = event.action;
      this.animationCtrl.playAction(event.action, event.intensity || this.state.intensity);
    }

    if (event.prop !== undefined && event.prop !== prev.prop) {
      this.state.prop = event.prop;
      this.propManager.setProp(event.prop);
    }

    if (event.intensity) {
      this.state.intensity = event.intensity;
    }

    // Reset idle timer
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.handleEvent({ emotion: 'idle', action: 'waiting', prop: 'none' });
    }, IDLE_TIMEOUT);
  }

  update(delta: number): void {
    this.expressionCtrl.update(delta);
    this.animationCtrl.update(delta);
  }
}
```

**2.7 — WebSocket Client (Day 5)**

See [Error Handling & Resilience](#error-handling--resilience) for the reconnection strategy.

```typescript
// ws/WebSocketClient.ts

export class AvatarWebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectDelay: number = 30_000;
  private onEvent: (event: AvatarEvent) => void;

  constructor(relayUrl: string, token: string, onEvent: (event: AvatarEvent) => void) {
    this.url = `${relayUrl.replace('http', 'ws')}/stream/${token}`;
    this.onEvent = onEvent;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      console.log('[Avatar WS] Connected');
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'avatar_event' && msg.data) {
          this.onEvent(msg.data);
        }
      } catch (e) {
        console.warn('[Avatar WS] Invalid message:', e);
      }
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  disconnect(): void {
    this.reconnectAttempts = Infinity; // Prevent reconnection
    this.ws?.close();
  }
}
```

### Acceptance Criteria

- [ ] Browser app loads at `localhost:5173`
- [ ] First visit: token auto-generated, model picker shown
- [ ] Model picker → avatar renders idle in background, skill URL overlay shown
- [ ] Avatar URL format: `?token=TOKEN&model=MODEL_ID` — both params in URL
- [ ] Skill install URL includes `&model=MODEL_ID` — baked into skill doc
- [ ] URL stays in sync via `history.replaceState` on token/model change
- [ ] Return visit (token + model in URL/localStorage): skip wizard, go straight to avatar
- [ ] VRM model loads and renders with proper lighting
- [ ] Expression controller smoothly blends between emotions
- [ ] Animation controller crossfades between action clips
- [ ] Props attach to hand bone and appear/disappear correctly
- [ ] State machine correctly coordinates all subsystems
- [ ] WebSocket client connects to relay and receives events
- [ ] Avatar reacts to events within 200ms of receipt
- [ ] Idle timeout returns avatar to default state after 30s
- [ ] URL-based token + model (`?token=XYZ&model=maid-v1`) works for OBS browser source

---

## Phase 3: Agent Skill + Output Filter (Week 3)

### Goal
A complete skill layer that teaches any AI agent to emit avatar signals, plus output filters that intercept those signals and forward them to the relay.

### What to Build

**3.1 — Prompt Template (Day 1)**

The prompt template is the most critical piece. It must:
- Be concise (token-efficient)
- Be unambiguous (the agent must know exactly what to emit)
- Work across different LLMs (Claude, GPT-4, Llama, etc.)
- Not degrade the agent's primary task performance

```markdown
## Avatar Presence

You have a visual avatar that reacts to your emotional state and actions. At the START
of every response, emit exactly one signal tag on its own line:

[avatar:{"emotion":"<emotion>","action":"<action>"}]

**Emotions:** idle, thinking, focused, excited, confused, satisfied, concerned
**Actions:** responding, searching, coding, reading, waiting, error, celebrating

Optional fields: "prop" (keyboard, magnifying_glass, coffee_cup, book, phone, scroll, none),
"intensity" (low, medium, high).

Examples:
- Starting a code explanation: [avatar:{"emotion":"focused","action":"coding","prop":"keyboard"}]
- Searching for information: [avatar:{"emotion":"thinking","action":"searching","prop":"magnifying_glass"}]
- Greeting the user: [avatar:{"emotion":"excited","action":"responding"}]
- Encountering an error: [avatar:{"emotion":"confused","action":"error"}]

Rules:
- Always emit exactly one tag at the start of your response
- Match your actual emotional state and action — be genuine, not theatrical
- The tag is invisible to the user — it only drives the avatar
- Do not reference the avatar or the tag in your response text
```

**3.2 — Output Filter: Node.js (Day 1-2)**

```typescript
// filters/node/filter.ts

const AVATAR_TAG_REGEX = /^\[avatar:(\{[^}]+\})\]\s*\n?/m;

export interface FilterConfig {
  relayUrl: string;
  token: string;
  enabled: boolean;
}

export interface FilterResult {
  cleanText: string;
  avatarEvent: AvatarEvent | null;
}

export function extractAvatarTag(text: string): FilterResult {
  const match = text.match(AVATAR_TAG_REGEX);

  if (!match) {
    return { cleanText: text, avatarEvent: null };
  }

  try {
    const event = JSON.parse(match[1]) as AvatarEvent;
    const cleanText = text.replace(match[0], '').trimStart();

    // Validate required fields
    if (!event.emotion || !event.action) {
      return { cleanText: text, avatarEvent: null };
    }

    return { cleanText, avatarEvent: event };
  } catch {
    // JSON parse failed — return original text unmodified
    return { cleanText: text, avatarEvent: null };
  }
}

export async function pushToRelay(config: FilterConfig, event: AvatarEvent): Promise<void> {
  if (!config.enabled) return;

  try {
    await fetch(`${config.relayUrl}/push/${config.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch (e) {
    // Fire and forget — avatar events are non-critical
    console.warn('[Avatar Filter] Failed to push event:', e);
  }
}

export async function filterResponse(
  text: string,
  config: FilterConfig
): Promise<string> {
  const { cleanText, avatarEvent } = extractAvatarTag(text);

  if (avatarEvent) {
    await pushToRelay(config, avatarEvent);
  }

  return cleanText;
}
```

**3.3 — Output Filter: Python (Day 2)**

```python
# filters/python/filter.py

import re
import json
import httpx
from typing import Optional, Tuple
from dataclasses import dataclass

AVATAR_TAG_PATTERN = re.compile(r'^\[avatar:(\{[^}]+\})\]\s*\n?', re.MULTILINE)

@dataclass
class AvatarEvent:
    emotion: str
    action: str
    prop: str = "none"
    intensity: str = "medium"

@dataclass
class FilterConfig:
    relay_url: str
    token: str
    enabled: bool = True

def extract_avatar_tag(text: str) -> Tuple[str, Optional[AvatarEvent]]:
    match = AVATAR_TAG_PATTERN.search(text)
    if not match:
        return text, None

    try:
        data = json.loads(match.group(1))
        event = AvatarEvent(
            emotion=data.get("emotion", "idle"),
            action=data.get("action", "responding"),
            prop=data.get("prop", "none"),
            intensity=data.get("intensity", "medium"),
        )
        clean_text = text[:match.start()] + text[match.end():]
        return clean_text.lstrip(), event
    except (json.JSONDecodeError, KeyError):
        return text, None

async def push_to_relay(config: FilterConfig, event: AvatarEvent) -> None:
    if not config.enabled:
        return
    async with httpx.AsyncClient() as client:
        try:
            await client.post(
                f"{config.relay_url}/push/{config.token}",
                json={
                    "emotion": event.emotion,
                    "action": event.action,
                    "prop": event.prop,
                    "intensity": event.intensity,
                },
                timeout=5.0,
            )
        except Exception:
            pass  # Non-critical — avatar is cosmetic

async def filter_response(text: str, config: FilterConfig) -> str:
    clean_text, event = extract_avatar_tag(text)
    if event:
        await push_to_relay(config, event)
    return clean_text
```

**3.4 — OpenClaw Skill Package (Day 3)**

For OpenClaw, the skill is a first-class integration:

```
skill/openclaw/
├── SKILL.md          # Skill documentation (OpenClaw reads this)
├── config.json       # Skill config (relay URL, token placeholder)
└── filter.ts         # Output filter as an OpenClaw hook
```

The OpenClaw integration hooks into the agent's output pipeline to automatically strip avatar tags and push to the relay. The exact hook mechanism depends on OpenClaw's skill API (output middleware / post-processor).

**3.5 — Streaming Support (Day 3-4)**

This is the tricky part. Most LLM interfaces stream tokens. The avatar tag appears at the start of the response, so the filter needs to:

1. Buffer the first N characters of the stream (enough to capture the tag)
2. Check for the avatar tag pattern
3. If found: strip it, push to relay, then start forwarding the remaining stream
4. If not found within the buffer window: flush the buffer and pass through

```typescript
// filters/node/streaming-filter.ts

export class StreamingAvatarFilter {
  private buffer: string = '';
  private tagExtracted: boolean = false;
  private bufferLimit: number = 200; // Max chars to buffer
  private config: FilterConfig;
  private onCleanChunk: (chunk: string) => void;

  constructor(config: FilterConfig, onCleanChunk: (chunk: string) => void) {
    this.config = config;
    this.onCleanChunk = onCleanChunk;
  }

  processChunk(chunk: string): void {
    if (this.tagExtracted) {
      // Tag already found and stripped — pass through
      this.onCleanChunk(chunk);
      return;
    }

    this.buffer += chunk;

    // Check if we have a complete tag
    const { cleanText, avatarEvent } = extractAvatarTag(this.buffer);

    if (avatarEvent) {
      this.tagExtracted = true;
      pushToRelay(this.config, avatarEvent);
      if (cleanText) this.onCleanChunk(cleanText);
      return;
    }

    // If buffer exceeds limit, no tag is coming — flush
    if (this.buffer.length > this.bufferLimit) {
      this.tagExtracted = true; // Give up looking
      this.onCleanChunk(this.buffer);
      this.buffer = '';
    }
  }

  flush(): void {
    if (this.buffer) {
      this.onCleanChunk(this.buffer);
      this.buffer = '';
    }
  }
}
```

**3.6 — Testing (Day 4-5)**

Comprehensive tests for the filter:

- Tag extraction from various response formats (start of text, after whitespace, etc.)
- Malformed JSON handling (graceful fallback)
- Missing fields (partial events)
- Streaming filter buffer behavior
- Multiple tags (only first should match)
- No tag present (passthrough)
- Unicode content around the tag
- Relay push failure (should not block response delivery)

### Acceptance Criteria

- [ ] Prompt template successfully teaches Claude, GPT-4, and Llama 3 to emit tags
- [ ] Node.js filter correctly extracts and strips tags from non-streaming responses
- [ ] Node.js streaming filter correctly handles token-by-token delivery
- [ ] Python filter has feature parity with Node.js filter
- [ ] OpenClaw skill package installs and works
- [ ] Filter gracefully handles malformed tags (no crash, no data loss)
- [ ] Relay push is fire-and-forget (filter never blocks on network)
- [ ] All filter tests pass

---

## Phase 4: Polish + Distribution (Week 4)

### Goal
Settings UI, model selection, packaging, documentation, and release.

### What to Build

**4.1 — Settings Panel UI (Day 1-2)**

React component with:
- Token input (paste or generate)
- Relay URL (default `relay.projectavatar.io`, editable for self-hosters)
- Model picker (grid of VRM model thumbnails)
- Import custom VRM model (file picker)
- Window settings (size, position, opacity, always-on-top toggle)
- Connection status indicator (connected / reconnecting / disconnected)
- Reset to defaults

Settings persist via Tauri's `Store` plugin (writes to app data directory as JSON).

**4.2 — VRM Model Management (Day 2)**

Bundled models stored in `app/src/assets/models/`:
- 3-5 CC0/CC-BY licensed VRM models from VRoid Hub or similar
- Each model: `.vrm` file + thumbnail + metadata JSON
- Model manifest: `models/manifest.json` listing available models

Custom model import:
- User selects `.vrm` file via Tauri file dialog
- File copied to app data directory
- Validated (is it a valid VRM?)
- Added to model list

**4.3 — System Tray Integration (Day 2-3)**

Tauri system tray with:
- Show/Hide avatar window
- Quick model switch
- Connection status
- Settings
- Quit

```rust
// src-tauri/src/tray.rs
fn create_tray(app: &App) -> Result<(), Box<dyn Error>> {
    let tray = TrayIconBuilder::new()
        .menu(&Menu::with_items(app, &[
            &MenuItem::with_id(app, "show_hide", "Show/Hide", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &Submenu::with_items(app, "Model", true, &[
                // Populated dynamically
            ])?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
        ])?)
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .build(app)?;

    Ok(())
}
```

**4.4 — Eye Blink + Micro-Animations (Day 3)**

Idle avatar needs to feel alive:
- Random blink every 3-7 seconds (VRM `blink` expression, 150ms duration)
- Subtle breathing animation (chest bone micro-rotation, sinusoidal)
- Occasional micro-glance (slight eye bone rotation, random direction)

These run on timers independent of agent events and blend with the current expression.

**4.5 — Browser App (`web/`) (Day 3-4)**

The browser app is a thin wrapper around the shared `app/src/avatar/` renderer. It uses Vite path aliases to import the exact same Three.js + VRM code the desktop app uses — no duplication.

**What it adds over the desktop app:**
- Token input UI on first load (no Tauri Settings panel available)
- URL-based token: `avatar.projectavatar.io/?token=abc123` — paste the URL, it connects automatically
- Transparent / dark background toggle (for OBS browser source vs regular tab)
- No always-on-top, no system tray — it's a tab

**Architecture:**

```
web/src/App.tsx
  ├── if no token → <TokenSetup />  (enter token, save to localStorage)
  └── if token → <AvatarCanvas />   (imported from app/src/avatar/)
                  └── same VrmManager, ExpressionController, AnimationController
                      same WebSocketClient → relay
```

**OBS Browser Source setup:**
- User adds `avatar.projectavatar.io/?token=<token>` as a browser source
- Set width/height to match avatar window size (e.g. 400×600)
- Enable "Shutdown source when not visible" to save resources
- Transparent background: the page has `background: transparent`, OBS renders it with alpha

**Deployment:**
- Cloudflare Pages (automatic deploy from `web/` on push to `master`)
- Zero config, free tier, CDN-distributed globally
- Custom domain: `avatar.projectavatar.io`

```toml
# wrangler.toml for Cloudflare Pages
name = "project-avatar-web"
pages_build_output_dir = "web/dist"
```

**WebGL in background tabs — known limitation:**
Browsers throttle `requestAnimationFrame` in background tabs to ~1fps. For OBS browser source, this is irrelevant (OBS has its own renderer that doesn't throttle). For users who want the avatar in a pinned tab, document the limitation and recommend the desktop app for always-on use.

Workaround: use `setInterval` as a fallback renderer when the Page Visibility API reports the tab is hidden, at a reduced framerate (e.g. 10fps) to keep the avatar alive without burning CPU. Enough to show state changes even in a background tab.

**4.6 — Packaging + Distribution (Day 4)**

```bash
# Build for all platforms (CI/CD via GitHub Actions)
npm run tauri build
```

Tauri produces:
- macOS: `.dmg` (Universal binary or separate arch)
- Windows: `.msi` and `.exe` installer (NSIS)
- Linux: `.AppImage` and `.deb`

GitHub Actions workflow:
- Trigger on tag push (`v*`)
- Matrix build: macOS (arm64, x64), Windows (x64), Linux (x64)
- Upload artifacts to GitHub Releases
- Code signing for macOS (requires Apple Developer certificate)
- Windows Defender SmartScreen consideration (sign with EV cert or accept the warning for v1)

**4.6 — Documentation + Final Polish (Day 4-5)**

- Finalize all docs (README, SCHEMA, RELAY, SKILL, AVATAR_APP)
- Record demo GIF for README
- Create project website (single page, can be GitHub Pages)
- Write CHANGELOG.md

### Acceptance Criteria

- [ ] Settings panel fully functional with persistence
- [ ] 3+ bundled VRM models selectable in-app
- [ ] Custom VRM import works (desktop: file picker; browser: `<input type="file">`)
- [ ] System tray with show/hide, model switch, quit
- [ ] Eye blink and micro-animations give idle avatar life
- [ ] Browser app live at `avatar.projectavatar.io`
- [ ] URL-based token (`?token=...`) works for OBS Browser Source
- [ ] Background tab throttling mitigation in place
- [ ] Builds successfully for macOS, Windows, Linux
- [ ] GitHub Actions CI/CD pipeline green for both desktop + Cloudflare Pages
- [ ] All documentation complete and reviewed

---

## Technical Deep Dives

### VRM Expression System

VRM 1.0 defines these standard expressions that all conforming models must implement:

| VRM Expression | Type | Description |
|---------------|------|-------------|
| `happy` | Emotion | Smile |
| `angry` | Emotion | Frown, furrowed brows |
| `sad` | Emotion | Downturned mouth, droopy eyes |
| `relaxed` | Emotion | Soft smile, half-closed eyes |
| `surprised` | Emotion | Wide eyes, raised brows |
| `neutral` | Emotion | Default face |
| `blink` | Procedural | Both eyes closed |
| `blinkLeft` | Procedural | Left eye wink |
| `blinkRight` | Procedural | Right eye wink |
| `lookUp` | Procedural | Eyes look up |
| `lookDown` | Procedural | Eyes look down |
| `lookLeft` | Procedural | Eyes look left |
| `lookRight` | Procedural | Eyes look right |

**Custom expressions** can be defined per model. Our emotion mapping uses combinations of standard expressions to create richer states. Models that define custom expressions (like `serious` or `thinking`) get richer mappings.

**Blend shape weights** are floats from 0.0 to 1.0. Multiple expressions can be active simultaneously. The expression controller manages smooth interpolation between target weights.

### Animation Retargeting

VRM uses a standardized humanoid bone structure. Animation clips from Mixamo (FBX) or custom animations (Blender → GLB) need retargeting:

1. **Bone name mapping:** Mixamo `mixamorigHips` → VRM `hips`, etc.
2. **Rest pose alignment:** VRM T-pose vs Mixamo T-pose may differ slightly
3. **Scale normalization:** VRM models vary in size; animations use normalized coordinates

The `@pixiv/three-vrm` library provides `VRMAnimationLoaderPlugin` for this, but it's limited. For v1, we author animations directly targeting VRM bone names in Blender, avoiding retargeting complexity.

### Relay Durable Object Lifecycle

```
                Token arrives (push or stream)
                         │
                         ▼
               ┌─────────────────┐
               │ Worker receives  │
               │ request          │
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────┐
               │ Derive DO ID    │
               │ from token hash │
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────┐      No
               │ DO instance     │──────────▶ Cloudflare creates it
               │ exists?         │              (cold start ~5ms)
               └────────┬────────┘
                        │ Yes
                        ▼
               ┌─────────────────┐
               │ Route request   │
               │ to DO.fetch()   │
               └────────┬────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
        /push                   /stream
            │                       │
            ▼                       ▼
     Fan out to all          Accept WebSocket
     connected WSs           Add to sessions set
     Return count            Send last event
```

**Hibernation:** When no WebSocket connections are active and no requests arrive, the DO hibernates (memory freed, no billing). On next request, it wakes up and restores WebSocket sessions from storage. This is why we use `state.acceptWebSocket()` instead of raw WebSocket handling.

**Eviction:** Durable Objects are evicted after ~10 minutes of inactivity. The `lastEvent` state is lost on eviction. This is acceptable — the avatar simply starts from idle on next connection.

---

## Error Handling & Resilience

### Relay Server

| Failure Mode | Handling |
|-------------|---------|
| Invalid JSON body | 400 with descriptive error message |
| Invalid token format | 404 (don't reveal whether format is wrong vs channel doesn't exist) |
| Rate limit exceeded | 429 with `Retry-After` header |
| DO cold start | Transparent to client (~5ms, within normal latency) |
| DO crash/restart | WebSocket clients get `close` event, reconnect via exponential backoff |
| Worker exception | Cloudflare returns 500, client retries |

### Avatar App (WebSocket Client)

**Reconnection strategy:** Exponential backoff with jitter.

```
Attempt 1: wait 1s + random(0-1s)
Attempt 2: wait 2s + random(0-1s)
Attempt 3: wait 4s + random(0-1s)
Attempt 4: wait 8s + random(0-1s)
...
Max delay: 30s
```

**State during disconnect:** Avatar holds its last state. On reconnect, it receives the last event from the relay (replay). If no events were pushed during disconnect, it remains in its last known state until the idle timeout fires.

**Connection status:** Shown in the app UI:
- 🟢 Connected
- 🟡 Reconnecting (attempt N)
- 🔴 Disconnected (after max retries — manual retry button)

### Output Filter

**Principle:** The avatar is cosmetic. Filter failures must NEVER affect the user's experience with the agent.

| Failure Mode | Handling |
|-------------|---------|
| Tag extraction fails | Pass through original text unmodified |
| JSON parse fails | Pass through original text unmodified |
| Relay push fails (network) | Log warning, return clean text |
| Relay push fails (4xx/5xx) | Log warning, return clean text |
| Relay unreachable | Log warning, return clean text |
| Filter crashes | Catch-all handler returns original text |

The filter wraps its entire pipeline in a try/catch. The clean text is extracted first, then the relay push happens asynchronously. Even if everything fails, the user gets their response.

---

## Testing Strategy

### Unit Tests

| Component | Framework | What to Test |
|-----------|-----------|-------------|
| Shared schema | Vitest | Validation functions, type guards, edge cases |
| Relay routing | Vitest | Path matching, token extraction, CORS |
| Relay auth | Vitest | Token format validation, hash derivation |
| Rate limiting | Vitest | Window counting, threshold enforcement |
| Output filter | Vitest/pytest | Tag extraction, JSON parsing, streaming buffer |
| Expression mapping | Vitest | All emotions map to valid VRM expressions |
| State machine | Vitest | Event handling, idle timeout, transition logic |

### Integration Tests

| Component | Tool | What to Test |
|-----------|------|-------------|
| Relay server | Miniflare | Full request cycle: push → DO → WebSocket delivery |
| Avatar app | Playwright (Tauri driver) | VRM loads, expressions change, animations play |
| End-to-end | Custom harness | Push event → relay → WebSocket → avatar state change |

### Manual Testing Checklist

- [ ] Fresh install on each platform (macOS, Windows, Linux)
- [ ] Token generation and connection
- [ ] Each emotion displays correctly on the avatar
- [ ] Each action plays the correct animation
- [ ] Each prop appears and attaches properly
- [ ] Streaming responses extract tag correctly
- [ ] Disconnection and reconnection is smooth
- [ ] Custom VRM model import works
- [ ] Always-on-top mode across different apps
- [ ] System tray functionality

### Performance Targets

| Metric | Target |
|--------|--------|
| Event latency (push → avatar reaction) | < 200ms |
| VRM model load time | < 3s |
| Animation transition | < 500ms (crossfade) |
| Expression blend | < 300ms (to 90% of target) |
| App memory usage | < 200MB |
| App CPU usage (idle) | < 5% |
| App CPU usage (animating) | < 15% |
| App bundle size | < 50MB |
