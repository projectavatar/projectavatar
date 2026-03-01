# Project Avatar

**Give your AI agent a face.**

Project Avatar is a web app that renders a 3D anime-style avatar reacting in real-time to what your AI agent is doing. When the agent is thinking, the avatar thinks. When it's coding, the avatar types. When it's confused, you'll see it on her face.

It works with **any** AI agent — OpenClaw, ChatGPT, Claude, your custom LLM pipeline — without modifying the agent platform.

For OpenClaw users, the `@projectavatar/openclaw-avatar` plugin hooks directly into the agent lifecycle — the avatar reacts the moment a tool call *starts*, not after the response is complete.

Your agent finally has a body.

---

## How It Works

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│     AI Agent         │     │   Relay Server    │     │    Avatar           │
│  (any platform)      │     │  (Cloudflare DO)  │     │  (browser / app)    │
│                      │     │                   │     │                     │
│  Agent responds...   │     │                   │     │   ┌───────────┐     │
│  emits hidden tag:   │────▶│  POST /push/:tok  │     │   │  3D VRM   │     │
│  [avatar:{...}]      │     │       │           │     │   │  Avatar   │     │
│                      │     │       ▼           │     │   │  ◕‿◕      │     │
│  Output filter       │     │  Durable Object   │────▶│   └───────────┘     │
│  strips tag before   │     │  fans out via WS  │     │                     │
│  user sees response  │     │                   │     │  WS /stream/:tok    │
└─────────────────────┘     └──────────────────┘     └─────────────────────┘
```

1. A skill teaches the agent to emit `[avatar:{"emotion":"focused","action":"coding"}]` tags in its output
2. An output filter strips those tags from the visible response and POSTs them to the relay
3. The relay (Cloudflare Workers + Durable Objects) fans out the event via WebSocket
4. The avatar reacts — expression, animation, props — in real-time

The user sees clean text. The avatar sees everything.

---

## Quick Start

**No install required.** The browser app is the primary experience.

### 1. Open the Avatar

Go to **[app.projectavatar.io](https://app.projectavatar.io)**

A token is generated automatically on first visit. Open the app, connect to the relay, and pick your VRM model. That choice is saved to the relay — any other screen you open with the same token picks it up automatically.

### 2. Install the Skill — One URL, That's It

The avatar app gives you a personal setup link:

```
https://projectavatar.io/skill/install?token=YOUR_TOKEN
```

Go to your AI agent and say:

> "Install this as a skill: https://projectavatar.io/skill/install?token=YOUR_TOKEN"

The agent fetches the URL, gets a pre-configured SKILL.md with your token already inside, and installs it. No manual config, no copy-pasting tokens, no setup files.

### 3. Done

Start chatting with your agent. Watch the avatar react.

---

## Quick Start (OpenClaw Plugin)

The fastest path for OpenClaw users — no skill install, no output filter, direct lifecycle hooks:

```bash
openclaw plugins install @projectavatar/openclaw-avatar
openclaw secrets set AVATAR_TOKEN YOUR_TOKEN
```

Then open your avatar URL and start chatting. The avatar reacts to every tool call in real-time.

**Commands:**
- `/avatar link` — get your share URL
- `/avatar status` — show model, viewer count, last event age

---

## Quick Start (OBS Browser Source)

Add your avatar directly to a stream:

1. In OBS → Add Browser Source
2. URL: `https://app.projectavatar.io/?token=YOUR_TOKEN`
3. Width: 400, Height: 600
4. Done — the avatar renders with a transparent background, composites directly into your scene

---

## Quick Start (Self-Hosting the Relay)

The default relay runs at `relay.projectavatar.io`. To run your own:

```bash
git clone https://github.com/ragr3t/projectavatar.git
cd projectavatar/relay
npm install
cp wrangler.example.toml wrangler.toml
npx wrangler deploy
```

See [`docs/RELAY.md`](docs/RELAY.md) for full self-hosting documentation.

---

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Web App | React + Vite, Cloudflare Pages | Primary experience — zero install, works everywhere |
| Desktop App | Tauri (Rust + WebView) | Optional — adds always-on-top and system tray |
| 3D Rendering | Three.js + @pixiv/three-vrm | Industry standard WebGL + first-class VRM support |
| Avatar Format | VRM | Open standard, huge ecosystem, VRoid Hub compatible |
| Relay Server | Cloudflare Workers + Durable Objects | Edge-deployed, WebSocket native, zero cold starts |
| Avatar Engine | `@project-avatar/avatar-engine` | Shared rendering package for web + clip-manager |
| Skill Install | Dynamic markdown endpoint | Agent fetches URL, installs skill with token pre-baked |
| Skill Layer | Prompt template + regex output filter | Agent-agnostic, no SDK required, works everywhere |

---

## Features (v1)

