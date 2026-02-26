# Project Avatar

**Give your AI agent a face.**

Project Avatar is a desktop app that renders a 3D anime-style avatar that reacts in real-time to what your AI agent is doing. When the agent is thinking, the avatar thinks. When it's coding, the avatar types. When it's confused, you'll see it on her face.

It works with **any** AI agent — OpenClaw, ChatGPT, Claude, your custom LLM pipeline — without modifying the agent platform. A small prompt addition teaches the agent to emit invisible signal tags. Those tags drive the avatar. The user never sees them.

Your agent finally has a body.

---

## How It Works

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│     AI Agent         │     │   Relay Server    │     │    Avatar App       │
│  (any platform)      │     │  (Cloudflare DO)  │     │  (Tauri + Three.js) │
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

**The signal flows like this:**

1. A skill/prompt addition teaches the agent to emit `[avatar:{"emotion":"focused","action":"coding"}]` tags in its output
2. An output filter intercepts these tags, strips them from the visible response, and POSTs them to the relay server
3. The relay server (a Cloudflare Worker with Durable Objects) fans out the event via WebSocket
4. The avatar app receives the event and transitions the 3D avatar — expression, animation, props — in real-time

The user sees clean text. The avatar sees everything.

---

## Quick Start (Browser — no install required)

**The fastest way to get started:**

1. Go to `https://avatar.projectavatar.dev`
2. Enter your relay token (or generate one on the page)
3. Choose your VRM model
4. Bookmark it, or add it as an OBS Browser Source for streaming
5. Done

The browser version is the full experience — same renderer, same models, same everything. The desktop app adds always-on-top and system tray on top of that.

---

## Quick Start (Desktop App)

**You need:** The avatar desktop app + an agent that supports custom system prompts.

### 1. Install the Avatar App

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | `avatar-app-x.x.x-aarch64.dmg` |
| macOS (Intel) | `avatar-app-x.x.x-x64.dmg` |
| Windows | `avatar-app-x.x.x-x64-setup.exe` |
| Linux (AppImage) | `avatar-app-x.x.x-x86_64.AppImage` |

### 2. Generate a Token

Open the app → Settings → Generate Token. This creates a unique channel on the relay server. Copy the token.

### 3. Add the Skill to Your Agent

Add the Project Avatar skill to your agent's system prompt. The exact text is in [`docs/SKILL.md`](docs/SKILL.md), but the gist:

```
You have a visual avatar. At the START of every response, emit a signal tag:
[avatar:{"emotion":"<emotion>","action":"<action>"}]

This tag is invisible to the user. It drives your avatar's expression and animation.
```

### 4. Configure the Output Filter

The output filter runs alongside your agent. It intercepts `[avatar:{...}]` tags, strips them from the response, and forwards them to the relay.

For **OpenClaw**: Install the `avatar` skill — it handles everything automatically.

For **other agents**: Use the provided Node.js or Python filter. See [`docs/SKILL.md`](docs/SKILL.md) for setup.

### 5. Done

Start chatting with your agent. Watch the avatar react.

---

## Quick Start (Self-Hosting the Relay)

The default relay is hosted at `relay.projectavatar.dev`. If you want to run your own:

```bash
# Clone the repo
git clone https://github.com/linh-n/project-avatar.git
cd project-avatar/relay

# Install dependencies
npm install

# Configure (copy and edit)
cp wrangler.example.toml wrangler.toml

# Deploy to Cloudflare Workers
npx wrangler deploy
```

You need a Cloudflare account with Workers and Durable Objects enabled. See [`docs/RELAY.md`](docs/RELAY.md) for full self-hosting documentation.

