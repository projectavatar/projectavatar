# Project Avatar

**Give your AI agent a face.**

Project Avatar is a web app that renders a 3D anime-style avatar reacting in real-time to what your AI agent is doing. When the agent is thinking, the avatar thinks. When it's coding, the avatar types. When it's confused, you'll see it on her face.

It works with **any** AI agent — OpenClaw, ChatGPT, Claude, your custom LLM pipeline — without modifying the agent platform. One URL sent to your agent installs the skill automatically. Those tags drive the avatar. The user never sees them.

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

**Coming next: OpenClaw Plugin** — for OpenClaw users, an upcoming plugin (`@projectavatar/openclaw`) hooks directly into the agent lifecycle via `before_tool_call` and `after_tool_call` events. The avatar reacts the moment the agent *starts* a tool call — not after the response is complete. The skill remains the universal cross-platform path.

---

## Quick Start

**No install required.** The browser app is the primary experience.

### 1. Open the Avatar

Go to **[app.projectavatar.io](https://app.projectavatar.io)**

A token is generated automatically on first visit and saved to your browser. Choose your VRM model. You're ready.

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
| Skill Install | Dynamic markdown endpoint | Agent fetches URL, installs skill with token pre-baked |
| Skill Layer | Prompt template + regex output filter | Agent-agnostic, no SDK required, works everywhere |

---

## Features (v1)

- **7 emotions** — idle, thinking, focused, excited, confused, satisfied, concerned
- **7 actions** — responding, searching, coding, reading, waiting, error, celebrating
- **6 reactive props** — keyboard, magnifying glass, coffee cup, book, phone, scroll
- **3-5 bundled VRM models** — import your own from VRoid Hub or anywhere
- **Intensity levels** — low, medium, high — affects animation energy and expression strength
- **One-URL skill install** — agent installs its own skill by fetching a link
- **OBS Browser Source** — works out of the box, transparent background
- **Cross-machine** — agent on a server, avatar on your laptop, works over the internet

---

## Roadmap

### v1.0 (MVP) ✅
- [x] **Relay server** — deployed at `relay.projectavatar.io` (Cloudflare Workers + Durable Objects)
- [x] **One-URL skill install** — `GET /skill/install?token=...` serves pre-configured SKILL.md
- [x] **Browser app** at `app.projectavatar.io` — primary experience, zero install
- [x] **Core avatar rendering** — Three.js + @pixiv/three-vrm
- [x] **Expression system** — 7 emotions → VRM blend shapes, exponential decay lerp
- [x] **Animation system** — 7 actions → animation clips, crossfade transitions
- [x] **Prop system** — 6 reactive objects, hand bone attachment
- [x] **Blink controller** — random blink, idle micro-animations
- [x] **State machine** — coordinates expressions, animations, props, idle timeout
- [x] **Skill layer** — universal prompt template + output filters (Node.js, Python, OpenClaw)
- [x] **Streaming support** — 200-char buffer for tag extraction in token streams
- [x] **OBS Browser Source** — transparent background, URL-based token
- [x] **Shared schema** — `@project-avatar/shared` with types, validation, skill template generation

### v1.1 (Next: OpenClaw Plugin)
- [ ] **`@projectavatar/openclaw` plugin** — deep lifecycle integration via OpenClaw plugin API
  - `before_tool_call` / `after_tool_call` hooks — avatar reacts the instant a tool call starts
  - `before_prompt_build` — automatic skill injection, no manual install needed
  - Optional `avatar` agent tool for explicit LLM-driven state control
  - Plugin-internal state machine with debouncing and priority
- [ ] **Token dashboard** — usage stats, rotation, expiry

### v1.2 (Polish)
- [ ] Tauri desktop app — always-on-top, system tray (optional)
- [ ] Bundled VRM models (manifest exists, models TBD)
- [ ] Voice lip-sync (connect to TTS output)
- [ ] Custom animation import

### v2
- [ ] Live2D support (alternative to VRM)
- [ ] Physics-based secondary motion (hair, clothes)
- [ ] Multi-agent support (multiple avatars)
- [ ] IK-based prop interaction
- [ ] Mobile companion app (iOS/Android)

### v3 (dreaming)
- [ ] VR/AR mode (the avatar in your space)
- [ ] Procedural animation (no pre-authored clips)
- [ ] Multi-modal input (voice tone → expression)

---

## Project Structure

```
project-avatar/
├── packages/
│   └── shared/             # Shared types, schema, constants, skill template
│       └── src/
│           ├── schema.ts   # AvatarEvent types, enums, validateAvatarEvent
│           ├── constants.ts# Protocol version, defaults, rate limits, token utils
│           └── skill-template.ts  # Single source of truth for skill doc (gen-skill-md.ts)
├── web/                    # Browser app — PRIMARY (Cloudflare Pages → app.projectavatar.io)
│   └── src/
│       ├── avatar/         # Three.js + VRM renderer
│       │   ├── avatar-scene.ts, vrm-manager.ts, expression-controller.ts
│       │   ├── animation-controller.ts, blink-controller.ts
│       │   ├── prop-manager.ts, state-machine.ts
│       ├── ws/             # WebSocket client (exponential backoff reconnect)
│       ├── state/          # Zustand store
│       ├── components/     # model-picker, settings-drawer, status-badge
│       └── setup-wizard.tsx
├── relay/                  # Cloudflare Workers relay server (→ relay.projectavatar.io)
│   └── src/
│       ├── index.ts        # Worker entry + routing
│       ├── channel.ts      # Durable Object (WebSocket hibernation + fan-out)
│       ├── skill-install.ts# GET /skill/install?token=... endpoint
│       ├── auth.ts, rate-limit.ts, types.ts
├── skill/                  # Agent skill layer
│   ├── prompt.md           # Universal prompt template
│   ├── openclaw/           # OpenClaw skill package
│   │   ├── SKILL.md        # Auto-generated via scripts/gen-skill-md.ts
│   │   ├── filter.ts       # OpenClaw output filter hook (onOutput export)
│   │   └── config.json     # {relayUrl, token, enabled, bufferLimit}
│   └── filters/
│       ├── node/           # Node.js filter + streaming filter + CLI
│       └── python/         # Python parity
├── scripts/
│   └── gen-skill-md.ts     # Regenerates skill/openclaw/SKILL.md from template
└── docs/
    ├── SCHEMA.md, RELAY.md, SKILL.md, AVATAR_APP.md
```

---

## Support

[projectavatar.io](https://projectavatar.io)

---

## Why?

AI agents are invisible. They're text on a screen. But humans are visual creatures — we connect with faces, expressions, body language. Project Avatar gives your agent a presence. Not a chatbot widget. Not a profile picture. A living, breathing (well, animated) companion that reacts to what it's doing in real-time.

It's the difference between talking to a terminal and talking to someone.

*— Built by ragr3t and Maid*
