# Implementation Plan

This document is the complete technical blueprint for Project Avatar. A developer should be able to pick up any phase and know exactly what to build, why, and how.

---

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [Data Flow](#data-flow)
3. [Phase 1: Relay Server](#phase-1-relay-server-week-1) ✅
4. [Phase 2: Web App + Avatar Core](#phase-2-web-app--avatar-core-week-2) ✅
5. [Phase 3: Agent Skill + Output Filter](#phase-3-agent-skill--output-filter-week-3) ✅
6. [Phase 4: OpenClaw Plugin](#phase-4-openclaw-plugin-v11) ✅
7. [Phase 4.1: Identity Persistence + Multi-Screen Sync](#phase-41-identity-persistence--multi-screen-sync-v11) ✅
8. [Phase 4.2: Agent Presence + Plugin Share Link](#phase-42-agent-presence--plugin-share-link-v11)
9. [Phase 4.3: WebSocket Keepalive](#phase-43-websocket-keepalive-v11)
10. [Phase 5: Polish + Desktop](#phase-5-polish--desktop-v12)
11. [Technical Deep Dives](#technical-deep-dives)
12. [Error Handling & Resilience](#error-handling--resilience)
13. [Testing Strategy](#testing-strategy)

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
A working browser app at `app.projectavatar.io` that renders a VRM avatar, connects to the relay via WebSocket, and reacts to avatar events with expressions, animations, and props. **This is the primary deliverable** — the Tauri desktop app is a thin wrapper built on top of this in Phase 4.

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

## Phase 4: OpenClaw Plugin (v1.1)

### Goal

A first-class OpenClaw plugin (`@projectavatar/openclaw-avatar`) that hooks into the agent lifecycle for real-time avatar state transitions. The plugin replaces the skill+filter pattern for OpenClaw users. The skill remains available separately for non-OpenClaw platforms.

**Why a plugin, not just a skill?** The skill approach works everywhere but has a fundamental limitation: the agent must *finish generating text* before the output filter can extract and forward the avatar tag. A plugin hooks into `before_tool_call` — the avatar reacts the instant the agent decides to search, code, or read, *before* the tool returns. This is the difference between "avatar reacts to what the agent said" and "avatar reacts to what the agent is doing."

**How OpenClaw hooks work (important distinction):** OpenClaw has two separate hook systems:

- **Internal hooks** (`/automation/hooks`) — file-based scripts triggered by message/command/gateway events (`message:received`, `command:new`, `gateway:startup`). No agent-turn internals.
- **Plugin hooks** (plugin API only) — registered via `api.on()` inside `register(api)`. These run *inside* the agent loop: `before_tool_call`, `after_tool_call`, `agent_end`, `session_start/end`, etc.

The `before_tool_call` / `after_tool_call` hooks are **plugin-only**. They are not available to standalone hook scripts.

---

### Plugin Package Structure

```
packages/openclaw-plugin/
├── openclaw.plugin.json          # Plugin manifest (OpenClaw discovers this)
├── package.json                  # npm: @projectavatar/openclaw-avatar
├── src/
│   ├── index.ts                  # Plugin entry: exports register(api)
│   ├── tool-map.ts               # Tool name → avatar signal mapping table
│   ├── state-machine.ts          # Debouncing, priority, idle timeout
│   ├── relay-client.ts           # HTTP POST to relay (fire-and-forget)
│   └── avatar-tool.ts            # Optional "avatar" agent tool
├── skill/                        # Bundled skill (cross-platform users)
│   ├── SKILL.md                  # Symlink → skill/openclaw/SKILL.md
│   └── prompt.md                 # Symlink → skill/prompt.md
└── test/
    ├── tool-hooks.test.ts
    ├── state-machine.test.ts
    └── relay-client.test.ts
```

---

### Plugin Manifest

```json
{
  "id": "projectavatar",
  "name": "Project Avatar",
  "description": "Real-time 3D avatar driven by agent lifecycle hooks. Your agent gets a face.",
  "skills": ["skill/"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "relayUrl": { "type": "string", "default": "https://relay.projectavatar.io" },
      "enabled": { "type": "boolean", "default": true },
      "idleTimeoutMs": { "type": "number", "default": 30000, "minimum": 5000 },
      "debounceMs": { "type": "number", "default": 300, "minimum": 50 },
      "enableAvatarTool": { "type": "boolean", "default": false },
      "enableAvatarTool": { "type": "boolean", "default": false }
    }
  },
  "uiHints": {
    "relayUrl": { "label": "Relay URL", "placeholder": "https://relay.projectavatar.io" },
    "enableAvatarTool": { "label": "Avatar Tool", "help": "Register an 'avatar' tool the LLM can call explicitly", "advanced": true },
    "enableAvatarTool": { "label": "Avatar Tool", "help": "Register an 'avatar' tool the LLM can call to explicitly set avatar state", "advanced": true }
  }
}
```

**Token goes in secrets, not config.** The relay token is sensitive — it shouldn't live in the plugin config file. The plugin reads from `process.env.AVATAR_TOKEN` or OpenClaw's secrets mechanism. It logs a clear error if no token is found.

---

### Plugin Entry Point

```typescript
// src/index.ts — see packages/openclaw-plugin/src/index.ts for the full implementation
// Key hooks registered:

api.on('message_received', () =>
  sm.transition({ emotion: 'thinking', action: 'reading', prop: 'none', intensity: 'medium' }));

api.on('before_tool_call', (event) => {
  if (typeof event.toolName !== 'string') return;
  const signal = resolveToolSignal(event.toolName, 'before') ?? UNKNOWN_TOOL_BEFORE;
  sm.transition(signal);
});

api.on('after_tool_call', (event) => {
  if (typeof event.toolName !== 'string') return;
  const errorStr = typeof event.error === 'string' ? event.error : undefined;
  const signal = resolveToolSignal(event.toolName, 'after', errorStr) ?? UNKNOWN_TOOL_AFTER;
  sm.transition(signal);
});

api.on('agent_end', (event) => {
  sm.transition(event.success
    ? { emotion: 'satisfied', action: 'responding', prop: 'none', intensity: 'medium' }
    : { emotion: 'concerned', action: 'error',      prop: 'none', intensity: 'high' });
  sm.scheduleIdle();
});

api.on('session_end', () => sm.reset()); // reset() cancels all timers + pushes IDLE

if (cfg.enableAvatarTool) api.registerTool(createAvatarTool(sm), { optional: true });
```

---

### Tool → Signal Mapping Table

```typescript
// src/tool-map.ts
import type { AvatarEvent } from '@project-avatar/shared';

type ToolSignalRule = {
  before: Partial<AvatarEvent>;
  after?: Partial<AvatarEvent>;
  afterError?: Partial<AvatarEvent>;
};

export const TOOL_SIGNAL_MAP: Record<string, ToolSignalRule> = {
  // Search / research
  'web_search': {
    before:     { emotion: 'thinking',  action: 'searching',  prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'reading',    prop: 'book' },
    afterError: { emotion: 'confused',  action: 'error' },
  },
  'web_fetch': {
    before:     { emotion: 'focused',   action: 'reading',    prop: 'book' },
    after:      { emotion: 'satisfied', action: 'reading' },
  },
  // File operations
  'Read': {
    before:     { emotion: 'focused',   action: 'reading',    prop: 'book' },
  },
  'Write': {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard' },
    after:      { emotion: 'satisfied', action: 'coding',     prop: 'keyboard' },
  },
  'Edit': {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard' },
    after:      { emotion: 'satisfied', action: 'coding',     prop: 'keyboard' },
  },
  // Shell
  'exec': {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard', intensity: 'high' },
    after:      { emotion: 'satisfied', action: 'coding' },
    afterError: { emotion: 'confused',  action: 'error',      intensity: 'high' },
  },
  'process': {
    before:     { emotion: 'focused',   action: 'coding',     prop: 'keyboard' },
  },
  // Browser
  'browser': {
    before:     { emotion: 'focused',   action: 'searching',  prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'reading' },
  },
  // Messaging
  'message': {
    before:     { emotion: 'focused',   action: 'responding', prop: 'phone' },
    after:      { emotion: 'satisfied', action: 'responding' },
  },
  'tts': {
    before:     { emotion: 'excited',   action: 'responding' },
  },
  // Image analysis
  'image': {
    before:     { emotion: 'thinking',  action: 'reading',    prop: 'magnifying_glass' },
    after:      { emotion: 'focused',   action: 'responding' },
  },
  // Sub-agents
  'subagents': {
    before:     { emotion: 'thinking',  action: 'waiting' },
  },
  'nodes': {
    before:     { emotion: 'focused',   action: 'searching',  prop: 'phone' },
  },
};

export function resolveToolSignal(
  toolName: string,
  phase: 'before' | 'after',
  params?: Record<string, unknown>,
  error?: string,
): Partial<AvatarEvent> | null {
  const rule = TOOL_SIGNAL_MAP[toolName];
  if (!rule) return null;
  if (phase === 'before') return rule.before;
  if (error && rule.afterError) return rule.afterError;
  return rule.after ?? null;
}
```

---

### State Machine (Plugin-Internal)

Handles debouncing (don't flood the relay when the agent calls 5 tools in 2 seconds), emotion priority (an error signal won't get overridden by a lower-priority "reading" signal within the debounce window), and idle timeout.

```typescript
// src/state-machine.ts
import type { AvatarEvent } from '@project-avatar/shared';

const EMOTION_PRIORITY: Record<string, number> = {
  idle: 0, thinking: 1, focused: 2, satisfied: 2,
  excited: 3, confused: 4, concerned: 5,
};

const IDLE_EVENT: AvatarEvent = { emotion: 'idle', action: 'waiting', prop: 'none', intensity: 'medium' };

export function createAvatarStateMachine(opts: {
  debounceMs: number;
  idleTimeoutMs: number;
  onEmit: (event: AvatarEvent) => void;
}) {
  let current: AvatarEvent = { ...IDLE_EVENT };
  let lastEmitTime = 0;
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;

  function emit(event: AvatarEvent) {
    current = { ...event };
    lastEmitTime = Date.now();
    opts.onEmit(event);
  }

  function transition(partial: Partial<AvatarEvent>) {
    if (idleTimeout) { clearTimeout(idleTimeout); idleTimeout = null; }

    const next: AvatarEvent = {
      emotion:   partial.emotion   ?? current.emotion,
      action:    partial.action    ?? current.action,
      prop:      partial.prop      ?? current.prop      ?? 'none',
      intensity: partial.intensity ?? current.intensity ?? 'medium',
    };

    // Same state — skip
    if (
      next.emotion === current.emotion && next.action === current.action &&
      next.prop === current.prop && next.intensity === current.intensity
    ) return;

    const elapsed = Date.now() - lastEmitTime;

    if (elapsed < opts.debounceMs) {
      const curPri  = EMOTION_PRIORITY[current.emotion] ?? 1;
      const nextPri = EMOTION_PRIORITY[next.emotion]    ?? 1;

      if (nextPri < curPri) {
        // Lower priority — defer until after debounce window
        if (pendingTimeout) clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(() => emit(next), opts.debounceMs - elapsed);
        return;
      }
    }

    if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }

    if (elapsed >= opts.debounceMs) {
      emit(next);
    } else {
      pendingTimeout = setTimeout(() => emit(next), opts.debounceMs - elapsed);
    }
  }

  function scheduleIdle() {
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => emit(IDLE_EVENT), opts.idleTimeoutMs);
  }

  function reset() {
    if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
    if (idleTimeout)    { clearTimeout(idleTimeout);    idleTimeout    = null; }
    current = { ...IDLE_EVENT };
    lastEmitTime = 0;
  }

  return { transition, scheduleIdle, reset, getCurrent: () => ({ ...current }) };
}
```

---

### Relay Client

HTTP POST, not WebSocket. The plugin runs server-side inside the OpenClaw gateway — no persistent connection needed. Each event is a single fire-and-forget POST. Simpler, cheaper, avoids managing WebSocket lifecycle inside a plugin.

```typescript
// src/relay-client.ts
import { validateAvatarEvent } from '@project-avatar/shared';
import type { AvatarEvent } from '@project-avatar/shared';

export function createRelayClient(relayUrl: string, token: string) {
  const pushUrl = `${relayUrl}/push/${token}`;

  async function push(event: Partial<AvatarEvent>): Promise<void> {
    const full: AvatarEvent = {
      emotion:   event.emotion   ?? 'idle',
      action:    event.action    ?? 'waiting',
      prop:      event.prop      ?? 'none',
      intensity: event.intensity ?? 'medium',
    };

    if (!validateAvatarEvent(full).ok) return;

    try {
      await fetch(pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(full),
        signal: AbortSignal.timeout(5000), // Never block the agent pipeline
      });
    } catch {
      // Fire and forget. Avatar is cosmetic — never throw.
    }
  }

  return { push };
}
```

---

### Plugin + Skill Interaction

| Scenario | What happens |
|----------|-------------|
| OpenClaw + plugin only | Plugin handles everything via hooks. Pure event-driven — no tag emission, no output filtering needed. |
| OpenClaw + skill only | Agent emits tags, output filter strips and pushes. Works fine, no tool-level reactivity. |
| Non-OpenClaw platform | Skill is the only option. See `docs/SKILL.md`. |

---

### Distribution

```bash
# Install
openclaw plugins install @projectavatar/openclaw-avatar

# Local dev
openclaw plugins install --link ./packages/openclaw-plugin

# Enable
openclaw plugins enable projectavatar

# Set relay token (in secrets, not config)
openclaw secrets set AVATAR_TOKEN <your-token>

# Optional config
openclaw config set plugins.entries.projectavatar.config.relayUrl https://relay.projectavatar.io
openclaw config set plugins.entries.projectavatar.config.enableAvatarTool true
```

---

### Acceptance Criteria

- [ ] Plugin installs via `openclaw plugins install @projectavatar/openclaw-avatar` and shows in `openclaw plugins list`
- [ ] `before_tool_call` fires and pushes correct signal for each tool in `TOOL_SIGNAL_MAP`
- [ ] `after_tool_call` fires and updates state (success vs error paths)
- [ ] `message_received` → avatar transitions to thinking/reading
- [ ] `agent_end` → avatar transitions to satisfied (success) or concerned (error), then schedules idle
- [ ] `session_end` → avatar resets to idle
- [ ] State machine debounces rapid tool calls (no relay flood)
- [ ] State machine respects emotion priority (higher-priority emotion wins within debounce window)
- [ ] Idle timeout fires after `idleTimeoutMs` of no events
- [ ] Relay push is fire-and-forget — never blocks agent pipeline, never throws
- [ ] Missing `AVATAR_TOKEN` at startup → warning log, plugin continues (token read lazily on first push)
- [ ] Unknown tool calls → fallback signal (`focused/coding`) emitted, avatar always reacts
- [ ] `enableAvatarTool: true` → `avatar` tool appears in agent tool list and sets state correctly
- [ ] Plugin config validates via JSON schema in `openclaw.plugin.json`
- [ ] All tests pass

---

## Phase 4.1: Identity Persistence + Multi-Screen Sync (v1.1)

### Goal

The Durable Object becomes the authoritative source of truth for channel identity state. Model selection persists across sessions, syncs in real-time across all connected screens, and the web app no longer requires model in the URL.

### Architecture Decision

**The DO owns channel state.** Not the plugin. Not the browser. Not localStorage. The DO.

- `model` — selected VRM model ID (`string | null`)
- `lastAgentEventAt` — Unix timestamp of last agent push (`number | null`)
- `lastEvent` — most recent avatar event (already existed)

Everything else is a cache:
- localStorage in the web app = optimistic pre-connect cache, DO overwrites on connect
- URL = token only (`?token=abc123`), no model param
- Plugin config = token only

### Identity + Sync Flow

```
First open (no model in DO):
  1. Token in URL or generated fresh
  2. WebSocket connects → DO sends channel_state { model: null, ... }
  3. App shows ModelPickerOverlay (avatar canvas running in background)
  4. User picks model → app sends { type: 'set_model', model: 'maid-v1' } over WS
  5. DO persists model, broadcasts model_changed to ALL clients
  6. App receives model_changed echo → store updates → overlay disappears

Return visit / new screen (model already in DO):
  1. Open ?token=abc123
  2. WebSocket connects → DO sends channel_state { model: 'maid-v1', ... }
  3. App applies model immediately → avatar renders, no picker shown

Multi-screen model change:
  1. Client A sends set_model
  2. DO persists and broadcasts model_changed to all WS clients
  3. All clients (A, B, C, OBS) receive model_changed and reload VRM
```

### What Was Built

**`packages/shared/src/schema.ts`**
- Added `MODEL_ID_REGEX` and `isValidModelId()` validator
- New types: `ChannelState`, `ChannelStateMessage`, `ModelChangedMessage`, `AvatarEventMessage`
- Discriminated union `WebSocketServerMessage` covering all server→client message types
- `SetModelMessage` and `WebSocketClientMessage` for client→server messages
- `ChannelStateResponse` for the HTTP state endpoint

**`relay/src/channel.ts`**
- New DO storage keys: `model`, `lastAgentEventAt`
- Lazy in-memory cache for all three storage fields (same pattern as existing `lastEventCache`)
- `handlePush`: atomic dual-write of `lastEvent` + `lastAgentEventAt` via `storage.put(map)`
- `handleStream`: sends `channel_state` first (model + lastAgentEventAt + lastEvent + client count), no separate replay message
- `webSocketMessage`: handles `set_model` from clients — validates, persists, broadcasts `model_changed`
- `handleGetState`: new HTTP GET `/state` handler returning current `ChannelState` as JSON

**`relay/src/index.ts`**
- New route: `GET /channel/:token/state` → routes to DO's `/state` handler

**`web/src/ws/web-socket-client.ts`**
- New constructor params: `onChannelState`, `onModelChanged`
- `handleMessage()` switch: handles `channel_state`, `avatar_event`, `model_changed`
- New public `sendSetModel(model: string | null)`: sends `set_model` over open WebSocket

**`web/src/state/store.ts`**
- Removed model from URL params entirely (only token remains in URL)
- `updateUrlParams` strips stale `?model=` params from old URLs on load
- Added `lastAgentEventAt: number | null` field
- Added `applyChannelState()`: single authoritative write path for DO state, DO always wins
- `setModelId` no longer updates URL params
- localStorage model = optimistic cache only, overwritten by `applyChannelState` on connect

**`web/src/avatar/avatar-canvas.tsx`**
- Wires `onChannelState` → `applyChannelState`, `onModelChanged` → `setModelId`
- Provides `WsContext` with `sendSetModel` via React context (no prop drilling)
- `useWsClient()` hook for descendant components to access `sendSetModel`

**`web/src/app.tsx`**
- Replaced full-screen wizard gate with layered approach:
  - No token → `<TokenSetup />`
  - Token + no model + connecting → canvas + connecting indicator
  - Token + no model + connected → canvas + `<ModelPickerOverlay />`
  - Token + model → full avatar experience (no blocker)
- Canvas always mounts as soon as token is available — WS connects immediately

**`web/src/token-setup.tsx`** *(new)*
- Handles the no-token case: auto-generates a token, shows share links
- Token-only share URL (`?token=abc123`, no model param)
- Existing token paste + validation

**`web/src/model-picker-overlay.tsx`** *(new)*
- Overlay rendered on top of the live canvas
- On select: calls `sendSetModel(id)` via `useWsClient()`
- Store updates when `model_changed` echo arrives from DO — overlay disappears naturally

**`web/src/components/settings-drawer.tsx`**
- Share links updated: `?token=abc123` only (no model param)
- Model picker: calls `sendSetModel` on change (disabled when not connected)
- Hint text: "Model change syncs to all connected screens instantly."

### Share Link Format

```
https://app.projectavatar.io/?token=abc123
```

No model in URL. The DO holds the model. This link works for:
- First-time setup (will show model picker after connect)
- Re-linking lost sessions
- Adding additional screens
- OBS browser source

### GET /channel/:token/state

```
GET /channel/:token/state
→ 200 { model: "maid-v1", lastAgentEventAt: 1709123456789, connectedClients: 3 }
```

Used by the plugin for `/avatar link` command generation (Phase 4.2).

### Old URL Migration

On init, `updateUrlParams` strips any stale `?model=` param from old URLs. Users with bookmarked URLs like `?token=abc&model=maid-v1` will have the model param cleaned silently on next visit. The DO state takes over.

### Acceptance Criteria

- [x] DO stores model and lastAgentEventAt to persistent storage
- [x] WebSocket connect → client receives `channel_state` with model + lastAgentEventAt + lastEvent
- [x] App applies model from DO on connect (DO wins over localStorage)
- [x] When DO model is null, `ModelPickerOverlay` appears after connect
- [x] User picks model → `set_model` sent via WS → DO broadcasts `model_changed` to all clients
- [x] All connected screens switch model when any client calls `set_model`
- [x] Share link is `?token=abc123` only — no model param
- [x] `GET /channel/:token/state` returns current channel state as JSON
- [x] Settings drawer: model picker calls `sendSetModel`, disabled when disconnected
- [x] `?model=` stripped from URL on init (backward compat with old links)
- [x] All existing tests pass (39/39)
- [x] All packages compile clean (web, relay, plugin)

---

## Phase 4.2: Agent Presence + Plugin Share Link (v1.1)

### Goal

Surface agent activity status in the web app UI and give the plugin a `/avatar` command for generating share links and checking channel status.

### What to Build

**Agent Presence Indicator (web app)**

The DO already stores `lastAgentEventAt` as of Phase 4.1. Phase 4.2 wires it into the UI.

`StatusBadge` currently shows WebSocket connection state (connected/reconnecting/disconnected). Extend it to show two signals:

- **WS connection** (existing): the pipe between app and relay
- **Agent presence** (new): whether the agent (plugin) has pushed events recently

Agent presence states derived from `lastAgentEventAt`:
- `active` — event within last 60s (agent is currently working)
- `recent` — event within last 5min (agent was recently active)
- `away` — no event in 5min+ OR `lastAgentEventAt` is null (agent offline/not configured)

The presence state is computed in the store as a derived value — not stored separately, just computed from `lastAgentEventAt` on read. Update `lastAgentEventAt` in the store when `avatar_event` messages arrive (not just on `channel_state`) so the presence stays live.

Updated `StatusBadge`:
```
[● Connected]  [● Agent active]
[● Connected]  [○ Agent away]
```

Or a combined badge if screen space is tight — designer's call. Keep it minimal.

**`web/src/state/store.ts`**
- Add computed getter `agentPresence: 'active' | 'recent' | 'away'`
- Update `lastAgentEventAt` when an `avatar_event` arrives (in `setAvatarState` or a new `recordAgentEvent()` action)

**`web/src/avatar/avatar-canvas.tsx`**
- In the `onEvent` callback, call `recordAgentEvent()` after forwarding to the state machine

**`web/src/components/status-badge.tsx`**
- Read `agentPresence` from store
- Render a second dot/label for agent status alongside the WS status

---

**Plugin `/avatar` Command (plugin)**

Adds a slash command so users can get their share link and check channel status without opening the web app.

`GET /channel/:token/state` was added to the relay in Phase 4.1. Phase 4.2 calls it from the plugin.

**`packages/openclaw-plugin/src/index.ts`**
Register a command in `register()`:

```typescript
api.registerCommand('avatar', async (args) => {
  const token = getToken();
  if (!token) return '[Avatar] AVATAR_TOKEN not set. Run: openclaw secrets set AVATAR_TOKEN <token>';

  const subcommand = args[0] ?? 'link';

  if (subcommand === 'link') {
    // Optionally fetch current model from relay for status display, but link is just token
    const url = `https://app.projectavatar.io/?token=${token}`;
    return `[Avatar] Share link:\n${url}`;
  }

  if (subcommand === 'status') {
    try {
      const res = await fetch(`${cfg.relayUrl}/channel/${token}/state`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return `[Avatar] Relay returned ${res.status}`;
      const state = await res.json() as ChannelStateResponse;
      const model = state.model ?? 'not selected';
      const clients = state.connectedClients;
      const lastSeen = state.lastAgentEventAt
        ? `${Math.round((Date.now() - state.lastAgentEventAt) / 1000)}s ago`
        : 'never';
      return `[Avatar] Channel status:\n- Model: ${model}\n- Viewers: ${clients}\n- Last event: ${lastSeen}`;
    } catch {
      return '[Avatar] Could not reach relay.';
    }
  }

  return '[Avatar] Usage: /avatar link | /avatar status';
});
```

**`openclaw.plugin.json`**
- Add `commands` field listing the `avatar` command with description

---

### Acceptance Criteria

- [ ] `StatusBadge` shows agent presence alongside WS connection state
- [ ] Presence updates live as `avatar_event` messages arrive (no reconnect needed)
- [ ] `away` state shown correctly when agent hasn't pushed in 5min or `lastAgentEventAt` is null
- [ ] `/avatar link` returns correct share URL
- [ ] `/avatar status` returns model, viewer count, last event age
- [ ] `/avatar status` handles relay unreachable gracefully
- [ ] Plugin command registered and appears in OpenClaw help

---

## Phase 4.3: WebSocket Keepalive (v1.1)

### Goal

Prevent silent WebSocket disconnections from Cloudflare's idle timeout (default 100s) and browser/proxy timeouts. Keep connections alive with protocol-level ping/pong.

### What to Build

This is a small, focused change. No new features — just reliability.

**`relay/src/channel.ts`**

Cloudflare's Hibernation API handles WS ping/pong automatically at the protocol level when you call `state.acceptWebSocket(server)` — Cloudflare pings connected sockets before they'd otherwise time out, and the browser responds with pong. So **the DO side may require no changes** depending on Cloudflare's current behavior.

Verify: check Cloudflare Workers docs for current hibernation ping behavior. If automatic, document it and move on. If not automatic, add a periodic alarm:

```typescript
// In Channel DO — only if CF hibernation doesn't handle it automatically
async alarm(): Promise<void> {
  for (const ws of this.state.getWebSockets()) {
    try { ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() })); } catch {}
  }
  // Reschedule
  await this.state.storage.setAlarm(Date.now() + 30_000);
}
```

Schedule the alarm when the first client connects; cancel when last client disconnects.

**`web/src/ws/web-socket-client.ts`**

Handle incoming `ping` message (if the DO sends them) and respond with `pong`. If using browser-native WebSocket ping/pong frames (not JSON messages), this is handled automatically by the browser — no app-level code needed.

Add an application-level keepalive as defense-in-depth: if no message received in 60s, close and reconnect (the existing reconnect logic handles this):

```typescript
private resetKeepaliveTimer(): void {
  if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
  this.keepaliveTimer = setTimeout(() => {
    console.warn('[Avatar WS] No message in 60s — reconnecting');
    this.ws?.close();
  }, 60_000);
}
```

Call `resetKeepaliveTimer()` in `onopen` and `onmessage`.

### Acceptance Criteria

- [ ] WebSocket connections survive 5+ minutes of agent inactivity (no avatar events being pushed)
- [ ] Reconnection happens cleanly if connection does drop silently
- [ ] No visible glitch to the user when keepalive fires

---

## Phase 5: Polish + Desktop (v1.2)

### Goal
Tauri desktop app, bundled VRM models, settings UI polish, voice lip-sync.

### What to Build

**5.1 — Tauri Desktop App**

```json
// tauri.conf.json
{
  "app": {
    "windows": [{
      "title": "Project Avatar",
      "width": 400, "height": 600,
      "transparent": true,
      "decorations": false,
      "alwaysOnTop": true,
      "resizable": true
    }]
  }
}
```

Thin wrapper: `app/src/main.tsx` imports from `web/src/` via path alias. No duplicated renderer code.

**5.2 — Bundled VRM Models**

`web/src/assets/models/manifest.json` exists but has no actual `.vrm` files. Source CC0/CC-BY models from VRoid Hub. Add 3-5 options. Custom import via file picker (browser `<input type="file">` / Tauri file dialog).

**5.3 — System Tray (Desktop)**

Show/Hide, quick model switch, connection status, settings, quit.

**5.4 — Voice Lip-Sync**

Connect to TTS output (ElevenLabs / OpenAI TTS). Analyze audio amplitude → drive VRM `aa`/`ih`/`ou` blend shapes for basic lip sync.

### Acceptance Criteria

- [ ] Tauri app builds on macOS, Windows, Linux
- [ ] Transparent always-on-top overlay works on all platforms
- [ ] 3+ bundled VRM models available in model picker
- [ ] Custom VRM import works (browser + desktop)
- [ ] System tray with show/hide, model switch, quit
- [ ] Basic lip sync with TTS output

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
