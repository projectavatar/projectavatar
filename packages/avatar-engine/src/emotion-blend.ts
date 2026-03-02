/**
 * Emotion Blend Resolver — single source of truth for all layers.
 *
 * Takes an EmotionBlend (agent signal) and resolves it into numeric weights,
 * dominant emotion, energy scalar, and blended color. Every subsystem
 * (face, body, idle, VFX) reads from ResolvedBlend — no duplicate math.
 *
 * ## Neutral baseline
 * "No emotions" doesn't mean zero — it means resting state. A barely-there
 * warmth: { joy: 0.1, interest: 0.1 }. The avatar is never truly blank.
 *
 * ## Decay
 * EmotionDecay handles smooth per-frame decay of weights toward the neutral
 * baseline. Each layer reads the decayed blend, not the raw event.
 */
import * as THREE from 'three';
import type { EmotionBlend, PrimaryEmotion } from '@project-avatar/shared';
import { PRIMARY_EMOTIONS, WORD_INTENSITY_VALUES } from '@project-avatar/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedBlend {
  /** Numeric weights per primary emotion (0–1). Only non-zero entries present. */
  weights: Map<PrimaryEmotion, number>;
  /** Highest-weight primary emotion, or null if all weights are at neutral floor. */
  dominant: PrimaryEmotion | null;
  /** Computed energy scalar (can be negative for sad/disgust-heavy blends). */
  energy: number;
  /** Blended color from primary defaults, or agent override. */
  color: THREE.Color;
  /** Whether the color was overridden by the agent. */
  colorOverridden: boolean;
  /** Maximum weight value across all primaries (0–1). */
  maxWeight: number;
}

// ─── Default emotion colors ───────────────────────────────────────────────────

const EMOTION_COLORS: Record<PrimaryEmotion, THREE.Color> = {
  joy:      new THREE.Color(1.0, 0.85, 0.3),
  sadness:  new THREE.Color(0.3, 0.5, 1.0),
  anger:    new THREE.Color(1.0, 0.2, 0.1),
  fear:     new THREE.Color(0.6, 0.9, 1.0),
  surprise: new THREE.Color(1.0, 1.0, 0.9),
  disgust:  new THREE.Color(0.4, 0.8, 0.2),
  interest: new THREE.Color(0.3, 0.8, 0.9),
};

// ─── Energy coefficients ──────────────────────────────────────────────────────

const ENERGY_COEFFICIENTS: Record<PrimaryEmotion, number> = {
  joy:      1.0,
  anger:    0.8,
  surprise: 0.9,
  interest: 0.6,
  fear:     0.7,
  sadness: -0.5,
  disgust: -0.3,
};

// ─── Neutral baseline ─────────────────────────────────────────────────────────
// "No emotion" = resting state, not dead. Slight contentment + awareness.

export const NEUTRAL_WEIGHTS: ReadonlyMap<PrimaryEmotion, number> = new Map<PrimaryEmotion, number>([
  ['joy', 0.1],
  ['interest', 0.1],
]);

const NEUTRAL_COLOR = new THREE.Color(0.9, 0.9, 0.85); // soft warm white

/** Threshold: weights at or below this are considered "at neutral floor". */
const NEUTRAL_THRESHOLD = 0.15;

