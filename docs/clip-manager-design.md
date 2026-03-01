# Clip Manager — Design Document

## Overview

A separate Vite app (`packages/clip-manager/`) in the monorepo for managing FBX animation clips, their metadata/tags, and action/emotion mappings. Replaces the hardcoded `clip-map.ts` with a JSON-driven registry.

Has its own VRM preview panel — can play any FBX clip directly on a loaded model, including orphaned/unmapped clips. Writes `clips.json` directly to the avatar web app via File System Access API.

## Architecture

```
clips.json (source of truth, committed to repo)
    ↓ (import at build time by packages/web/)
clip-registry.ts (typed loader, replaces clip-map.ts resolver)
    ↓
animation-controller.ts (reads resolved clips at runtime)

Clip Manager (packages/clip-manager/, localhost:5174)
    ↓ (File System Access API — direct save)
packages/web/src/data/clips.json
```

### Why separate app

- Different tool, different concerns — CRUD editor vs real-time 3D display
- Own Vite config, own dependencies, no impact on avatar viewer bundle
- Can run heavier dev deps (drag-drop, grid virtualization) freely
- Delete the folder and the viewer doesn't notice
- Own VRM preview: play ANY FBX clip on a model, not just mapped ones

### Why JSON, not a DB

- Data is static (changes at dev time, never at runtime)
- Small dataset (~50 clips, ~30 actions, ~14 emotions)
- Needs to be in the repo (version controlled, reviewable in PRs)
- No server required — pure client-side dev tool

## clips.json Schema

```jsonc
{
  "$schema": "./clips.schema.json",
  "version": 1,

  // ─── Clip Library ────────────────────────────────────────────
  "clips": {
    "female-standing-idle": {
      "file": "female-standing-idle.fbx",

      // Playback
      "loop": true,
      "mustFinish": false,
      "returnToIdle": true,
      "minPlayTime": 0,
      "fadeIn": 0.5,
      "fadeOut": 0.5,

      // Categorization
      "category": "idle",          // idle | gesture | reaction | emotion | continuous
      "energy": "low",             // low | medium | high
      "bodyParts": ["torso"],      // arms | torso | head | legs | hips | full
      "symmetric": true,

      // Layering
      "layerPriority": 0,
      "additiveCompatible": true,
      "baseOnly": false,

      // Semantic tags (freeform)
      "tags": ["calm", "neutral", "resting"],

      // Incompatibilities
      "incompatibleWith": []
    }
  },

  // ─── Action Mappings ─────────────────────────────────────────
  "actions": {
    "idle": {
      "primary": { "clip": "female-standing-idle", "weight": 1.0 },
      "layers": [],
      "durationOverride": null
    },
    "talking": {
      "primary": { "clip": "happy-forward-hand-gesture", "weight": 0.85 },
      "layers": [
        { "clip": "nodding-head-yes", "weight": 0.2 }
      ],
      "durationOverride": null
    }
  },

  // ─── Emotion Modifiers ───────────────────────────────────────
  "emotions": {
    "sad": {
      "weightScale": 0.7,
      "overrides": {
        "idle": { "clip": "standing-in-a-sad-disposition", "weight": 0.8 }
      },
      "layers": []
    }
  }
}
```

## UI Design

### Separate app: `packages/clip-manager/`, port 5174

### Layout: Three-panel + header + status bar

```
┌─────────────────────────────────────────────────────────────┐
│  Clip Manager          [Model: maid-v1 ▾]  [Save] [Export] │
├──────────────┬──────────────────────┬───────────────────────┤
│              │                      │                       │
│  Clip        │   Detail / Mapping   │   Preview             │
│  Library     │   Editor             │   (VRM + clip player) │
│              │                      │                       │
│  - search    │   - Clip detail tab  │   - 3D model          │
│  - filter    │   - Actions tab      │   - play ANY clip     │
│  - orphans   │   - Emotions tab     │   - transport controls│
│  - unregistd │   - Matrix tab       │   - timeline scrub    │
│              │                      │   - layer toggles     │
│              │                      │                       │
├──────────────┴──────────────────────┴───────────────────────┤
│  Status: 45 clips · 35 mapped · 10 orphans · unsaved (•)   │
└─────────────────────────────────────────────────────────────┘
```

### Left Panel — Clip Library

