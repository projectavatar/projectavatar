import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { PrimaryEmotion } from '@project-avatar/shared';
import type { ResolvedBlend } from './emotion-blend.ts';

interface ExpressionTarget {
  name: string;
  weight: number;
}

/**
 * Emotion Blend → VRM expression mapping with smooth interpolation.
 *
 * Maps primary emotions to VRM blend shapes. Multiple primaries active
 * simultaneously = multiple blend shapes active simultaneously.
 * VRM handles mesh blending natively.
 *
 * Runs AFTER animation update in the render loop.
 */

const PRIMARY_BLEND_SHAPES: Record<PrimaryEmotion, ExpressionTarget[]> = {
  joy:      [{ name: 'happy', weight: 1.0 }],
  sadness:  [{ name: 'sad', weight: 1.0 }],
  anger:    [{ name: 'angry', weight: 1.0 }],
  fear:     [{ name: 'surprised', weight: 0.4 }, { name: 'neutral', weight: 0.3 }],
  surprise: [{ name: 'surprised', weight: 1.0 }],
  disgust:  [{ name: 'angry', weight: 0.3 }],
  interest: [{ name: 'neutral', weight: 0.6 }, { name: 'lookUp', weight: 0.2 }],
};

/**
 * Expressions that deform the mouth. When the TalkingLayer is active,
 * these are scaled down so viseme blend shapes can drive the mouth.
 * Expressions NOT in this set (e.g. 'lookUp', 'neutral') are unaffected.
 */
const MOUTH_AFFECTING_EXPRESSIONS = new Set(['happy', 'sad', 'angry', 'surprised']);

export class ExpressionController {
  private vrm: VRM;
  private targetWeights = new Map<string, number>();
  private currentWeights = new Map<string, number>();
  private blendSpeed = 3.0;

  /** 0–1: how much to suppress mouth-affecting expressions (driven by TalkingLayer). */
  private _mouthSuppression = 0;

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  /**
   * Set mouth suppression factor (0 = full expression, 1 = fully suppressed).
   * Called by AnimationController when talking state changes.
   */
  setMouthSuppression(amount: number): void {
    this._mouthSuppression = Math.max(0, Math.min(1, amount));
  }

  /**
   * Set target expression from a resolved emotion blend.
   * Each primary emotion contributes its VRM blend shapes scaled by its weight.
   */
  setEmotionBlend(blend: ResolvedBlend): void {
    this.targetWeights.clear();

    for (const [emotion, weight] of blend.weights) {
      const targets = PRIMARY_BLEND_SHAPES[emotion];
      if (!targets) continue;

      for (const target of targets) {
        const scaled = Math.min(target.weight * weight, 1.0);
        const current = this.targetWeights.get(target.name) ?? 0;
        // Additive — multiple primaries can contribute to the same blend shape.
        // Clamped to 1.0 to prevent over-saturation.
        this.targetWeights.set(target.name, Math.min(current + scaled, 1.0));
      }
    }
  }

  /**
   * Update blend shapes. Call every frame, AFTER animation update.
   *
   * @param delta  Frame delta time in seconds
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
        // Suppress mouth-affecting expressions when talking layer is active
        const effective = MOUTH_AFFECTING_EXPRESSIONS.has(name)
          ? next * (1 - this._mouthSuppression)
          : next;
        this.vrm.expressionManager.setValue(name, effective);
      }
    }
  }

  /** Reset all expressions immediately. */
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
