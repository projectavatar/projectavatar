/** clips.json schema types — v2 */

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

export interface ActionData {
  clips: ClipLayer[];
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
