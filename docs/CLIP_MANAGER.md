# Clip Manager

Dev-only Vite app for managing animation clips, action/emotion mappings, body part masking, and VFX bindings.

---

## Overview

`packages/clip-manager/` — separate from the avatar viewer. Its own Vite config, own port (5174), no impact on the viewer bundle.

Reads and writes `packages/web/src/data/clips.json` — the source of truth for all clip metadata and mappings.

---

## Architecture

```
clips.json (packages/web/src/data/)
    ↓ loaded at runtime
ClipRegistry (packages/avatar-engine/)
    ↓
AnimationController — runtime playback via Three.js AnimationMixer

Clip Manager (packages/clip-manager/, :5174)
    ↓ POST /api/save-clips (Vite dev server plugin)
clips.json
```

### Why Separate App
- Different tool, different concerns — CRUD editor vs real-time display
- Own Vite config, own dev dependencies
- Can run heavier UI without affecting viewer bundle
- Delete the folder and the viewer doesn't notice

### Why JSON
- Data is static (changes at dev time, not runtime)
- Small dataset (~16 clips, 12 actions, 10 emotions)
- Version controlled, reviewable in PRs
- No server required

---

## UI Layout

Three-panel layout: left list, center editor, right preview.

**Three tabs:** Actions (default) → Emotions → Clips

All lists sorted alphabetically.

### Actions Tab
- Left: action list with clip count badges
- Center: action editor with groups (rarity weights), clip layers (weight + body parts), duration override
- Right: 3D preview with transport controls

### Emotions Tab
- Left: emotion list
- Center: emotion editor with weight scale, action overrides, extra layers, VFX bindings
- Right: 3D preview

### Clips Tab
- Left: clip library with orphan detection
- Center: clip detail (file, loop, fadeIn/Out, category, energy, body parts, tags, prop binding)
- Right: 3D preview with body part masking

### VFX Editor
Accessible from emotion/action editors. Configures particle VFX bindings per emotion/action:
- Type selection (sparkles, hearts, rain, etc.)
- Color picker
- Intensity slider
- Vertical offset

---

## 3D Preview

`packages/clip-manager/src/preview/clip-preview.ts` — composes engine primitives (AvatarScene, VrmManager, AnimationController, IdleLayer, etc.).

Features:
- Play any FBX clip on a loaded VRM model
- Body part masking — toggle which parts play the clip
- Full engine mode with layer toggles (FBX, idle, expressions, blink)
- OrbitControls for free camera rotation (right-click)
- Prop preview with TransformControls gizmo for positioning

---

## Data Pipeline

### Saving
The clip-manager writes clips.json via a dev-only Vite plugin:

```
POST /api/save-clips → writes JSON to packages/web/src/data/clips.json
```

This endpoint only exists in Vite's dev server (`configureServer`). It does NOT exist in production builds. No authentication — local dev tool only.

### Scanning
Two additional dev-only endpoints:
- `GET /api/scan-clips` — lists `.fbx` files in `packages/web/public/animations/`
- `GET /api/scan-props` — lists `.glb` files in `packages/web/public/props/`

Used to detect orphaned clips (in filesystem but not in clips.json).

### Shared Assets
Clip-manager serves assets from `packages/web/public/` via Vite's `publicDir` config — no symlinks or copies needed.

---

## clips.json v3 Schema

```jsonc
{
  "version": 3,

  "clips": {
    "celebrating": {
      "file": "celebrating.fbx",
      "loop": false,
      "fadeIn": 0.1,
      "fadeOut": 0.35,
      "category": "gesture",    // idle | gesture | reaction | emotion | continuous
      "energy": "high",         // low | medium | high
      "bodyParts": ["head", "torso", "arms", "legs", "feet"],
      "tags": []
    }
  },

  "actions": {
    "celebrating": {
      "groups": [
        {
          "rarity": 1,
          "clips": [
            { "clip": "celebrating", "weight": 1.0, "bodyParts": ["head", "torso", "arms", "legs", "feet"] }
          ]
        }
      ],
      "durationOverride": null
    }
  },

  "emotions": {
    "happy": {
      "weightScale": 1.0,
      "overrides": {},
      "layers": [],
      "vfx": [
        { "type": "sparkles", "color": "#ffdd00", "intensity": 1.0, "offsetY": 0.3 }
      ]
    }
  }
}
```

### Groups & Rarity
Each action has one or more groups. When an action fires, one group is randomly selected based on rarity weights. For looping actions, a new group is re-rolled after each cycle. This gives natural variation without manual cycling.

---

## Key Files

| File | Purpose |
|------|---------|
| `packages/clip-manager/src/app.tsx` | Root layout, tab routing |
| `packages/clip-manager/src/state.ts` | useReducer state management |
| `packages/clip-manager/src/components/action-editor.tsx` | Action group/clip editor |
| `packages/clip-manager/src/components/emotion-editor.tsx` | Emotion override/layer editor |
| `packages/clip-manager/src/components/clip-detail.tsx` | Individual clip metadata |
| `packages/clip-manager/src/components/vfx-editor.tsx` | VFX binding editor |
| `packages/clip-manager/src/preview/clip-preview.ts` | Engine-based 3D preview |
| `packages/clip-manager/src/preview/preview-panel.tsx` | Preview UI + controls |
| `packages/clip-manager/vite.config.ts` | Dev server plugins + shared publicDir |

---

## Running

```bash
npm run clips        # or: cd packages/clip-manager && npm run dev
# → http://localhost:5174
```

Requires VRM model files in `packages/web/public/models/` and FBX clips in `packages/web/public/animations/`.
