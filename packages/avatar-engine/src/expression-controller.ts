import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Emotion, Intensity } from '@project-avatar/shared';

interface ExpressionTarget {
  name: string;
  weight: number;
}

/**
 * Emotion → VRM expression mapping with smooth interpolation.
 *
 * Manages VRM blend shape expressions (happy, sad, etc.) with smooth interpolation.
 * Runs AFTER animation update in the render loop.
 */

const EMOTION_MAP: Record<Emotion, ExpressionTarget[]> = {
  idle:      [{ name: 'neutral', weight: 1.0 }],
  thinking:  [{ name: 'neutral', weight: 0.4 }, { name: 'lookUp', weight: 0.45 }],
  focused:   [{ name: 'neutral', weight: 0.8 }, { name: 'relaxed', weight: 0.3 }],
  excited:   [{ name: 'happy', weight: 1.0 }, { name: 'surprised', weight: 0.35 }],
  confused:  [{ name: 'surprised', weight: 0.65 }, { name: 'neutral', weight: 0.2 }],
  satisfied: [{ name: 'happy', weight: 0.75 }, { name: 'relaxed', weight: 0.5 }],
  concerned: [{ name: 'sad', weight: 0.65 }, { name: 'neutral', weight: 0.15 }],
  happy:     [{ name: 'happy', weight: 1.0 }],
  angry:     [{ name: 'angry', weight: 1.0 }],
  sad:       [{ name: 'sad', weight: 1.0 }],
  relaxed:   [{ name: 'relaxed', weight: 1.0 }],
  surprised: [{ name: 'surprised', weight: 1.0 }],
  bashful:   [{ name: 'happy', weight: 0.4 }, { name: 'neutral', weight: 0.5 }],
  nervous:   [{ name: 'neutral', weight: 0.3 }, { name: 'surprised', weight: 0.4 }],
};

/** Separate intensity scales for blend shapes and head movement (different sensitivities). */
const BLEND_INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.2,
};

export class ExpressionController {
  private vrm: VRM;
  private targetWeights = new Map<string, number>();
  private currentWeights = new Map<string, number>();
  private blendSpeed = 3.0;

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  /** Set the target emotion with optional intensity scaling. */
  setEmotion(emotion: Emotion, intensity: Intensity = 'medium'): void {
    const blendScale = BLEND_INTENSITY_SCALE[intensity];

    const targets = EMOTION_MAP[emotion] ?? EMOTION_MAP.idle;
    this.targetWeights.clear();
    for (const target of targets) {
      this.targetWeights.set(target.name, Math.min(target.weight * blendScale, 1.0));
    }

  }

  /**
   * Update blend shapes and head bone offset. Call every frame, AFTER
   * animation update so the offset applies on top of the mixer's pose.
   *
   * @param enableBlendShapes  Whether to update VRM expression blend shapes (layer toggle)
   */
  update(delta: number, enableBlendShapes = true): void {
    if (enableBlendShapes) this._updateBlendShapes(delta);
  }

  private _updateBlendShapes(delta: number): void {
    if (!this.vrm.expressionManager) return;

    const allNames = new Set([...this.currentWeights.keys(), ...this.targetWeights.keys()]);

    for (const name of allNames) {
      const current = this.currentWeights.get(name) ?? 0;
      const target  = this.targetWeights.get(name) ?? 0;

      const next = THREE.MathUtils.lerp(current, target, 1 - Math.exp(-this.blendSpeed * delta));

      if (Math.abs(next) < 0.001 && Math.abs(target) < 0.001) {
        this.currentWeights.delete(name);
        this.vrm.expressionManager.setValue(name, 0);
      } else {
        this.currentWeights.set(name, next);
        this.vrm.expressionManager.setValue(name, next);
      }
    }
  }

  /** Reset all expressions and head offset immediately. */
  reset(): void {
    if (this.vrm.expressionManager) {
      for (const name of this.currentWeights.keys()) {
        this.vrm.expressionManager.setValue(name, 0);
      }
    }
    this.currentWeights.clear();
    this.targetWeights.clear();

  }
}
