# Project Avatar

**Give your AI agent a face.**

Project Avatar renders a 3D anime-style avatar that reacts in real-time to what your AI agent is doing. The agent thinks — the avatar thinks. The agent codes — the avatar types. The agent panics — you see it on her face.

Works with any AI agent. For [OpenClaw](https://openclaw.ai) users, a plugin hooks directly into the agent lifecycle — no configuration, no output parsing, just install and go.

Your agent finally has a body.

---

## How It Works

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│     AI Agent         │     │   Relay Server    │     │    Avatar           │
│  (any platform)      │     │  (Cloudflare DO)  │     │  (browser / desktop)│
│                      │     │                   │     │                     │
│  Agent does things → │────▶│  WebSocket relay  │────▶│   3D VRM avatar     │
│  Plugin/skill emits  │     │  fans out events  │     │   reacts in         │
│  avatar signals      │     │                   │     │   real-time          │
└─────────────────────┘     └──────────────────┘     └─────────────────────┘
```

1. Your AI agent runs with a plugin or skill that emits avatar signals (emotions, actions, props)
2. Signals go to the relay server (Cloudflare Workers + Durable Objects)
3. The relay fans out via WebSocket to any connected avatar viewer
4. The avatar reacts — expressions, animations, props — instantly

---

## Getting Started

### 1. Open the Avatar

Go to **[app.projectavatar.io](https://app.projectavatar.io)**

A token is generated automatically. Pick your VRM model. Done.

### 2. Connect Your Agent

#### OpenClaw (recommended)

```bash
openclaw plugins install @projectavatar/openclaw-avatar
openclaw secrets set AVATAR_TOKEN <your-token>
```

The plugin hooks into the agent lifecycle directly — the avatar reacts the moment a tool call starts, not after the response. No skill files, no output parsing.

**Commands:**
- `/avatar link` — get your shareable avatar URL
- `/avatar status` — show connection info, model, viewer count

#### Any Other Agent

Give your agent the skill install URL from the avatar app:

```
https://projectavatar.io/skill/install?token=YOUR_TOKEN
```

Tell your agent: *"Install this as a skill."* It fetches a pre-configured SKILL.md with your token baked in. The agent learns to emit avatar signals in its output, and an output filter strips them before the user sees anything.

---

## Desktop App

A native Tauri app — transparent, fullscreen, always-on-top. Your avatar floats on your desktop as an overlay.

**Prerequisites:**

- **macOS:** `xcode-select --install` + [Rust](https://rustup.rs)
- **Windows:** [Build Tools for Visual Studio 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ workload) + [Rust](https://rustup.rs)

**Run:**

```bash
git clone https://github.com/projectavatar/projectavatar.git
cd projectavatar
npm install
npm run desktop
```

The avatar covers your entire screen with click-through transparency. Hover the model to interact — pan, rotate, zoom. Everything else passes straight to your desktop.

Settings live in the system tray. Double-tap Escape to close.

---

## OBS Browser Source

Add your avatar to a stream:

1. OBS → Add Browser Source
2. URL: `https://app.projectavatar.io/?token=YOUR_TOKEN`
3. Size: 400×600 (or whatever fits your layout)
4. Transparent background — composites directly into your scene

---

## Self-Hosting the Relay

The default relay runs at `relay.projectavatar.io`. To run your own:

```bash
cd packages/relay
npm install
cp wrangler.example.toml wrangler.toml
npx wrangler deploy
```

See [`docs/RELAY.md`](docs/RELAY.md) for details.

---

## What the Avatar Can Do

- **7 primary emotions** with 4 intensity levels — joy, sadness, anger, fear, surprise, disgust, interest (subtle → low → medium → high)
- **12 body actions** — idle, talking, typing, nodding, laughing, celebrating, dismissive, searching, nervous, sad, plotting, greeting
- **World-space props** — 3D objects attached to hands (keyboard, tablet), holographic/solid/ghostly materials
- **Hybrid animation** — Mixamo FBX clips + procedural idle (air mode: hover + leg dangle; ground mode: breathing + sway)
- **30-bone finger retargeting** — Mixamo → VRM finger mapping with procedural curl fallback
- **Visual effects** — data-driven particles per emotion, energy trails, bloom, holographic overlay
- **Cursor tracking** — head and eyes follow your mouse
- **Any VRM model** — import from VRoid Hub or bring your own

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Web App | React + Vite → Cloudflare Pages |
| Desktop App | Tauri v2 (Rust + WebView) |
| 3D Engine | Three.js + @pixiv/three-vrm |
| Avatar Format | VRM (open standard) |
| Relay Server | Cloudflare Workers + Durable Objects |
| Engine Package | `@project-avatar/avatar-engine` |
| OpenClaw Plugin | `@projectavatar/openclaw-avatar` |

---

## Project Structure

```
project-avatar/
├── packages/
│   ├── shared/               # Types, schema, constants
│   ├── avatar-engine/        # 3D rendering engine (shared by web + desktop)
│   ├── openclaw-avatar/      # OpenClaw plugin
│   ├── web/                  # Browser app → app.projectavatar.io
│   ├── desktop/              # Tauri desktop app
│   ├── clip-manager/         # Animation editor (dev tool)
│   └── relay/                # Cloudflare Workers relay
├── scripts/                  # CLI tools
└── docs/                     # Documentation
```

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and self-host. Network deployments of modified versions must share source.

---

## Why?

AI agents are invisible. They're text on a screen. But humans connect with faces, expressions, body language. Project Avatar gives your agent a presence — not a chatbot widget, not a profile picture, but a living companion that reacts to what it's doing in real-time.

It's the difference between talking to a terminal and talking to someone.

*— Linh & Maid*
