/**
 * Clip Registry — data-driven clip resolver.
 *
 * Accepts clips data at init time instead of importing a static JSON file.
 * Both web and clip-manager pass their own clips data when constructing.
 *
 * The resolver API is unchanged: resolveClips(), getActionDuration(), getAllClipFiles().
 */
import type { Action, Emotion, Intensity } from '@project-avatar/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  [key: string]: unknown;
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

/** Shape of the clips.json data object. */
export interface ClipsJsonData {
  version: number;
  clips: Record<string, ClipJson>;
  actions: Record<string, ActionJson>;
  emotions: Record<string, EmotionJson>;
}

// ─── Intensity Scaling ────────────────────────────────────────────────────────

const INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.3,
};

// ─── ClipRegistry class ───────────────────────────────────────────────────────

export class ClipRegistry {
  private data: ClipsJsonData;

  constructor(data: ClipsJsonData) {
    this.data = data;
  }

  /** Update the underlying data (e.g. when clip-manager edits clips.json). */
  setData(data: ClipsJsonData): void {
    this.data = data;
  }

  /**
   * Resolve the final set of clips for a given action + emotion + intensity.
   */
  resolveClips(
    action: Action,
    emotion: Emotion,
    intensity: Intensity,
  ): ResolvedClips {
    const actionData = this.data.actions[action as string];
    const emotionData = this.data.emotions[emotion as string];
    const intensityScale = INTENSITY_SCALE[intensity];
    const emotionWeightScale = emotionData?.weightScale ?? 1.0;
    const totalScale = intensityScale * emotionWeightScale;

    const effectiveAction = actionData ?? this.data.actions['idle']!;

    const overrideRef = emotionData?.overrides[action as string];
    const primaryRef = overrideRef ?? effectiveAction.primary;
    const primaryEntry = this._refToEntry(primaryRef);

    const primary: ClipEntry = primaryEntry ?? {
      file: 'female-standing-idle.fbx',
      weight: 1.0,
      loop: true,
      fadeIn: 0.5,
      fadeOut: 0.5,
    };

    const scaledPrimary: ClipEntry = {
      ...primary,
      weight: Math.min(primary.weight * totalScale, 1.0),
    };

    const layers: ClipEntry[] = [];

    for (const layerRef of effectiveAction.layers) {
      const entry = this._refToEntry(layerRef);
      if (entry) {
        layers.push({
          ...entry,
          weight: Math.min(entry.weight * totalScale, 1.0),
        });
      }
    }

    if (emotionData?.layers) {
      for (const layerRef of emotionData.layers) {
        const entry = this._refToEntry(layerRef);
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
  getActionDuration(action: Action): number | null {
    const actionData = this.data.actions[action as string];
    if (!actionData) return null;

    const clip = this.data.clips[actionData.primary.clip];
    if (clip?.loop) return null;

    return actionData.durationOverride ?? null;
  }

  /**
   * Get all unique FBX filenames referenced by actions and emotions.
   */
  getAllClipFiles(): string[] {
    const files = new Set<string>();

    const addClipFile = (clipId: string) => {
      const clip = this.data.clips[clipId];
      if (clip) files.add(clip.file);
    };

    for (const action of Object.values(this.data.actions)) {
      addClipFile(action.primary.clip);
      for (const layer of action.layers) {
        addClipFile(layer.clip);
      }
    }

    for (const emotion of Object.values(this.data.emotions)) {
      for (const override of Object.values(emotion.overrides)) {
        addClipFile(override.clip);
      }
      for (const layer of emotion.layers) {
        addClipFile(layer.clip);
      }
    }

    return [...files];
  }

  private _refToEntry(ref: ClipRefJson): ClipEntry | null {
    const clip = this.data.clips[ref.clip];
    if (!clip) {
      console.warn(`[ClipRegistry] Unknown clip: "${ref.clip}" — check clips.json for typos`);
      return null;
    }
    return {
      file: clip.file,
      weight: ref.weight,
      loop: clip.loop,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
    };
  }
}
