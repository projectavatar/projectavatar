import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Action, Intensity } from '@project-avatar/shared';
import { PROCEDURAL_ANIMATIONS } from './procedural-animations.ts';
import type { BonePose } from './procedural-animations.ts';

/**
 * Procedural animation controller for VRM avatars.
 *
 * Instead of playing pre-authored AnimationClip GLBs, this controller
 * generates bone rotations procedurally each frame using sine/cosine wave
 * functions. Animations are defined in procedural-animations.ts.
 *
 * Features:
 * - Smooth crossfade between actions (quaternion slerp over fadeDuration)
 * - Intensity scaling (low: 0.7x, medium: 1.0x, high: 1.3x speed+amplitude)
 * - Frame-rate independent (all calculations use delta time)
 * - Model-agnostic (works on any VRM with a humanoid skeleton)
 */

const INTENSITY_SPEED: Record<Intensity, number> = {
  low: 0.7,
  medium: 1.0,
  high: 1.3,
};

/** Identity quaternion — represents "no rotation offset from rest pose". */
const IDENTITY = Object.freeze(new THREE.Quaternion());

export class AnimationController {
  private vrm: VRM;

  /** Elapsed time in seconds — drives procedural wave functions. */
  private elapsed = 0;

  /** Current action being animated. */
  private currentAction: Action = 'waiting';
  /** Intensity multiplier for speed and amplitude. */
  private intensityMultiplier = 1.0;

  /**
   * Crossfade state.
   *
   * When an action changes, we snapshot the current applied pose as `fadeFromPose`,
   * set `fadeProgress` to 0, and slerp from fadeFromPose → new action pose over
   * `fadeDuration` seconds.
   */
  private fadeFromPose: BonePose = new Map();
  private fadeProgress = 1.0; // 1.0 = fully transitioned, no fade active
  private fadeDuration = 0.5; // seconds

  /**
   * Set of all bone names we've ever touched.
   * Needed to reset bones back to identity when they're no longer
   * part of the active animation's pose.
   */
  private touchedBones = new Set<VRMHumanBoneName>();

  /** Reusable quaternion for slerp — avoids GC pressure in the hot path. */
  private readonly _qResult = new THREE.Quaternion();

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  /**
   * Start playing a procedural animation for the given action.
   * Crossfades smoothly from the current pose.
   */
  playAction(action: Action, intensity: Intensity = 'medium'): void {
    if (action === this.currentAction && INTENSITY_SPEED[intensity] === this.intensityMultiplier) {
      return; // same action + intensity — nothing to do
    }

    // Snapshot the current applied pose for crossfade
    this.snapshotCurrentPose();

    this.currentAction = action;
    this.intensityMultiplier = INTENSITY_SPEED[intensity];
    this.fadeProgress = 0;

    // Reset elapsed time so the new animation starts from t=0.
    // Prevents jarring mid-wave starts when switching actions.
    this.elapsed = 0;
  }

  /** Stop all animations and crossfade back to idle/waiting. */
  stopAll(): void {
    this.snapshotCurrentPose();
    this.currentAction = 'waiting';
    this.intensityMultiplier = 1.0;
    this.fadeProgress = 0;
    this.elapsed = 0;
  }

  /**
   * Update procedural animations. Call every frame with delta time in seconds.
   *
   * Hot path — called 60+ times per second. The controller reuses quaternion
   * objects for slerp. Animation functions allocate per-bone quaternions each
   * frame (deliberate readability trade-off in animation definitions).
   */
  update(delta: number): void {
    this.elapsed += delta;

    const animFn = PROCEDURAL_ANIMATIONS[this.currentAction];
    if (!animFn) return;

    // Compute the target pose for this frame
    const targetPose = animFn(this.elapsed, this.intensityMultiplier);

    // Advance crossfade
    if (this.fadeProgress < 1.0) {
      this.fadeProgress = Math.min(this.fadeProgress + delta / this.fadeDuration, 1.0);
    }

    // Smoothstep easing for perceptually natural crossfade
    const t = smoothstep(this.fadeProgress);

    // Union of all bones: currently touched + target pose + fade source
    const allBones = new Set<VRMHumanBoneName>([
      ...this.touchedBones,
      ...targetPose.keys(),
      ...this.fadeFromPose.keys(),
    ]);

    for (const boneName of allBones) {
      const boneNode = this.vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (!boneNode) continue;

      // Target rotation (identity if this bone isn't in the new pose)
      const targetQuat = targetPose.get(boneName) ?? IDENTITY;

      let finalQuat: THREE.Quaternion;

      if (this.fadeProgress >= 1.0) {
        // Fade complete — apply target directly
        finalQuat = targetQuat;
      } else {
        // Crossfading: slerp from old pose → new pose
        const fromQuat = this.fadeFromPose.get(boneName) ?? IDENTITY;
        this._qResult.slerpQuaternions(fromQuat, targetQuat, t);
        finalQuat = this._qResult;
      }

      boneNode.quaternion.copy(finalQuat);
      this.touchedBones.add(boneName);
    }

    // Housekeeping: once fade is complete, reset bones no longer in the target
    // pose back to identity and stop tracking them
    if (this.fadeProgress >= 1.0) {
      for (const boneName of this.touchedBones) {
        if (!targetPose.has(boneName)) {
          const boneNode = this.vrm.humanoid?.getNormalizedBoneNode(boneName);
          if (boneNode) {
            boneNode.quaternion.copy(IDENTITY);
          }
          this.touchedBones.delete(boneName);
        }
      }
    }
  }

  dispose(): void {
    // Return all touched bones to rest pose
    for (const boneName of this.touchedBones) {
      const boneNode = this.vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (boneNode) {
        boneNode.quaternion.copy(IDENTITY);
      }
    }
    this.touchedBones.clear();
    this.fadeFromPose.clear();
  }

  /**
   * Snapshot the current bone quaternions into fadeFromPose.
   * Captures the exact visual state at the moment of transition.
   */
  private snapshotCurrentPose(): void {
    this.fadeFromPose.clear();

    for (const boneName of this.touchedBones) {
      const boneNode = this.vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (boneNode) {
        this.fadeFromPose.set(boneName, boneNode.quaternion.clone());
      }
    }
  }
}

/**
 * Smoothstep: f(0)=0, f(1)=1, f'(0)=0, f'(1)=0.
 * Perceptually smoother than linear interpolation for crossfades.
 */
function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}
