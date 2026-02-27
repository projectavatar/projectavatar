import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Action, Intensity } from '@project-avatar/shared';
import { PROCEDURAL_ANIMATIONS } from './procedural-animations.ts';
import type { BonePose } from './procedural-animations.ts';

const INTENSITY_SPEED: Record<Intensity, number> = {
  low: 0.7,
  medium: 1.0,
  high: 1.3,
};

const IDENTITY = Object.freeze(new THREE.Quaternion());

interface BoneTransformCache {
  rawNode: THREE.Object3D;
  parentWorldRotation: THREE.Quaternion;
  invParentWorldRotation: THREE.Quaternion;
  boneRotation: THREE.Quaternion;
}

export class AnimationController {
  private vrm: VRM;
  private elapsed = 0;
  private currentAction: Action = 'waiting';
  private intensityMultiplier = 1.0;
  private fadeFromPose: BonePose = new Map();
  private fadeProgress = 1.0;
  private fadeDuration = 0.2;
  private touchedBones = new Set<VRMHumanBoneName>();
  private readonly _qResult = new THREE.Quaternion();
  private readonly _qWork = new THREE.Quaternion();
  private boneCache = new Map<VRMHumanBoneName, BoneTransformCache>();

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.buildBoneCache();
  }

  private buildBoneCache(): void {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;

    const rig = (humanoid as any)._normalizedHumanBones;
    if (!rig) return;

    const parentWorldRotations: Record<string, THREE.Quaternion> = rig._parentWorldRotations ?? {};
    const boneRotations: Record<string, THREE.Quaternion> = rig._boneRotations ?? {};

    const rawRig = (humanoid as any)._rawHumanBones;
    if (!rawRig) return;

    for (const [boneName, pwr] of Object.entries(parentWorldRotations)) {
      const rawNode = rawRig.getBoneNode(boneName as VRMHumanBoneName);
      const br = boneRotations[boneName];
      if (!rawNode || !pwr || !br) continue;

      this.boneCache.set(boneName as VRMHumanBoneName, {
        rawNode,
        parentWorldRotation: (pwr as THREE.Quaternion).clone(),
        invParentWorldRotation: (pwr as THREE.Quaternion).clone().invert(),
        boneRotation: (br as THREE.Quaternion).clone(),
      });
    }
  }

  playAction(action: Action, intensity: Intensity = 'medium'): void {
    if (action === this.currentAction && INTENSITY_SPEED[intensity] === this.intensityMultiplier) {
      return;
    }
    this.snapshotCurrentPose();
    this.currentAction = action;
    this.intensityMultiplier = INTENSITY_SPEED[intensity];
    this.fadeProgress = 0;
  }

  stopAll(): void {
    this.snapshotCurrentPose();
    this.currentAction = 'waiting';
    this.intensityMultiplier = 1.0;
    this.fadeProgress = 0;
  }

  update(delta: number): void {
    this.elapsed += delta;

    const animFn = PROCEDURAL_ANIMATIONS[this.currentAction];
    if (!animFn) return;

    const targetPose = animFn(this.elapsed, this.intensityMultiplier);

    if (this.fadeProgress < 1.0) {
      this.fadeProgress = Math.min(this.fadeProgress + delta / this.fadeDuration, 1.0);
    }

    const t = smoothstep(this.fadeProgress);

    const allBones = new Set<VRMHumanBoneName>([
      ...this.touchedBones,
      ...targetPose.keys(),
      ...this.fadeFromPose.keys(),
    ]);

    for (const boneName of allBones) {
      const targetQuat = targetPose.get(boneName) ?? IDENTITY;

      let normalizedQuat: THREE.Quaternion;
      if (this.fadeProgress >= 1.0) {
        normalizedQuat = targetQuat;
      } else {
        const fromQuat = this.fadeFromPose.get(boneName) ?? IDENTITY;
        this._qResult.slerpQuaternions(fromQuat, targetQuat, t);
        normalizedQuat = this._qResult;
      }

      this.applyToRawBone(boneName, normalizedQuat);
      this.touchedBones.add(boneName);
    }

    if (this.fadeProgress >= 1.0) {
      for (const boneName of this.touchedBones) {
        if (!targetPose.has(boneName)) {
          this.touchedBones.delete(boneName);
        }
      }
    }
  }

  private applyToRawBone(boneName: VRMHumanBoneName, normalizedQuat: THREE.Quaternion): void {
    const cache = this.boneCache.get(boneName);
    if (!cache) return;

    cache.rawNode.quaternion
      .copy(normalizedQuat)
      .multiply(cache.parentWorldRotation)
      .premultiply(cache.invParentWorldRotation)
      .multiply(cache.boneRotation);
  }

  dispose(): void {
    this.resetAllRawBones();
    this.touchedBones.clear();
    this.fadeFromPose.clear();
    this.boneCache.clear();
  }

  private resetAllRawBones(): void {
    for (const boneName of this.touchedBones) {
      const cache = this.boneCache.get(boneName);
      if (cache) {
        cache.rawNode.quaternion.copy(cache.boneRotation);
      }
    }
  }

  private snapshotCurrentPose(): void {
    this.fadeFromPose.clear();
    for (const boneName of this.touchedBones) {
      const cache = this.boneCache.get(boneName);
      if (!cache) continue;

      this._qWork
        .copy(cache.rawNode.quaternion)
        .multiply(this._qResult.copy(cache.boneRotation).invert())
        .premultiply(cache.parentWorldRotation)
        .multiply(cache.invParentWorldRotation);

      this.fadeFromPose.set(boneName, this._qWork.clone());
    }
  }
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}
