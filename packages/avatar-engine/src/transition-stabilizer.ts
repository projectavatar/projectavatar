/**
 * Transition Stabilizer — pins key bones during animation transitions.
 *
 * Problem: Mixamo clips have different rest poses, so bones "teleport"
 * during crossfades. Most visible on feet (sliding), hips (popping),
 * and hands (snapping between gesture positions).
 *
 * Solution: On transition start, capture world positions of key bones.
 * Each frame after the mixer updates, measure drift and nudge bones back
 * toward their locked positions. Gradually release via cubic ease-out so
 * the new clip takes over smoothly.
 *
 * Stabilized bones (4 groups, each tunable):
 *   - Hips:  root of the skeleton — prevents vertical pop
 *   - Feet:  left/right foot — prevents ground sliding
 *   - Hands: left/right hand — prevents gesture snapping
 *
 * Each group has independent max-correction and lock/release timing
 * because they have different tolerances:
 *   - Feet need tight locking (grounded, very visible)
 *   - Hips need moderate locking (vertical pop is obvious)
 *   - Hands need looser locking (usually in motion, less noticeable)
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single bone being stabilized. */
interface StabilizedBone {
  bone: THREE.Object3D;
  /** Reference length for max-correction scaling (e.g. leg chain length). */
  refLength: number;
  /** Max correction as fraction of refLength. */
  maxCorrectionFrac: number;
}

/** Captured target for a bone during a transition. */
interface BoneTarget {
  bone: StabilizedBone;
  position: THREE.Vector3;
}

/** Timing config per bone group. */
interface GroupTiming {
  /** How long (seconds) to hold bones at full lock. */
  lockDuration: number;
  /** How long (seconds) to ease-out after lock ends. */
  releaseDuration: number;
}

// ─── Per-group timing ─────────────────────────────────────────────────────────

const HIPS_TIMING:  GroupTiming = { lockDuration: 0.25, releaseDuration: 0.20 };
const FEET_TIMING:  GroupTiming = { lockDuration: 0.30, releaseDuration: 0.20 };
const HANDS_TIMING: GroupTiming = { lockDuration: 0.15, releaseDuration: 0.25 };

