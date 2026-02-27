import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Emotion, Intensity } from '@project-avatar/shared';

interface ExpressionTarget {
  name: string;
  weight: number;
}

interface HeadOffset {
  x: number; // pitch (nod)
  y: number; // yaw (turn)
  z: number; // roll (tilt)
}

/**
 * Emotion → VRM expression mapping with smooth interpolation.
 *
 * Two subsystems:
 * 1. Blend shapes — VRM expressionManager values (happy, sad, etc.)
 * 2. Head bone rotation — small euler offsets per emotion for readability
 *
 * HEAD BONE CONFLICT NOTE:
 * AnimationMixer writes bone rotations every frame. ExpressionController
 * adds offsets ON TOP of whatever the mixer wrote — it reads the current
 * bone rotation each frame and adds its delta, rather than setting an
 * absolute rotation from a stale base. This requires that ExpressionController
 * runs AFTER the AnimationMixer update in the render loop.
 * StateMachine.update() calls expressionCtrl.update() after animationCtrl.update()
 * to guarantee this ordering.
 */

const EMOTION_MAP: Record<Emotion, ExpressionTarget[]> = {
  idle:      [{ name: 'neutral', weight: 1.0 }],
  thinking:  [{ name: 'neutral', weight: 0.4 }, { name: 'lookUp', weight: 0.45 }],
  focused:   [{ name: 'neutral', weight: 0.8 }, { name: 'relaxed', weight: 0.3 }],
  excited:   [{ name: 'happy', weight: 1.0 }, { name: 'surprised', weight: 0.35 }],
  confused:  [{ name: 'surprised', weight: 0.65 }, { name: 'neutral', weight: 0.2 }],
  satisfied: [{ name: 'happy', weight: 0.75 }, { name: 'relaxed', weight: 0.5 }],
  concerned: [{ name: 'sad', weight: 0.65 }, { name: 'neutral', weight: 0.15 }],
};

/**
 * Head bone euler offsets per emotion (radians, small values).
 * Applied ADDITIVELY on top of the mixer's pose — not as absolute rotation.
 *
 * x = pitch (positive = nod down), y = yaw (positive = turn left), z = roll (positive = tilt right)
 */
const HEAD_OFFSET: Record<Emotion, HeadOffset> = {
  idle:      { x:  0.00,  y:  0.00,  z:  0.00 },
  thinking:  { x: -0.06,  y:  0.04,  z:  0.04 }, // head up + slight tilt
  focused:   { x:  0.04,  y:  0.00,  z:  0.00 }, // slight forward lean
  excited:   { x: -0.05,  y:  0.00,  z: -0.03 }, // head up, slight tilt
  confused:  { x:  0.02,  y:  0.00,  z:  0.07 }, // side tilt
  satisfied: { x:  0.02,  y:  0.00,  z: -0.02 }, // slight nod
  concerned: { x:  0.05,  y: -0.03,  z: -0.04 }, // head down + slight turn
};

/** Separate intensity scales for blend shapes and head movement (different sensitivities). */
const BLEND_INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.2,
};

const HEAD_INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.15,
};
export class ExpressionController {
  private vrm: VRM;
  private targetWeights = new Map<string, number>();
  private currentWeights = new Map<string, number>();
  private blendSpeed = 3.0;

  private headBone: THREE.Object3D | null = null;
  private headTargetOffset: HeadOffset = { x: 0, y: 0, z: 0 };
  private headCurrentOffset: HeadOffset = { x: 0, y: 0, z: 0 };
  private headBlendSpeed = 2.5;

  /**
   */

  constructor(vrm: VRM) {
    this.vrm = vrm;
    // getNormalizedBoneNode is the three-vrm v2+ API (VRM 0.x + 1.0 both supported).
    // Gracefully degrades — headBone stays null and head movement is skipped.
    this.headBone = vrm.humanoid?.getNormalizedBoneNode('head') ?? null;
  }

  /** Set the target emotion with optional intensity scaling. */
  setEmotion(emotion: Emotion, intensity: Intensity = 'medium'): void {
    const blendScale = BLEND_INTENSITY_SCALE[intensity];
    const headScale  = HEAD_INTENSITY_SCALE[intensity];

    const targets = EMOTION_MAP[emotion] ?? EMOTION_MAP.idle;
    this.targetWeights.clear();
    for (const target of targets) {
      this.targetWeights.set(target.name, Math.min(target.weight * blendScale, 1.0));
    }

    const offset = HEAD_OFFSET[emotion] ?? HEAD_OFFSET.idle;
    this.headTargetOffset = {
      x: offset.x * headScale,
      y: offset.y * headScale,
      z: offset.z * headScale,
    };
  }

  /**
   * Update blend shapes and head bone offset. Call every frame, AFTER
   * AnimationMixer.update() so the offset applies on top of the mixer's pose.
   */
  update(delta: number): void {

    this._updateBlendShapes(delta);
    this._updateHeadBone(delta);
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

  private _updateHeadBone(delta: number): void {
    if (!this.headBone) return;

    const decay = 1 - Math.exp(-this.headBlendSpeed * delta);

    // Lerp current offset toward target
    this.headCurrentOffset.x += (this.headTargetOffset.x - this.headCurrentOffset.x) * decay;
    this.headCurrentOffset.y += (this.headTargetOffset.y - this.headCurrentOffset.y) * decay;
    this.headCurrentOffset.z += (this.headTargetOffset.z - this.headCurrentOffset.z) * decay;
    // Apply ADDITIVELY on top of whatever the AnimationMixer wrote this frame.
    // StateMachine calls animationCtrl.update() before expressionCtrl.update()
    // so the mixer's bone values are already set when we add our delta here.
    this.headBone.rotation.x += this.headCurrentOffset.x;
    this.headBone.rotation.y += this.headCurrentOffset.y;
    this.headBone.rotation.z += this.headCurrentOffset.z;
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

    this.headTargetOffset  = { x: 0, y: 0, z: 0 };
    this.headCurrentOffset = { x: 0, y: 0, z: 0 };
    // No need to reset headBone.rotation — the mixer owns the base pose.
  }
}
