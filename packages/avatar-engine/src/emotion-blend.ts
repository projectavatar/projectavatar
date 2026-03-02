/**
 * Emotion Blend Resolver — single source of truth for all layers.
 *
 * Takes an EmotionBlend (agent signal) and resolves it into numeric weights,
 * dominant emotion, energy scalar, and blended color. Every subsystem
 * (face, body, idle, VFX) reads from ResolvedBlend — no duplicate math.
 */
import * as THREE from 'three';
import type { EmotionBlend, PrimaryEmotion } from '@project-avatar/shared';
import { PRIMARY_EMOTIONS, WORD_INTENSITY_VALUES } from '@project-avatar/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedBlend {
  /** Numeric weights per primary emotion (0–1). Only non-zero entries present. */
  weights: Map<PrimaryEmotion, number>;
  /** Highest-weight primary emotion, or null if empty blend. */
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

// ─── Neutral blend (no emotions active) ───────────────────────────────────────

const NEUTRAL_COLOR = new THREE.Color(0.5, 0.5, 0.6);

export const NEUTRAL_BLEND: Readonly<ResolvedBlend> = Object.freeze({
  weights: new Map(),
  dominant: null,
  energy: 0,
  color: NEUTRAL_COLOR.clone(),
  colorOverridden: false,
  maxWeight: 0,
});

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

  // Convert word intensities to numeric weights
  for (const emotion of PRIMARY_EMOTIONS) {
    const word = emotions[emotion];
    if (word === undefined) continue;
    const value = WORD_INTENSITY_VALUES[word];
    if (value > 0) {
      weights.set(emotion, value);
      if (value > maxWeight) {
        maxWeight = value;
        dominant = emotion;
      }
    }
  }

  // Empty blend → neutral
  if (weights.size === 0) {
    if (colorOverride) {
      const blend = { ...NEUTRAL_BLEND, color: new THREE.Color(colorOverride), colorOverridden: true };
      return blend;
    }
    return { ...NEUTRAL_BLEND, color: NEUTRAL_COLOR.clone() };
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
      // Invalid CSS color — fall back to computed
      color = _computeBlendedColor(weights);
    }
  } else {
    color = _computeBlendedColor(weights);
  }

  return { weights, dominant, energy, color, colorOverridden, maxWeight };
}

/**
 * Compute a blended color from emotion weights.
 * Weighted average in RGB space (simple, good enough for VFX).
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

// ─── Exports for testing / VFX layers ─────────────────────────────────────────

export { EMOTION_COLORS, ENERGY_COEFFICIENTS };
