# RFC 089: Emotion Blending System

**Issue:** #89
**Status:** In Progress
**Branch:** `feat/emotion-blending`

## Summary

Replace the single-emotion system with 7 primary emotions that blend like colors. Every complex expression is a weighted mix of primaries. Color is engine-computed with optional agent override. No backward compatibility with old single-emotion format.

## Primary Emotions

| Primary | VRM blend shapes |
|---------|-----------------|
| joy | happy |
| sadness | sad |
| anger | angry |
| fear | surprised (0.4) + neutral (0.3) |
| surprise | surprised |
| disgust | angry (0.3) |
| interest | neutral (0.6) + lookUp (0.2) |

## Agent Signal Format

```ts
avatar_signal({
  emotions: { joy: "high", fear: "low" },
  color: "hotpink",    // optional CSS color name, overrides engine default
  action: "typing"     // optional, overrides inferred action
})
```

Word intensities → numeric weights:
- `subtle` → 0.15
- `low` → 0.3
- `medium` → 0.6
- `high` → 1.0

## Breaking Changes

- `AvatarEvent.emotion` removed → replaced by `AvatarEvent.emotions: EmotionBlend`
- Old emotion values (`happy`, `excited`, `bashful`, etc.) no longer exist
- `ExpressionController.setEmotion()` removed → replaced by `setEmotionBlend()`
- `avatar_signal` tool: `emotion` param removed → `emotions` dict

## Architecture

```
Emotion Blend → ResolvedBlend (energy + color + dominant + weights)
    ├── Face:      VRM blend shapes (direct weights)
    ├── Body:      action inference from dominant emotion
    ├── Idle:      energy drives amplitude/frequency/blink
    ├── Holo:      color + flash rate from blend
    ├── Trails:    color + length + speed from blend
    ├── Particles: color + orbit radius + spin speed from blend
    └── Bloom:     strength + tint from blend
```

### Core Type: ResolvedBlend

```ts
interface ResolvedBlend {
  weights: Map<PrimaryEmotion, number>;  // 0-1
  dominant: PrimaryEmotion | null;       // highest weight
  energy: number;                        // computed scalar
  color: THREE.Color;                    // lerped or agent-overridden
}
```

### Energy Formula

```ts
energy = (joy * 1.0) + (anger * 0.8) + (surprise * 0.9)
       + (interest * 0.6) + (fear * 0.7)
       - (sadness * 0.5) - (disgust * 0.3)
```

### Color Table (engine defaults, lerped by weight)

| Primary | Color | RGB |
|---------|-------|-----|
| joy | warm gold | (1, 0.85, 0.3) |
| sadness | cool blue | (0.3, 0.5, 1) |
| anger | hot red | (1, 0.2, 0.1) |
| fear | pale cyan | (0.6, 0.9, 1) |
| surprise | white flash | (1, 1, 0.9) |
| disgust | sickly green | (0.4, 0.8, 0.2) |
| interest | soft teal | (0.3, 0.8, 0.9) |

Agent `color` override (any CSS named color) replaces computed color on all VFX layers.

### Action Inference (no explicit action sent)

| Dominant | Inferred action |
|----------|----------------|
| joy (high) | celebrating |
| joy (low/med) | nodding |
| sadness | sad |
| anger | dismissive |
| fear | nervous |
| surprise | idle (startled — future clip) |
| interest | idle (lean forward — future clip) |
| disgust | idle (recoil — future clip) |

Explicit actions from tool hooks always override inferred actions.

## Implementation Phases

### Phase 1: Shared Types
- New `PrimaryEmotion`, `EmotionBlend`, `WordIntensity` types
- Updated `AvatarEvent` with `emotions` + `color` fields
- Updated `validateAvatarEvent()`

### Phase 2: Blend Resolver
- New `emotion-blend.ts` in avatar-engine
- `resolveBlend()` — single source of truth for all layers

### Phase 3: ExpressionController
- Rewrite to accept `ResolvedBlend`
- Multiple VRM blend shapes active simultaneously

### Phase 4: StateMachine
- Single path: blend-only events
- Action inference from dominant emotion
- Passes blend to all subsystems

### Phase 5: IdleLayer
- `setEnergy()` modulates breathing, bob, sway, blink

### Phase 6: VFX
- All VFX layers respond to `ResolvedBlend` color + intensity
- Holographic: color + flash rate
- Energy Trails: color + length + speed
- Particle Aura: color + orbit (closer = more intense)
- Bloom: strength from energy, tint from color

### Phase 7: Plugin + Tool Schema
- `avatar_signal` updated to new format
- Relay forwards new event shape

### Phase 8: Clip Families (deferred)
- Emotion-specific clip pools in clips.json
- Not in v1 — action inference is sufficient