- All FBX files (from clips.json + unregistered files on disk)
- Each row: filename, category badge, energy dot, tag chips
- **Orphan indicator** (red): in clips.json but not used by any action/emotion
- **Unregistered indicator** (yellow): FBX on disk, not in clips.json
- Search by name or tag
- Filter by category, energy, body parts
- **Click → preview clip + open detail editor**
- **Drag → drop onto action mapping slots**

### Center Panel — Detail / Mapping Editor (4 tabs)

#### Tab 1: Clip Detail (when a clip is selected)
- All tag fields: loop, mustFinish, category, energy, bodyParts, etc.
- Freeform tags editor
- "Where is this clip used?" — list of actions/emotions referencing it
- For unregistered clips: "Add to registry" button

#### Tab 2: Actions
- All 29 actions, each expandable
- Primary clip slot + weight slider
- Layer clips (add/remove, weight sliders)
- Duration override input
- "Preview" button → plays in Preview panel

#### Tab 3: Emotions
- All 14 emotions, each expandable
- Weight scale slider
- Override mappings (action → clip)
- Extra layers
- "Preview" button

#### Tab 4: Matrix
- Grid: Actions × Emotions
- Color-coded cells (grey=default, blue=override, green=layered)
- Click cell → edit, hover → tooltip

### Right Panel — Preview (standalone VRM + clip player)

**This is a standalone 3D preview, NOT connected to the relay.**

- Loads a VRM model (defaults to current, switchable via header dropdown)
- **Can play ANY FBX clip** — mapped or not, orphaned or unregistered
- Loads FBX via the same Mixamo loader, plays on the model

**Transport controls:**
- Play / Pause / Stop
- Loop toggle
- Timeline scrubber (drag to seek)
- Speed control (0.25x – 2x)

**Layer toggles:**
- Idle noise on/off
- Expressions on/off

**Clip info overlay:**
- Duration, current time, loop status
- Bone count, which bones are animated

### Header Bar

- **Model dropdown**: switch VRM model
- **Save**: File System Access API → writes to `packages/web/src/data/clips.json`
  - First save prompts picker, then cached
  - Ctrl+S shortcut
- **Export**: download fallback
- **Unsaved dot** when changes pending

### Status Bar

- Total clips, mapped, orphans, unregistered
- Last saved timestamp
- Validation warnings

## Preview Architecture

The clip manager has its own Three.js scene + VRM loader. It does NOT share
the avatar viewer's AvatarCanvas — it's fully independent.

```typescript
// Simplified preview architecture
class ClipPreview {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  vrm: VRM | null
  mixer: THREE.AnimationMixer | null

  // Load any FBX and play it on the current VRM
  async playClip(fbxPath: string): Promise<void> {
    const clip = await loadMixamoAnimation(fbxPath, this.vrm);
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.play();
  }

  // Scrub to a specific time
  seek(time: number): void { ... }

  // Transport
  pause(): void { ... }
  resume(): void { ... }
  setSpeed(speed: number): void { ... }
}
```

Reuses `mixamo-loader.ts` from `packages/web/src/avatar/` (shared import or copy).

## Migration Plan

### Phase 1: clips.json + registry (no UI)
1. Script: extract clips.json from current clip-map.ts
2. Create clip-registry.ts as drop-in replacement
3. Swap imports in animation-controller.ts
4. Delete clip-map.ts
5. Validate identical runtime behavior

### Phase 2: Clip Manager app scaffold
1. `packages/clip-manager/` Vite + React app in monorepo
2. Three-panel layout shell
3. VRM preview with clip playback (standalone Three.js scene)
4. Clip library panel (reads clips.json)

### Phase 3: Editors
1. Clip detail/tag editor
2. Action mapping editor
3. Emotion mapping editor
4. Matrix view

### Phase 4: Save + Polish
1. File System Access API save
2. Orphan/unregistered detection
3. Drag-and-drop
4. Undo/redo
5. Keyboard shortcuts

## Technical Notes

- **Port**: 5174 (avatar viewer on 5173)
- **Shared code**: imports from `packages/web/src/avatar/mixamo-loader.ts` for FBX loading
- **VRM models**: reads from `packages/web/public/models/` (or symlink)
- **FBX files**: reads from `packages/web/public/animations/` (or symlink)
- **State**: local useReducer (not Zustand — different app)
- **Styling**: CSS variables matching avatar viewer's design tokens