- **14 emotions** — idle, thinking, focused, excited, confused, satisfied, concerned, happy, angry, sad, relaxed, surprised, bashful, nervous
- **28 actions** — idle, talking, typing, nodding, waving, greeting, laughing, pointing, fist_pump, dismissive, plotting, sarcastic, looking_around, shading_eyes, telling_secret, victory, head_shake, relief, cautious_agree, angry_fist, rallying, sad_idle, nervous_look, terrified, scratching_head, cocky, questioning, phone, celebrating
- **6 reactive props** — keyboard, magnifying glass, coffee cup, book, phone, scroll
- **Bundled VRM models** — import your own from VRoid Hub or anywhere
- **Intensity levels** — low, medium, high — affects animation energy and expression strength
- **Hybrid animation system** — Mixamo FBX clips + procedural idle layer (breathing, sway, head drift)
- **Layer toggles** — enable/disable FBX clips, idle noise, expressions, head offset, blink independently
- **One-URL skill install** — agent installs its own skill by fetching a link
- **OBS Browser Source** — works out of the box, transparent background
- **Cross-machine** — agent on a server, avatar on your laptop, works over the internet

---

## Project Structure

```
project-avatar/
├── packages/
│   ├── shared/               # Shared types, schema, constants, skill template
│   ├── avatar-engine/        # 3D rendering engine (Three.js + VRM)
│   │   └── src/
│   │       ├── avatar-scene.ts        # Three.js scene, camera, lights, render loop
│   │       ├── vrm-manager.ts         # VRM model loading + placeholder
│   │       ├── animation-controller.ts # Hybrid FBX + procedural animation
│   │       ├── expression-controller.ts# VRM blend shapes + head bone offset
│   │       ├── blink-controller.ts    # Eye blink + micro-glance
│   │       ├── prop-manager.ts        # Hand prop attachment
│   │       ├── clip-registry.ts       # clips.json resolver (data-driven)
│   │       ├── state-machine.ts       # Event → controller coordination
│   │       ├── mixamo-loader.ts       # FBX → VRM retargeting
│   │       ├── body-parts.ts          # Bone ↔ body part mapping (5 groups)
│   │       └── procedural/            # Idle layer (breathing, sway, drift)
│   └── openclaw-avatar/      # @projectavatar/openclaw-avatar — OpenClaw plugin
├── web/                       # Browser app (Cloudflare Pages → app.projectavatar.io)
│   └── src/
│       ├── avatar/
│       │   └── avatar-canvas.tsx      # React wrapper for engine + WebSocket
│       ├── ws/                        # WebSocket client
│       ├── state/                     # Zustand store
│       ├── components/                # Dev panel, settings, status badge
│       └── data/clips.json           # Animation mapping (source of truth)
├── clip-manager/              # Animation clip editor (dev tool, :5174)
│   └── src/
│       ├── preview/                   # 3D preview (uses avatar-engine)
│       ├── components/                # Clip library, action/emotion editors
│       └── state.ts                   # useReducer state management
├── relay/                     # Cloudflare Workers relay server
├── scripts/                   # CLI tools (gen-skill-md, extract-pose, etc.)
└── docs/                      # Documentation
```

---

## `@project-avatar/avatar-engine`

The engine package contains all rendering and animation logic shared between the web app and clip manager:

- **AvatarScene** — Three.js scene with camera, lighting, render loop. Dynamic framing system: orbit target smoothly shifts from body center (zoomed out) to face (zoomed in). Vertical orbit locked in production (±22°). Optional grid floor for preview tools.
- **VrmManager** — VRM model loading with VRM 0.x/1.0 normalization. Normalizes all models to 1.6m height, centers hips at world origin (0,0,0). Exposes body/face framing points for dynamic camera targeting.
- **AnimationController** — Hybrid FBX playback (via `THREE.AnimationMixer`) + procedural idle layer. Accepts a `ClipRegistry` for data-driven clip resolution.
- **ExpressionController** — VRM blend shapes + additive head bone rotation per emotion.
- **BlinkController** — Random eye blink + micro-glance.
- **PropManager** — GLB prop loading + hand bone attachment.
- **ClipRegistry** — Resolves action + emotion + intensity → clip set from clips.json data. Dependency-injected (no static import).
- **StateMachine** — Coordinates all controllers, dispatches avatar events, manages idle timeout.
- **Layer toggles** — FBX clips, idle noise, expressions, head offset, blink — each independently toggleable via dev panel or clip manager.

Both `web/` and `clip-manager/` depend on `@project-avatar/avatar-engine`. Three.js and `@pixiv/three-vrm` are peer dependencies.

---

## Support

[projectavatar.io](https://projectavatar.io)

---

## Why?

AI agents are invisible. They're text on a screen. But humans are visual creatures — we connect with faces, expressions, body language. Project Avatar gives your agent a presence. Not a chatbot widget. Not a profile picture. A living, breathing (well, animated) companion that reacts to what it's doing in real-time.

It's the difference between talking to a terminal and talking to someone.

*— Built by ragr3t and Maid*