/** Max total duration across all groups (for the active flag). */
const MAX_TOTAL = Math.max(
  HIPS_TIMING.lockDuration + HIPS_TIMING.releaseDuration,
  FEET_TIMING.lockDuration + FEET_TIMING.releaseDuration,
  HANDS_TIMING.lockDuration + HANDS_TIMING.releaseDuration,
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();

function boneLengthWorld(a: THREE.Object3D, b: THREE.Object3D): number {
  a.getWorldPosition(_v3a);
  b.getWorldPosition(_v3b);
  return _v3a.distanceTo(_v3b);
}

function getBlend(elapsed: number, timing: GroupTiming): number {
  const total = timing.lockDuration + timing.releaseDuration;
  if (elapsed >= total) return 0;
  if (elapsed < timing.lockDuration) return 1.0;
  const releaseT = (elapsed - timing.lockDuration) / timing.releaseDuration;
  return 1.0 - easeOutCubic(releaseT);
}

function easeOutCubic(t: number): number {
  const t1 = t - 1;
  return t1 * t1 * t1 + 1;
}

// ─── TransitionStabilizer ─────────────────────────────────────────────────────

/**
 * Stabilizes hips, feet, and hands during animation transitions.
 * Internally stabilizes hips, feet, and hands.
 */
export class TransitionStabilizer {
  private vrm: VRM;

  // ─── Bone references ──────────────────────────────────────────────────

  private hipsBone: StabilizedBone | null = null;
  private leftFoot: StabilizedBone | null = null;
  private rightFoot: StabilizedBone | null = null;
  private leftHand: StabilizedBone | null = null;
  private rightHand: StabilizedBone | null = null;

  // ─── Active targets ───────────────────────────────────────────────────

  private hipsTarget: BoneTarget | null = null;
  private leftFootTarget: BoneTarget | null = null;
  private rightFootTarget: BoneTarget | null = null;
  private leftHandTarget: BoneTarget | null = null;
  private rightHandTarget: BoneTarget | null = null;

  /** Time elapsed since last lock started. */
  private elapsed = 0;
  /** Whether a transition lock is currently active. */
  private active = false;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this._buildBones();
  }

  /**
   * Call when an animation transition starts.
   * Captures current world positions of all stabilized bones.
   */
  lock(): void {
    // Capture positions
    this.hipsTarget = this._capture(this.hipsBone);
    this.leftFootTarget = this._capture(this.leftFoot);
    this.rightFootTarget = this._capture(this.rightFoot);
    this.leftHandTarget = this._capture(this.leftHand);
    this.rightHandTarget = this._capture(this.rightHand);

    this.elapsed = 0;
    this.active = true;
  }

  /**
   * Call every frame AFTER the animation mixer has updated.
   */
  update(delta: number): void {
    if (!this.active) return;

    this.elapsed += delta;

    if (this.elapsed >= MAX_TOTAL) {
      this.active = false;
      this._clearTargets();
      return;
    }

    // Apply corrections per group with independent timing
    const hipsBlend = getBlend(this.elapsed, HIPS_TIMING);
    const feetBlend = getBlend(this.elapsed, FEET_TIMING);
    const handsBlend = getBlend(this.elapsed, HANDS_TIMING);

    this._applyCorrection(this.hipsTarget, hipsBlend);
    this._applyCorrection(this.leftFootTarget, feetBlend);
    this._applyCorrection(this.rightFootTarget, feetBlend);
    this._applyCorrection(this.leftHandTarget, handsBlend);
    this._applyCorrection(this.rightHandTarget, handsBlend);
  }

  /** Whether stabilizer is currently active (for debug display). */
  get isActive(): boolean {
    return this.active;
  }

  /** Current max blend factor across all groups (0–1). */
  get blendFactor(): number {
    if (!this.active) return 0;
    return Math.max(
      getBlend(this.elapsed, HIPS_TIMING),
      getBlend(this.elapsed, FEET_TIMING),
      getBlend(this.elapsed, HANDS_TIMING),
    );
  }

  dispose(): void {
    this.active = false;
    this._clearTargets();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private _buildBones(): void {
    const h = this.vrm.humanoid;
    if (!h) return;

    this.vrm.scene.updateMatrixWorld(true);
    const getNode = (bone: string) => h.getNormalizedBoneNode(bone as any);

    // Hips — use spine length as reference
    const hips = getNode('hips');
    const spine = getNode('spine');
    if (hips && spine) {
      this.hipsBone = {
        bone: hips,
        refLength: boneLengthWorld(hips, spine) * 3, // rough torso height
        maxCorrectionFrac: 0.15,
      };
    }

    // Left leg chain → foot
    const lUpper = getNode('leftUpperLeg');
    const lLower = getNode('leftLowerLeg');
    const lFoot = getNode('leftFoot');
    if (lUpper && lLower && lFoot) {
      const legLen = boneLengthWorld(lUpper, lLower) + boneLengthWorld(lLower, lFoot);
      this.leftFoot = {
        bone: lFoot,
        refLength: legLen,
        maxCorrectionFrac: 0.25,
      };
    }

    // Right leg chain → foot
    const rUpper = getNode('rightUpperLeg');
    const rLower = getNode('rightLowerLeg');
    const rFoot = getNode('rightFoot');
    if (rUpper && rLower && rFoot) {
      const legLen = boneLengthWorld(rUpper, rLower) + boneLengthWorld(rLower, rFoot);
      this.rightFoot = {
        bone: rFoot,
        refLength: legLen,
        maxCorrectionFrac: 0.25,
      };
    }

    // Left arm chain → hand
    const lUpperArm = getNode('leftUpperArm');
    const lLowerArm = getNode('leftLowerArm');
    const lHand = getNode('leftHand');
    if (lUpperArm && lLowerArm && lHand) {
      const armLen = boneLengthWorld(lUpperArm, lLowerArm) + boneLengthWorld(lLowerArm, lHand);
      this.leftHand = {
        bone: lHand,
        refLength: armLen,
        maxCorrectionFrac: 0.20,
      };
    }

    // Right arm chain → hand
    const rUpperArm = getNode('rightUpperArm');
    const rLowerArm = getNode('rightLowerArm');
    const rHand = getNode('rightHand');
    if (rUpperArm && rLowerArm && rHand) {
      const armLen = boneLengthWorld(rUpperArm, rLowerArm) + boneLengthWorld(rLowerArm, rHand);
      this.rightHand = {
        bone: rHand,
        refLength: armLen,
        maxCorrectionFrac: 0.20,
      };
    }
  }

  private _capture(bone: StabilizedBone | null): BoneTarget | null {
    if (!bone) return null;
    const pos = new THREE.Vector3();
    bone.bone.getWorldPosition(pos);
    return { bone, position: pos };
  }

  private _clearTargets(): void {
    this.hipsTarget = null;
    this.leftFootTarget = null;
    this.rightFootTarget = null;
    this.leftHandTarget = null;
    this.rightHandTarget = null;
  }

  /**
   * Soft constraint: measure drift from locked position and nudge back.
   */
  private _applyCorrection(target: BoneTarget | null, blend: number): void {
    if (!target || blend < 0.01) return;

    const { bone, position: lockedPos } = target;
    const obj = bone.bone;

    // Current world position after mixer update
    obj.getWorldPosition(_v3a);

    // Drift vector: locked - current
    _v3b.subVectors(lockedPos, _v3a);
    const driftMag = _v3b.length();

    if (driftMag < 0.0005) return;

    // Cap correction
    const maxCorrection = bone.refLength * bone.maxCorrectionFrac;
    if (driftMag > maxCorrection) {
      _v3b.multiplyScalar(maxCorrection / driftMag);
    }

    // Scale by blend
    _v3b.multiplyScalar(blend);

    // Convert world offset to bone's local space
    const parent = obj.parent;
    if (!parent) return;

    const parentQuat = new THREE.Quaternion();
    parent.getWorldQuaternion(parentQuat);
    parentQuat.invert();

    const localOffset = _v3b.clone().applyQuaternion(parentQuat);

    // Account for parent's world scale
    const parentScale = new THREE.Vector3();
    parent.getWorldScale(parentScale);
    if (parentScale.x !== 0) localOffset.x /= parentScale.x;
    if (parentScale.y !== 0) localOffset.y /= parentScale.y;
    if (parentScale.z !== 0) localOffset.z /= parentScale.z;

    obj.position.add(localOffset);
    obj.updateMatrixWorld(true);
  }
}
