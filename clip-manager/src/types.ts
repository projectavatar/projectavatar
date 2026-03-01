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

/** Per-clip prop transform — where the prop should be placed in world space. */
export interface PropTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/** Per-clip prop binding — which prop to show and where. */
export interface ClipPropBinding {
  /** Prop id (filename without extension, matches props/ folder). */
  prop: string;
  /** World-space transform for the prop. */
  transform: PropTransform;
  /** Material style for the prop. Default: holographic */
  material?: 'solid' | 'holographic' | 'ghostly';
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

  // Hand gesture
  handGesture?: 'relaxed' | 'fist' | 'pointing' | 'none';

  // Prop binding — which prop to show during this clip
  propBinding?: ClipPropBinding;
}

/** A single animation group — one possible animation for an action. */
export interface VfxBinding {
  type: string;
  color?: string;
  intensity?: number;
  offsetY?: number;
}

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
  bypassHeadTracking?: boolean;
  vfx?: VfxBinding[];
}

export interface EmotionData {
  weightScale: number;
  overrides: Record<string, ClipRef>;
  layers: ClipRef[];
  vfx?: VfxBinding[];
}

export interface ClipsJson {
  version: number;
  clips: Record<string, ClipData>;
  actions: Record<string, ActionData>;
  emotions: Record<string, EmotionData>;
}

export type ClipStatus = 'mapped' | 'orphan' | 'unregistered';
