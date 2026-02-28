/** clips.json schema types */

export interface ClipRef {
  clip: string; // clip id (key in clips record)
  weight: number;
}

export interface ClipData {
  file: string;

  // Playback
  loop: boolean;
  mustFinish: boolean;
  returnToIdle: boolean;
  minPlayTime: number;
  fadeIn: number;
  fadeOut: number;

  // Categorization
  category: 'idle' | 'gesture' | 'reaction' | 'emotion' | 'continuous';
  energy: 'low' | 'medium' | 'high';
  bodyParts: string[];
  symmetric: boolean;

  // Layering
  layerPriority: number;
  additiveCompatible: boolean;
  baseOnly: boolean;

  // Tags
  tags: string[];
  incompatibleWith: string[];
}

export interface ActionData {
  primary: ClipRef;
  layers: ClipRef[];
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
