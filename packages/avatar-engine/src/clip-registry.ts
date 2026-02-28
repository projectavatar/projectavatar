/**
 * Clip Registry — data-driven clip resolver (v2).
 *
 * v2 actions use `clips[]` (ordered array of clip layers with body parts)
 * instead of v1's `primary` + `layers` split.
 *
 * Resolves the final set of clips for a given action + emotion + intensity,
 * with per-clip body part scoping for weight-based blending.
 */
import type { Action, Emotion, Intensity } from '@project-avatar/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Resolved clip entry with playback parameters and body part scope. */
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
  /** Which body part groups this clip affects. */
  bodyParts: string[];
}

/** Resolved clip set after combining action + emotion + intensity. */
export interface ResolvedClips {
  clips: ClipEntry[];
}

// ─── JSON shape ───────────────────────────────────────────────────────────────

/** Full clip metadata as stored in clips.json. */
export interface ClipJson {
  file: string;
  loop: boolean;
  fadeIn: number;
  fadeOut: number;
  category: 'idle' | 'gesture' | 'reaction' | 'emotion' | 'continuous';
  energy: 'low' | 'medium' | 'high';
  bodyParts: string[];
  tags: string[];
}

/** v2 clip layer within an action. */
interface ClipLayerJson {
  clip: string;
  weight: number;
  bodyParts: string[];
}

/** v2 action definition. */
interface ActionJson {
  clips: ClipLayerJson[];
  durationOverride: number | null;
}

/** v1 clip reference (for emotion overrides/layers, kept simple). */
interface ClipRefJson {
  clip: string;
  weight: number;
}

interface EmotionJson {
  weightScale: number;
  overrides: Record<string, ClipRefJson>;
  layers: ClipRefJson[];
}

/** Shape of the clips.json data object (v2). */
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
   * Returns an ordered array of clip entries, each with body part scope.
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

    // If this action has no config, fall through to the bottom fallback
    // (which recursively resolves idle, then first-clip-in-registry)
    if (!actionData) {
      if (action !== 'idle') {
        return this.resolveClips('idle', emotion, intensity);
      }
      return { clips: this._lastResortClip() };
    }

    const clips: ClipEntry[] = [];

    // Check if emotion has an override for this action's first clip
    const overrideRef = emotionData?.overrides[action as string];

    for (let i = 0; i < actionData.clips.length; i++) {
      const layer = actionData.clips[i]!;

      // Emotion override replaces the first clip only
      if (i === 0 && overrideRef) {
        const entry = this._refToEntry(overrideRef, layer.bodyParts);
        if (entry) {
          clips.push({
            ...entry,
            weight: Math.min(entry.weight * totalScale, 1.0),
          });
          continue;
        }
      }

      const clipData = this.data.clips[layer.clip];
      if (!clipData) {
        console.warn(`[ClipRegistry] Unknown clip: "${layer.clip}" — check clips.json for typos`);
        continue;
      }

      clips.push({
        file: clipData.file,
        weight: Math.min(layer.weight * totalScale, 1.0),
        loop: clipData.loop,
        fadeIn: clipData.fadeIn,
        fadeOut: clipData.fadeOut,
        bodyParts: layer.bodyParts,
      });
    }

    // Add emotion layers (extra clips added by emotion)
    if (emotionData?.layers) {
      for (const layerRef of emotionData.layers) {
        const entry = this._refToEntry(layerRef);
        if (entry) {
          clips.push({
            ...entry,
            weight: Math.min(entry.weight * totalScale, 1.0),
          });
        }
      }
    }

    // Fallback: all clips in this action were missing/broken
    if (clips.length === 0) {
      if (action !== 'idle') {
        return this.resolveClips('idle', emotion, intensity);
      }
      return { clips: this._lastResortClip() };
    }

    return { clips };
  }

  /**
   * Get the duration for a non-looping action.
   * Returns null for looping actions (they play indefinitely).
   */
  getActionDuration(action: Action): number | null {
    const actionData = this.data.actions[action as string];
    if (!actionData || actionData.clips.length === 0) return null;

    // Check the first clip (primary equivalent)
    const firstClip = this.data.clips[actionData.clips[0]!.clip];
    if (firstClip?.loop) return null;

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
      for (const layer of action.clips) {
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

  /**
   * Last resort fallback: find any usable clip in the registry.
   * Iterates entries (stable insertion order per ES2015+) and returns
   * the first one found, or an empty array if the registry is empty.
   */
  private _lastResortClip(): ClipEntry[] {
    for (const [clipId, clipData] of Object.entries(this.data.clips)) {
      console.warn('[ClipRegistry] No idle action configured — falling back to first clip:', clipId);
      return [{
        file: clipData.file,
        weight: 1.0,
        loop: true,
        fadeIn: 0.5,
        fadeOut: 0.5,
        bodyParts: ['head', 'torso', 'arms', 'legs'],
      }];
    }
    return [];
  }

  /** Convert a v1-style clip ref to an entry (used for emotion overrides/layers). */
  private _refToEntry(ref: ClipRefJson, bodyParts?: string[]): ClipEntry | null {
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
      bodyParts: bodyParts ?? clip.bodyParts,
    };
  }
}
