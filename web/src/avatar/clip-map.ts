/**
 * Clip Map — maps avatar signals to Mixamo FBX clips.
 *
 * Architecture:
 * - Actions determine the PRIMARY clip (what the body does)
 * - Emotions can overlay or swap clips (how the body feels)
 * - Intensity scales blend weights (how much)
 *
 * Each action has a primary clip and optional secondary layers.
 * Emotions can modify weights, swap variants, or add overlays.
 *
 * All FBX files live in /animations/ and are Mixamo downloads
 * exported "without skin" for retargeting onto any VRM model.
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

export interface ActionMapping {
  /** Primary clip — always plays for this action. */
  primary: ClipEntry;
  /**
   * Optional secondary clips blended additively on top.
   * Useful for layering subtle motions (e.g. nodding while talking).
   */
  layers?: ClipEntry[];
  /**
   * Duration override for non-looping actions (seconds).
   * After this time, the state machine returns to idle.
   * If not set, uses the clip's natural duration.
   */
  duration?: number;
}

export interface EmotionModifier {
  /**
   * Override the primary clip for specific actions when this emotion is active.
   * Key = action name, value = replacement clip entry.
   */
  overrides?: Partial<Record<Action, ClipEntry>>;
  /**
   * Additional clips to layer on top when this emotion is active.
   * These blend additively with whatever action is playing.
   */
  layers?: ClipEntry[];
  /**
   * Weight multiplier applied to action clip weights (default 1.0).
   * < 1.0 makes actions subtler, > 1.0 makes them more expressive.
   */
  weightScale?: number;
}

/** Resolved clip set after combining action + emotion + intensity. */
export interface ResolvedClips {
  primary: ClipEntry;
  layers: ClipEntry[];
}

// ─── Intensity Scaling ────────────────────────────────────────────────────────

const INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.3,
};

// ─── Action → Clip Mapping ────────────────────────────────────────────────────

