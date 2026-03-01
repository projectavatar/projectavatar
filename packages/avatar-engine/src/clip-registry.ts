/**
 * Clip Registry — data-driven clip resolver (v3).
 *
 * v3 actions use `groups[]` — an array of animation groups, each with
 * a `rarity` weight and `clips[]` array. When an action fires, one group
 * is selected via weighted random, then its clips are resolved with
 * emotion/intensity scaling and body part scoping.
 *
 * For looping actions (idle), the animation controller re-rolls a new
 * group after each cycle completes.
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
  handGesture?: string;
}

/** Clip layer within an animation group. */
interface ClipLayerJson {
  clip: string;
  weight: number;
  bodyParts: string[];
}

/** A single animation group — one possible animation for an action. */
export interface AnimationGroupJson {
  /** Relative probability weight. Normalized at runtime. */
  rarity: number;
  /** Clip layers that play together when this group is selected. */
  clips: ClipLayerJson[];
}

/** v3 action definition with animation groups. */
interface ActionJson {
  groups: AnimationGroupJson[];
  durationOverride: number | null;
  bypassHeadTracking?: boolean;
}

/** Clip reference (for emotion overrides/layers). */
interface ClipRefJson {
  clip: string;
  weight: number;
}

interface EmotionJson {
  weightScale: number;
  overrides: Record<string, ClipRefJson>;
  layers: ClipRefJson[];
}

/** Shape of the clips.json data object (v3). */
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
   * Select a random animation group from an action using weighted rarity.
   * Returns the group index, or 0 if only one group exists.
   */
  selectGroup(action: Action): number {
    const actionData = this.data.actions[action as string];
    if (!actionData || actionData.groups.length <= 1) return 0;

    const groups = actionData.groups;
    const totalRarity = groups.reduce((sum, g) => sum + g.rarity, 0);
    if (totalRarity <= 0) return 0;

    let roll = Math.random() * totalRarity;
    for (let i = 0; i < groups.length; i++) {
      roll -= groups[i]!.rarity;
      if (roll <= 0) return i;
    }
    return groups.length - 1;
  }

  /**
   * Get the number of animation groups for an action.
   */
  getGroupCount(action: Action): number {
    const actionData = this.data.actions[action as string];
    return actionData?.groups.length ?? 0;
  }

  /**
   * Resolve the final set of clips for a given action + emotion + intensity.
   * Uses the specified group index (from selectGroup).
   * Returns an ordered array of clip entries, each with body part scope.
   */
  resolveClips(
    action: Action,
    emotion: Emotion,
    intensity: Intensity,
    groupIndex: number = 0,
  ): ResolvedClips {
    const actionData = this.data.actions[action as string];
    const emotionData = this.data.emotions[emotion as string];
    const intensityScale = INTENSITY_SCALE[intensity];
    const emotionWeightScale = emotionData?.weightScale ?? 1.0;
    const totalScale = intensityScale * emotionWeightScale;

    // If this action has no config, fall through to idle/last-resort
    if (!actionData || actionData.groups.length === 0) {
      if (action !== 'idle') {
        return this.resolveClips('idle', emotion, intensity);
      }
      return { clips: this._lastResortClip() };
    }

    // Clamp group index
    const safeIndex = Math.min(groupIndex, actionData.groups.length - 1);
    const group = actionData.groups[safeIndex]!;

    const clips: ClipEntry[] = [];

    // Check if emotion has an override for this action's first clip
    const overrideRef = emotionData?.overrides[action as string];

    for (let i = 0; i < group.clips.length; i++) {
      const layer = group.clips[i]!;

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

    // Fallback: all clips in this group were missing/broken
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
   * Checks the first group's first clip to determine if it loops.
   */
  getActionDuration(action: Action): number | null {
    const actionData = this.data.actions[action as string];
    if (!actionData || actionData.groups.length === 0) return null;

    const firstGroup = actionData.groups[0]!;
    if (firstGroup.clips.length === 0) return null;

    const firstClip = this.data.clips[firstGroup.clips[0]!.clip];
    if (firstClip?.loop) return null;

    return actionData.durationOverride ?? null;
  }

  /**
   * Check if an action's group is looping.
   * Checks the specified group (defaults to 0). Each group can have
   * independent loop behavior — a non-looping group won't cycle.
   */
  isActionLooping(action: Action, groupIndex: number = 0): boolean {
    const actionData = this.data.actions[action as string];
    if (!actionData || actionData.groups.length === 0) return true;

    const safeIndex = Math.min(groupIndex, actionData.groups.length - 1);
    const group = actionData.groups[safeIndex]!;
    if (group.clips.length === 0) return true;

    const firstClip = this.data.clips[group.clips[0]!.clip];
    return firstClip?.loop ?? true;
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
      for (const group of action.groups) {
        for (const layer of group.clips) {
          addClipFile(layer.clip);
        }
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
   */
  /** Get the hand gesture for an action (from its first clip). */
  getHandGesture(action: Action, groupIndex: number = 0): string | undefined {
    const actionData = this.data.actions[action as string];
    if (!actionData || actionData.groups.length === 0) return undefined;
    const safeIndex = Math.min(groupIndex, actionData.groups.length - 1);
    const group = actionData.groups[safeIndex]!;
    if (group.clips.length === 0) return undefined;
    const firstClipRef = group.clips[0]!;
    const clipData = this.data.clips[firstClipRef.clip];
    return clipData?.handGesture;
  }

  /** Check if an action bypasses head tracking. */
  shouldBypassHeadTracking(action: Action): boolean {
    const actionData = this.data.actions[action as string];
    return actionData?.bypassHeadTracking === true;
  }

  /** Get raw clip data by clip name (for fallback lookups). */
  getClipData(clipName: string): ClipJson | undefined {
    return this.data.clips[clipName];
  }

  private _lastResortClip(): ClipEntry[] {
    for (const [clipId, clipData] of Object.entries(this.data.clips)) {
      console.warn('[ClipRegistry] No idle action configured — falling back to first clip:', clipId);
      return [{
        file: clipData.file,
        weight: 1.0,
        loop: true,
        fadeIn: 0.5,
        fadeOut: 0.5,
        bodyParts: ['head', 'torso', 'arms', 'legs', 'feet'],
      }];
    }
    return [];
  }

  /** Convert a clip ref to an entry (used for emotion overrides/layers). */
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
