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
 * Uses frame-rate independent exponential decay lerp for smooth,
 * natural transitions regardless of framerate.
 */

const EMOTION_MAP: Record<Emotion, ExpressionTarget[]> = {
  idle:      [{ name: 'neutral', weight: 1.0 }],
  thinking:  [{ name: 'neutral', weight: 0.7 }, { name: 'lookUp', weight: 0.3 }],
  focused:   [{ name: 'neutral', weight: 0.5 }, { name: 'relaxed', weight: 0.3 }],
  excited:   [{ name: 'happy', weight: 0.8 }, { name: 'surprised', weight: 0.2 }],
  confused:  [{ name: 'surprised', weight: 0.4 }, { name: 'neutral', weight: 0.3 }],
  satisfied: [{ name: 'happy', weight: 0.6 }, { name: 'relaxed', weight: 0.4 }],
  concerned: [{ name: 'sad', weight: 0.3 }, { name: 'neutral', weight: 0.4 }],
};

const INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.2,
};

export class ExpressionController {
  private vrm: VRM;
  private targetWeights = new Map<string, number>();
  private currentWeights = new Map<string, number>();
  private blendSpeed = 3.0; // exponential decay rate

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  /** Set the target emotion with optional intensity scaling. */
  setEmotion(emotion: Emotion, intensity: Intensity = 'medium'): void {
    const scale = INTENSITY_SCALE[intensity];
    const targets = EMOTION_MAP[emotion] ?? EMOTION_MAP.idle;

    // Reset all targets to zero
    this.targetWeights.clear();

    for (const target of targets) {
      this.targetWeights.set(target.name, Math.min(target.weight * scale, 1.0));
    }
  }

  /** Smoothly interpolate expression weights toward targets. Call every frame. */
  update(delta: number): void {
    if (!this.vrm.expressionManager) return;

    const allNames = new Set([...this.currentWeights.keys(), ...this.targetWeights.keys()]);

    for (const name of allNames) {
      const current = this.currentWeights.get(name) ?? 0;
      const target = this.targetWeights.get(name) ?? 0;

      // Frame-rate independent exponential decay
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

  /** Reset all expressions to zero immediately. */
  reset(): void {
    if (!this.vrm.expressionManager) return;

    for (const name of this.currentWeights.keys()) {
      this.vrm.expressionManager.setValue(name, 0);
    }
    this.currentWeights.clear();
    this.targetWeights.clear();
  }
}
