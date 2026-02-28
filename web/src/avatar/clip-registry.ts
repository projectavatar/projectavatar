/**
 * Clip Registry — loads clip data from clips.json and provides the same
 * resolver API that clip-map.ts had, but driven by data instead of hardcoded objects.
 *
 * Drop-in replacement for clip-map.ts. Same exports, same behavior.
 *
 * The JSON is imported at build time (Vite resolves it statically).
 * At runtime this is just object lookups — no async, no network.
 */
import type { Action, Emotion, Intensity } from '@project-avatar/shared';
import clipsData from '../data/clips.json';

// ─── Types (unchanged from clip-map.ts) ───────────────────────────────────────

export interface ClipEntry {
  /** FBX filename in /animations/ */
  file: string;
  /** Base blend weight (0–1). Scaled by intensity. */
  weight: number;
  /** Whether this clip should loop. */
  loop: boolean;
  /** Crossfade duration in seconds when transitioning TO this clip. */
  fadeIn?: number;
  /** Crossfade duration in seconds when transitioning AWAY from this clip. */
  fadeOut?: number;
}

/** Resolved clip set after combining action + emotion + intensity. */
export interface ResolvedClips {
  primary: ClipEntry;
  layers: ClipEntry[];
}

// ─── JSON shape ───────────────────────────────────────────────────────────────

interface ClipJson {
  file: string;
  loop: boolean;
  fadeIn: number;
  fadeOut: number;
  [key: string]: unknown; // tags, category, etc. — not needed at runtime
}

interface ClipRefJson {
  clip: string;
  weight: number;
}

interface ActionJson {
  primary: ClipRefJson;
  layers: ClipRefJson[];
  durationOverride: number | null;
}

interface EmotionJson {
  weightScale: number;
  overrides: Record<string, ClipRefJson>;
  layers: ClipRefJson[];
}

interface ClipsJsonSchema {
  version: number;
  clips: Record<string, ClipJson>;
  actions: Record<string, ActionJson>;
  emotions: Record<string, EmotionJson>;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const data = clipsData as unknown as ClipsJsonSchema;

// ─── Intensity Scaling (same as clip-map.ts) ──────────────────────────────────

const INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.3,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a ClipRefJson to a ClipEntry by looking up the clip in the registry. */
function refToEntry(ref: ClipRefJson): ClipEntry | null {
  const clip = data.clips[ref.clip];
  if (!clip) return null;
  return {
    file: clip.file,
    weight: ref.weight,
    loop: clip.loop,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  };
}

// ─── Public API (same signatures as clip-map.ts) ──────────────────────────────

/**
 * Resolve the final set of clips for a given action + emotion + intensity.
 *
 * Priority:
 * 1. Emotion override for this specific action (if exists)
 * 2. Action's default primary clip
 * 3. Emotion layers added on top
 * 4. Action layers added on top
 * 5. All weights scaled by intensity
 */
export function resolveClips(
  action: Action,
  emotion: Emotion,
  intensity: Intensity,
): ResolvedClips {
  const actionData = data.actions[action as string];
  const emotionData = data.emotions[emotion as string];
  const intensityScale = INTENSITY_SCALE[intensity];
  const emotionWeightScale = emotionData?.weightScale ?? 1.0;
  const totalScale = intensityScale * emotionWeightScale;

  // Fallback: if action not found, use idle
  const effectiveAction = actionData ?? data.actions['idle']!;

  // Primary clip: emotion override > action default
  const overrideRef = emotionData?.overrides[action as string];
  const primaryRef = overrideRef ?? effectiveAction.primary;
  const primaryEntry = refToEntry(primaryRef);

  // If the clip doesn't exist in the registry, fall back to a safe default
  const primary: ClipEntry = primaryEntry ?? {
    file: 'female-standing-idle.fbx',
    weight: 1.0,
    loop: true,
    fadeIn: 0.5,
    fadeOut: 0.5,
  };

  // Scale primary weight
  const scaledPrimary: ClipEntry = {
    ...primary,
    weight: Math.min(primary.weight * totalScale, 1.0),
  };

  // Collect layers: action layers + emotion layers
  const layers: ClipEntry[] = [];

  for (const layerRef of effectiveAction.layers) {
    const entry = refToEntry(layerRef);
    if (entry) {
      layers.push({
        ...entry,
        weight: Math.min(entry.weight * totalScale, 1.0),
      });
    }
  }

  if (emotionData?.layers) {
    for (const layerRef of emotionData.layers) {
      const entry = refToEntry(layerRef);
      if (entry) {
        layers.push({
          ...entry,
          weight: Math.min(entry.weight * totalScale, 1.0),
        });
      }
    }
  }

  return { primary: scaledPrimary, layers };
}

/**
 * Get the duration for a non-looping action.
 * Returns null for looping actions (they play indefinitely).
 */
export function getActionDuration(action: Action): number | null {
  const actionData = data.actions[action as string];
  if (!actionData) return null;

  // Check if the primary clip loops
  const clip = data.clips[actionData.primary.clip];
  if (clip?.loop) return null;

  return actionData.durationOverride ?? null;
}

/**
 * Get all unique FBX filenames referenced in the clip registry.
 * Useful for preloading.
 */
export function getAllClipFiles(): string[] {
  const files = new Set<string>();

  // All clips in the registry
  for (const clip of Object.values(data.clips)) {
    files.add(clip.file);
  }

  return [...files];
}