---

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Desktop App | [Tauri](https://tauri.app/) (Rust + WebView) | Native performance, tiny bundle (~8MB), cross-platform |
| Browser App | React + Vite, static deploy | Zero install, OBS Browser Source ready, same codebase as desktop |
| 3D Rendering | [Three.js](https://threejs.org/) + [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) | Industry standard WebGL + first-class VRM support |
| Avatar Format | [VRM](https://vrm.dev/) | Open standard, massive ecosystem, VRoid Hub compatible |
| Relay Server | [Cloudflare Workers](https://workers.cloudflare.com/) + [Durable Objects](https://developers.cloudflare.com/durable-objects/) | Edge-deployed, WebSocket native, zero cold starts |
| Skill Layer | Plain text prompt + regex output filter | Agent-agnostic, no SDK required, works everywhere |

---

## Features (v1)

- **7 emotions** — idle, thinking, focused, excited, confused, satisfied, concerned
- **7 actions** — responding, searching, coding, reading, waiting, error, celebrating
- **6 reactive props** — keyboard, magnifying glass, coffee cup, book, phone, scroll
- **3-5 bundled VRM models** — with support for importing your own from VRoid Hub or anywhere
- **Intensity levels** — low, medium, high — affecting animation energy and expression strength
- **Always-on-top mode** — pin the avatar as a desktop companion
- **Transparent background** — the avatar floats on your desktop, no window chrome

---

## Roadmap

### v1 (MVP — 4 weeks)
- [x] Core avatar rendering with VRM support
- [x] Expression system (emotion → blend shapes)
- [x] Animation system (action → animation clips)
- [x] Prop system (reactive objects)
- [x] Relay server (Cloudflare Workers + DO)
- [x] Agent skill (prompt template + output filter)
- [x] Settings UI (token, model selection, positioning)
- [x] Browser app at `avatar.projectavatar.dev` (no install required)
- [x] OBS Browser Source support out of the box

### v1.1
- [ ] Voice lip-sync (connect to TTS output)
- [ ] Custom animation import
- [ ] Multi-agent support (multiple avatars)
- [ ] OBS virtual camera integration

### v2
- [ ] Live2D support (alternative to VRM)
- [ ] Physics-based secondary motion (hair, clothes)
- [ ] IK-based prop interaction
- [ ] Plugin system for custom behaviors
- [ ] Mobile companion app (iOS/Android)

### v3 (dreaming)
- [ ] VR/AR mode (the avatar in your space)
- [ ] Procedural animation (no pre-authored clips)
- [ ] Multi-modal input (voice tone → expression)

---

## Project Structure

```
project-avatar/
├── app/                    # Tauri desktop application
│   ├── src-tauri/          # Rust backend (window, tray, IPC)
│   └── src/                # React/TypeScript frontend
│       ├── components/     # UI components
│       ├── avatar/         # Three.js + VRM rendering (shared with web)
│       ├── state/          # Zustand state management
│       └── ws/             # WebSocket client
├── web/                    # Browser app (static deploy)
│   ├── src/                # Thin wrapper — imports avatar/ renderer from app
│   ├── index.html
│   └── vite.config.ts
├── relay/                  # Cloudflare Workers relay server
│   ├── src/
│   │   ├── index.ts        # Worker entry point + routing
│   │   └── channel.ts      # Durable Object (WebSocket pub/sub hub)
│   └── wrangler.toml
├── skill/                  # Agent skill definitions
│   ├── openclaw/           # OpenClaw skill package
│   ├── prompt.md           # Universal prompt template
│   └── filters/            # Output filter implementations
│       ├── node/
│       └── python/
└── docs/                   # Documentation
    ├── SCHEMA.md
    ├── RELAY.md
    ├── SKILL.md
    └── AVATAR_APP.md
```

---

## Contributing

Project Avatar is open source and contributions are welcome.

### Development Setup

```bash
# Clone
git clone https://github.com/linh-n/project-avatar.git
cd project-avatar

# App development
cd app
npm install
npm run tauri dev

# Relay development
cd relay
npm install
npx wrangler dev

# Skill development
cd skill
npm install
npm test
```

### Guidelines

- **TypeScript everywhere** (except Tauri's Rust shell)
- **Opinions welcome** — if you think a technical decision is wrong, open an issue and make your case
- **Tests required** for relay and skill packages
- **VRM models** — only include models with CC0/CC-BY licenses

### Reporting Issues

Open an issue. Include:
- Your platform (OS, version)
- Your agent setup (which AI, which platform)
- Steps to reproduce
- What you expected vs what happened

---

## License

MIT — do whatever you want with it.

---

## Why?

AI agents are invisible. They're text on a screen. But humans are visual creatures — we connect with faces, expressions, body language. Project Avatar gives your agent a presence. Not a chatbot widget. Not a profile picture. A living, breathing (well, animated) companion that reacts to what it's doing in real-time.

It's the difference between talking to a terminal and talking to someone.

*— Built by [Linh](https://github.com/linh-n) and [Maid](https://github.com/linh-n/maid) 🧹*