export const ACTION_CLIPS: Record<Action, ActionMapping> = {
  idle: {
    primary: { file: 'female-standing-idle.fbx', weight: 1.0, loop: true, fadeIn: 0.5, fadeOut: 0.5 },
  },

  talking: {
    primary: { file: 'happy-forward-hand-gesture.fbx', weight: 0.85, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
    layers: [
      { file: 'nodding-head-yes.fbx', weight: 0.2, loop: true },
    ],
  },

  typing: {
    primary: { file: 'sitting-at-a-computer-and-typing.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.6 },
  },

  nodding: {
    primary: { file: 'nodding-head-yes.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.4 },
    duration: 1.8,
  },

  waving: {
    primary: { file: 'emotional-waving-forward.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.5 },
    duration: 2.5,
  },

  greeting: {
    primary: { file: 'greeting-while-standing.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.6 },
    duration: 2.5,
  },

  laughing: {
    primary: { file: 'talking-finding-something-funny.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.6 },
    duration: 3.0,
  },

  pointing: {
    primary: { file: 'pointing-behind-with-thumb.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.5 },
    duration: 2.0,
  },

  fist_pump: {
    primary: { file: 'high-enthusiasm-fist-pump.fbx', weight: 1.0, loop: false, fadeIn: 0.1, fadeOut: 0.4 },
    duration: 2.0,
  },

  dismissive: {
    primary: { file: 'dismissing-with-back-hand.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.6 },
    duration: 2.0,
  },

  plotting: {
    primary: { file: 'evil-plotting.fbx', weight: 1.0, loop: true, fadeIn: 0.5, fadeOut: 0.6 },
  },

  sarcastic: {
    primary: { file: 'sarcastically-looking-away.fbx', weight: 1.0, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
  },

  looking_around: {
    primary: { file: 'standing-up-and-looking-around.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
  },

  shading_eyes: {
    primary: { file: 'looking-with-hand-shading-eyes.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.6 },
  },

  telling_secret: {
    primary: { file: 'telling-a-secret.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
  },

  victory: {
    primary: { file: 'big-vegas-victory-idle.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.6 },
    duration: 3.0,
  },

  head_shake: {
    primary: { file: 'gesturing-head-side-to-side.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.4 },
    duration: 1.8,
  },

  relief: {
    primary: { file: 'shaking-it-off-in-relief.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.6 },
    duration: 2.5,
  },

  cautious_agree: {
    primary: { file: 'step-back-cautiously-agreeing.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.5 },
    duration: 2.0,
  },

  angry_fist: {
    primary: { file: 'vexed-shaking-of-the-fist.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.5 },
    duration: 2.0,
  },

  rallying: {
    primary: { file: 'rallying-the-crowd-to-make-them-cheer.fbx', weight: 1.0, loop: false, fadeIn: 0.2, fadeOut: 0.5 },
    duration: 3.0,
  },

  sad_idle: {
    primary: { file: 'standing-in-a-sad-disposition.fbx', weight: 1.0, loop: true, fadeIn: 0.6, fadeOut: 0.8 },
  },

  nervous_look: {
    primary: { file: 'nervously-looking-around-left-to-right-loop.fbx', weight: 1.0, loop: true, fadeIn: 0.2, fadeOut: 0.4 },
  },

  terrified: {
    primary: { file: 'being-terrified-while-standing.fbx', weight: 1.0, loop: true, fadeIn: 0.1, fadeOut: 0.5 },
  },

  scratching_head: {
    primary: { file: 'right-hand-behind-head.fbx', weight: 1.0, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
  },

  cocky: {
    primary: { file: 'cocky-lean-back.fbx', weight: 1.0, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
  },

  questioning: {
    primary: { file: 'asking-a-question-with-one-hand.fbx', weight: 1.0, loop: true, fadeIn: 0.3, fadeOut: 0.5 },
  },

  phone: {
    primary: { file: 'female-standing-talking-on-phone.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
  },

  celebrating: {
    primary: { file: 'restrained-enthusiasm-standing-fist-pump.fbx', weight: 1.0, loop: false, fadeIn: 0.15, fadeOut: 0.6 },
    duration: 3.5,
  },
};

// ─── Emotion Modifiers ────────────────────────────────────────────────────────

export const EMOTION_MODIFIERS: Partial<Record<Emotion, EmotionModifier>> = {
  happy: {
    weightScale: 1.1,
  },

  sad: {
    weightScale: 0.7,
    overrides: {
      idle: { file: 'standing-in-a-sad-disposition.fbx', weight: 0.8, loop: true, fadeIn: 0.6, fadeOut: 0.8 },
    },
  },

  excited: {
    weightScale: 1.2,
  },

  angry: {
    weightScale: 1.15,
  },

  nervous: {
    weightScale: 0.85,
    layers: [
      { file: 'quick-nervous-look-over-right-shoulder.fbx', weight: 0.15, loop: true },
    ],
  },

  relaxed: {
    weightScale: 0.8,
  },

  confused: {
    overrides: {
      idle: { file: 'looking-forward.fbx', weight: 0.9, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
    },
  },

  bashful: {
    overrides: {
      idle: { file: 'being-bashful-while-standing.fbx', weight: 1.0, loop: true, fadeIn: 0.4, fadeOut: 0.6 },
    },
  },

  thinking: {
    overrides: {
      idle: { file: 'looking-off-into-the-distance.fbx', weight: 0.9, loop: true, fadeIn: 0.4, fadeOut: 0.5 },
    },
  },

  surprised: {
    weightScale: 1.1,
  },
};

// ─── Resolver ─────────────────────────────────────────────────────────────────

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
  const actionMapping = ACTION_CLIPS[action];
  const emotionMod = EMOTION_MODIFIERS[emotion];
  const intensityScale = INTENSITY_SCALE[intensity];
  const emotionWeightScale = emotionMod?.weightScale ?? 1.0;
  const totalScale = intensityScale * emotionWeightScale;

  // Primary clip: emotion override > action default
  const primary = emotionMod?.overrides?.[action] ?? actionMapping.primary;

  // Scale primary weight
  const scaledPrimary: ClipEntry = {
    ...primary,
    weight: Math.min(primary.weight * totalScale, 1.0),
  };

  // Collect layers: action layers + emotion layers
  const layers: ClipEntry[] = [];

  if (actionMapping.layers) {
    for (const layer of actionMapping.layers) {
      layers.push({
        ...layer,
        weight: Math.min(layer.weight * totalScale, 1.0),
      });
    }
  }

  if (emotionMod?.layers) {
    for (const layer of emotionMod.layers) {
      layers.push({
        ...layer,
        weight: Math.min(layer.weight * totalScale, 1.0),
      });
    }
  }

  return { primary: scaledPrimary, layers };
}

/**
 * Get the duration for a non-looping action.
 * Returns null for looping actions (they play indefinitely).
 */
export function getActionDuration(action: Action): number | null {
  const mapping = ACTION_CLIPS[action];
  if (mapping.primary.loop) return null;
  return mapping.duration ?? null;
}

/**
 * Get all unique FBX filenames referenced in the clip map.
 * Useful for preloading.
 */
export function getAllClipFiles(): string[] {
  const files = new Set<string>();

  for (const mapping of Object.values(ACTION_CLIPS)) {
    files.add(mapping.primary.file);
    if (mapping.layers) {
      for (const layer of mapping.layers) {
        files.add(layer.file);
      }
    }
  }

  for (const mod of Object.values(EMOTION_MODIFIERS)) {
    if (!mod) continue;
    if (mod.overrides) {
      for (const entry of Object.values(mod.overrides)) {
        if (entry) files.add(entry.file);
      }
    }
    if (mod.layers) {
      for (const layer of mod.layers) {
        files.add(layer.file);
      }
    }
  }

  return [...files];
}