/** Create a fresh neutral blend. Always returns a new object — safe to mutate. */
export function createNeutralBlend(): ResolvedBlend {
  return {
    weights: new Map(NEUTRAL_WEIGHTS),
    dominant: null,
    energy: 0.1 * ENERGY_COEFFICIENTS.joy + 0.1 * ENERGY_COEFFICIENTS.interest,
    color: NEUTRAL_COLOR.clone(),
    colorOverridden: false,
    maxWeight: 0.1,
  };
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve an emotion blend into numeric weights, dominant emotion, energy, and color.
 *
 * @param emotions  The agent's emotion blend (word intensities)
 * @param colorOverride  Optional CSS color name from the agent
 */
export function resolveBlend(emotions: EmotionBlend, colorOverride?: string): ResolvedBlend {
  const weights = new Map<PrimaryEmotion, number>();
  let dominant: PrimaryEmotion | null = null;
  let maxWeight = 0;
  let hasExplicitEmotion = false;

  // Convert word intensities to numeric weights.
  // Tie-breaking: when two primaries have equal weight, the one appearing
  // first in PRIMARY_EMOTIONS wins dominant (joy > sadness > anger > ...).
  // This is intentional — positive emotions win ties.
  for (const emotion of PRIMARY_EMOTIONS) {
    const word = emotions[emotion];
    if (word === undefined) continue;
    const value = WORD_INTENSITY_VALUES[word];
    if (value > 0) {
      weights.set(emotion, value);
      hasExplicitEmotion = true;
      if (value > maxWeight) {
        maxWeight = value;
        dominant = emotion;
      }
    }
  }

  // Empty blend → neutral baseline (not zero)
  if (!hasExplicitEmotion) {
    const blend = createNeutralBlend();
    if (colorOverride) {
      try {
        blend.color = new THREE.Color(colorOverride);
        blend.colorOverridden = true;
      } catch { /* invalid CSS color — keep neutral color */ }
    }
    return blend;
  }

  // Compute energy
  let energy = 0;
  for (const [emotion, weight] of weights) {
    energy += weight * ENERGY_COEFFICIENTS[emotion];
  }

  // Compute blended color (weighted lerp)
  let color: THREE.Color;
  let colorOverridden = false;

  if (colorOverride) {
    try {
      color = new THREE.Color(colorOverride);
      colorOverridden = true;
    } catch {
      color = _computeBlendedColor(weights);
    }
  } else {
    color = _computeBlendedColor(weights);
  }

  return { weights, dominant, energy, color, colorOverridden, maxWeight };
}

/**
 * Resolve a blend from raw numeric weights (used by EmotionDecay).
 * Skips word-intensity conversion — weights are already numbers.
 */
export function resolveBlendFromWeights(
  weights: Map<PrimaryEmotion, number>,
  colorOverride?: string,
): ResolvedBlend {
  let dominant: PrimaryEmotion | null = null;
  let maxWeight = 0;
  let hasAboveNeutral = false;

  // Iterate PRIMARY_EMOTIONS (not Map order) for consistent tie-breaking:
  // positive emotions win ties (joy > sadness > anger > ...).
  for (const emotion of PRIMARY_EMOTIONS) {
    const weight = weights.get(emotion);
    if (weight === undefined) continue;
    if (weight > NEUTRAL_THRESHOLD) hasAboveNeutral = true;
    if (weight > maxWeight) {
      maxWeight = weight;
      dominant = emotion;
    }
  }

  // If all weights are at/below neutral threshold, no dominant
  if (!hasAboveNeutral) dominant = null;

  let energy = 0;
  for (const [emotion, weight] of weights) {
    energy += weight * ENERGY_COEFFICIENTS[emotion];
  }

  let color: THREE.Color;
  let colorOverridden = false;

  if (colorOverride) {
    try {
      color = new THREE.Color(colorOverride);
      colorOverridden = true;
    } catch {
      color = _computeBlendedColor(weights);
    }
  } else {
    color = _computeBlendedColor(weights);
  }

  return { weights, dominant, energy, color, colorOverridden, maxWeight };
}

/**
 * Compute a blended color from emotion weights.
 * Weighted average in RGB space.
 */
function _computeBlendedColor(weights: Map<PrimaryEmotion, number>): THREE.Color {
  let totalWeight = 0;
  let r = 0, g = 0, b = 0;

  for (const [emotion, weight] of weights) {
    const c = EMOTION_COLORS[emotion];
    r += c.r * weight;
    g += c.g * weight;
    b += c.b * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return NEUTRAL_COLOR.clone();

  return new THREE.Color(r / totalWeight, g / totalWeight, b / totalWeight);
}

// ─── Emotion Decay ────────────────────────────────────────────────────────────

/**
 * Decay rate: how fast emotions settle back toward neutral.
 * Higher = faster decay. At 0.3, a "high" (1.0) emotion reaches
 * neutral floor (~0.1) in roughly 8 seconds.
 */
const DECAY_RATE = 0.5;
const SNAP_RATE = 5.0;

/**
 * EmotionDecay — per-frame decay of emotion weights toward neutral baseline.
 *
 * The StateMachine sets the "target" blend from each event.
 * EmotionDecay smoothly interpolates toward it, then continues
 * decaying toward neutral once the idle timeout fires.
 *
 * Subsystems read from EmotionDecay's current blend, not the raw event.
 */
export class EmotionDecay {
  private currentWeights = new Map<PrimaryEmotion, number>();
  private targetWeights = new Map<PrimaryEmotion, number>();
  private _decaying = false;
  private _colorOverride: string | undefined;
  private _currentBlend: ResolvedBlend;

  /** Scratch map reused per update to avoid per-frame allocation. */
  private _scratchWeights = new Map<PrimaryEmotion, number>();

  constructor() {
    // Start at neutral
    for (const [e, w] of NEUTRAL_WEIGHTS) {
      this.currentWeights.set(e, w);
      this.targetWeights.set(e, w);
    }
    this._currentBlend = createNeutralBlend();
  }

  /** Get the current decayed blend (read every frame by subsystems). */
  get blend(): ResolvedBlend {
    return this._currentBlend;
  }

  /** Whether we're actively decaying toward neutral (post-idle-timeout). */
  get isDecaying(): boolean {
    return this._decaying;
  }

  /**
   * Set a new target from an event's resolved blend.
   * The current weights will interpolate toward these targets.
   */
  setTarget(blend: ResolvedBlend, colorOverride?: string): void {
    this._decaying = false;
    this._colorOverride = colorOverride;
    this.targetWeights.clear();

    // Copy target weights — if blend has no weights, target is neutral
    if (blend.weights.size === 0) {
      for (const [e, w] of NEUTRAL_WEIGHTS) {
        this.targetWeights.set(e, w);
      }
    } else {
      for (const [e, w] of blend.weights) {
        this.targetWeights.set(e, w);
      }
    }
  }

  /**
   * Start decaying toward neutral. Called when the idle timeout fires.
   * Weights will gradually settle to NEUTRAL_WEIGHTS over several seconds.
   */
  startDecay(): void {
    this._decaying = true;
    this._colorOverride = undefined;
    this.targetWeights.clear();
    for (const [e, w] of NEUTRAL_WEIGHTS) {
      this.targetWeights.set(e, w);
    }
  }

  /**
   * Update per frame. Interpolates currentWeights toward targetWeights.
   * Returns true if the blend changed (so callers know to re-dispatch).
   */
  update(delta: number): boolean {
    const speed = this._decaying ? DECAY_RATE : SNAP_RATE; // snap to target fast, decay slowly
    const factor = 1 - Math.exp(-speed * delta);
    let moving = false;

    // Gather all emotions that need processing
    const allEmotions = new Set<PrimaryEmotion>();
    for (const e of this.currentWeights.keys()) allEmotions.add(e);
    for (const e of this.targetWeights.keys()) allEmotions.add(e);

    for (const emotion of allEmotions) {
      const current = this.currentWeights.get(emotion) ?? 0;
      const target = this.targetWeights.get(emotion) ?? 0;
      const gap = Math.abs(current - target);

      if (gap < 0.001) {
        // Close enough — snap to target
        if (target < 0.005) {
          this.currentWeights.delete(emotion);
        } else if (current !== target) {
          this.currentWeights.set(emotion, target);
          moving = true;
        }
        continue;
      }

      moving = true;
      const next = current + (target - current) * factor;
      this.currentWeights.set(emotion, next);
    }

    if (moving) {
      this._scratchWeights.clear();
      for (const [e, w] of this.currentWeights) this._scratchWeights.set(e, w);
      this._currentBlend = resolveBlendFromWeights(
        this._scratchWeights,
        this._colorOverride,
      );
    }

    return moving;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { EMOTION_COLORS, ENERGY_COEFFICIENTS };
