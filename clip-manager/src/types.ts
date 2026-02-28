/** clips.json schema types — v3 (animation groups) */

export interface ClipRef {
  clip: string; // clip id (key in clips record)
  weight: number;
}

export interface ClipLayer {
  clip: string;
  weight: number;
  bodyParts: string[];
}

export interface ClipData {
  file: string;

  // Playback
  loop: boolean;
  fadeIn: number;
  fadeOut: number;

  // Categorization
  category: 'idle' | 'gesture' | 'reaction' | 'emotion' | 'continuous';
  energy: 'low' | 'medium' | 'high';
  bodyParts: string[];

  // Tags
  tags: string[];
}

/** A single animation group — one possible animation for an action. */
export interface AnimationGroup {
  /** Relative probability weight (0–1). Normalized at runtime. */
  rarity: number;
  /** Clip layers that play together when this group is selected. */
  clips: ClipLayer[];
}

export interface ActionData {
  /** Animation groups — weighted random selection picks one per trigger. */
  groups: AnimationGroup[];
  durationOverride: number | null;
}

export interface EmotionData {
  weightScale: number;
  overrides: Record<string, ClipRef>;
  layers: ClipRef[];
}

export interface ClipsJson {
  version: number;
  clips: Record<string, ClipData>;
  actions: Record<string, ActionData>;
  emotions: Record<string, EmotionData>;
}

export type ClipStatus = 'mapped' | 'orphan' | 'unregistered';
