/**
 * Transition Stabilizer — masks crossfade artifacts on feet, hips, and hands.
 *
 * Problem: Mixamo clips have different rest poses, so bones interpolate
 * through unnatural positions during crossfades. Most visible as foot
 * sliding, hip popping, and hand snapping.
 *
 * Solution (v2 — step arc):
 *   - Hips:  soft pin toward locked position (prevents vertical pop)
 *   - Hands: soft pin toward locked position (prevents gesture snap)
 *   - Feet:  procedural step arc — lifts feet proportional to horizontal
 *            drift, peaking mid-transition. Masks skating by making the
 *            foot movement look like a small weight-shift step.
 *
 * The step arc lets the mixer's X/Z interpolation happen naturally while
 * adding a Y lift that peaks at the midpoint of the transition. Small
 * drift = barely visible lift. Large drift = clear step.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StabilizedBone {
  bone: THREE.Object3D;
  refLength: number;
  maxCorrectionFrac: number;
}

interface BoneTarget {
  bone: StabilizedBone;
  position: THREE.Vector3;
}

interface FootTarget {
  bone: StabilizedBone;
  /** Foot position at lock time (start of transition). */
  startPosition: THREE.Vector3;
  /** Horizontal drift magnitude measured on first frame after lock. */
  horizontalDrift: number;
  /** Whether drift has been measured (needs one mixer frame). */
  driftMeasured: boolean;
}

interface GroupTiming {
  lockDuration: number;
  releaseDuration: number;
}

// ─── Tuning ───────────────────────────────────────────────────────────────────

const HIPS_TIMING:  GroupTiming = { lockDuration: 0.25, releaseDuration: 0.20 };
const HANDS_TIMING: GroupTiming = { lockDuration: 0.15, releaseDuration: 0.25 };

/** Total duration for foot step arc (lock + release combined). */
const FOOT_ARC_DURATION = 0.5;

/** Max step height as fraction of leg length. */
const MAX_STEP_HEIGHT_FRAC = 0.08;

/** Minimum horizontal drift (meters) before a step arc triggers. */
const MIN_DRIFT_FOR_STEP = 0.005;

/** Max total duration across all groups. */
const MAX_TOTAL = Math.max(
  HIPS_TIMING.lockDuration + HIPS_TIMING.releaseDuration,
  HANDS_TIMING.lockDuration + HANDS_TIMING.releaseDuration,
  FOOT_ARC_DURATION,
);

// ─── Reusable temporaries ─────────────────────────────────────────────────────

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Step arc: sin curve that peaks at t=0.5, returns 0 at t=0 and t=1.
 * Produces a natural lift-and-plant motion.
 */
function stepArc(t: number): number {
  return Math.sin(t * Math.PI);
}

// ─── TransitionStabilizer ─────────────────────────────────────────────────────

export class TransitionStabilizer {
  private vrm: VRM;
  private initialized = false;

  // Bone references
  private hipsBone: StabilizedBone | null = null;
  private leftFoot: StabilizedBone | null = null;
  private rightFoot: StabilizedBone | null = null;
  private leftHand: StabilizedBone | null = null;
  private rightHand: StabilizedBone | null = null;

  // Active targets — hips/hands use position pinning
  private hipsTarget: BoneTarget | null = null;
  private leftHandTarget: BoneTarget | null = null;
  private rightHandTarget: BoneTarget | null = null;

  // Feet use step arc
  private leftFootTarget: FootTarget | null = null;
  private rightFootTarget: FootTarget | null = null;

  private elapsed = 0;
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
    if (!this.initialized) return;

    this.hipsTarget = this._capture(this.hipsBone);
    this.leftHandTarget = this._capture(this.leftHand);
    this.rightHandTarget = this._capture(this.rightHand);

    // Feet: capture start position, drift measured on next frame
    this.leftFootTarget = this._captureFoot(this.leftFoot);
    this.rightFootTarget = this._captureFoot(this.rightFoot);

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

    // Hips + hands: soft pin (same as v1)
    const hipsBlend = getBlend(this.elapsed, HIPS_TIMING);
    const handsBlend = getBlend(this.elapsed, HANDS_TIMING);
    this._applyCorrection(this.hipsTarget, hipsBlend);
    this._applyCorrection(this.leftHandTarget, handsBlend);
    this._applyCorrection(this.rightHandTarget, handsBlend);

    // Feet: step arc
    this._applyFootArc(this.leftFootTarget);
    this._applyFootArc(this.rightFootTarget);

    // Single world matrix update after all corrections
    this.vrm.scene.updateMatrixWorld(false);
  }

  get isActive(): boolean { return this.active; }

  get blendFactor(): number {
    if (!this.active) return 0;
    return Math.max(
      getBlend(this.elapsed, HIPS_TIMING),
      getBlend(this.elapsed, HANDS_TIMING),
      this.elapsed < FOOT_ARC_DURATION ? 1 : 0,
    );
  }

  dispose(): void {
    this.active = false;
    this._clearTargets();
  }

  // ─── Private: bone setup ──────────────────────────────────────────────

  private _buildBones(): void {
    const h = this.vrm.humanoid;
    if (!h) {
      console.warn('[TransitionStabilizer] No humanoid — disabled');
      return;
    }

    this.vrm.scene.updateMatrixWorld(true);
    const getNode = (bone: string) => h.getNormalizedBoneNode(bone as any);

    const hips = getNode('hips');
    const spine = getNode('spine');
    if (hips && spine) {
      this.hipsBone = {
        bone: hips,
        refLength: boneLengthWorld(hips, spine) * 3,
        maxCorrectionFrac: 0.15,
      };
    }

    const lUpper = getNode('leftUpperLeg');
    const lLower = getNode('leftLowerLeg');
    const lFoot = getNode('leftFoot');
    if (lUpper && lLower && lFoot) {
      const legLen = boneLengthWorld(lUpper, lLower) + boneLengthWorld(lLower, lFoot);
      this.leftFoot = { bone: lFoot, refLength: legLen, maxCorrectionFrac: 0.25 };
    }

    const rUpper = getNode('rightUpperLeg');
    const rLower = getNode('rightLowerLeg');
    const rFoot = getNode('rightFoot');
    if (rUpper && rLower && rFoot) {
      const legLen = boneLengthWorld(rUpper, rLower) + boneLengthWorld(rLower, rFoot);
      this.rightFoot = { bone: rFoot, refLength: legLen, maxCorrectionFrac: 0.25 };
    }

    const lUpperArm = getNode('leftUpperArm');
    const lLowerArm = getNode('leftLowerArm');
    const lHand = getNode('leftHand');
    if (lUpperArm && lLowerArm && lHand) {
      const armLen = boneLengthWorld(lUpperArm, lLowerArm) + boneLengthWorld(lLowerArm, lHand);
      this.leftHand = { bone: lHand, refLength: armLen, maxCorrectionFrac: 0.20 };
    }

    const rUpperArm = getNode('rightUpperArm');
    const rLowerArm = getNode('rightLowerArm');
    const rHand = getNode('rightHand');
    if (rUpperArm && rLowerArm && rHand) {
      const armLen = boneLengthWorld(rUpperArm, rLowerArm) + boneLengthWorld(rLowerArm, rHand);
      this.rightHand = { bone: rHand, refLength: armLen, maxCorrectionFrac: 0.20 };
    }

    this.initialized = !!(
      this.hipsBone || this.leftFoot || this.rightFoot ||
      this.leftHand || this.rightHand
    );
  }

  // ─── Private: capture ─────────────────────────────────────────────────

  private _capture(bone: StabilizedBone | null): BoneTarget | null {
    if (!bone) return null;
    const pos = new THREE.Vector3();
    bone.bone.getWorldPosition(pos);
    return { bone, position: pos };
  }

  private _captureFoot(bone: StabilizedBone | null): FootTarget | null {
    if (!bone) return null;
    const pos = new THREE.Vector3();
    bone.bone.getWorldPosition(pos);
    return {
      bone,
      startPosition: pos,
      horizontalDrift: 0,
      driftMeasured: false,
    };
  }

  private _clearTargets(): void {
    this.hipsTarget = null;
    this.leftHandTarget = null;
    this.rightHandTarget = null;
    this.leftFootTarget = null;
    this.rightFootTarget = null;
  }

  // ─── Private: corrections ─────────────────────────────────────────────

  /**
   * Soft pin: nudge bone back toward locked position (hips + hands).
   */
  private _applyCorrection(target: BoneTarget | null, blend: number): void {
    if (!target || blend < 0.01) return;

    const { bone, position: lockedPos } = target;
    const obj = bone.bone;

    obj.getWorldPosition(_v3a);
    _v3b.subVectors(lockedPos, _v3a);
    const driftMag = _v3b.length();
    if (driftMag < 0.0005) return;

    const maxCorrection = bone.refLength * bone.maxCorrectionFrac;
    if (driftMag > maxCorrection) {
      _v3b.multiplyScalar(maxCorrection / driftMag);
    }
    _v3b.multiplyScalar(blend);

    this._addWorldOffsetToBone(obj, _v3b);
  }

  /**
   * Step arc: lift foot proportional to horizontal drift during crossfade.
   * Lets X/Z blend naturally from the mixer; adds Y lift in a sin arc.
   */
  private _applyFootArc(target: FootTarget | null): void {
    if (!target) return;
    if (this.elapsed >= FOOT_ARC_DURATION) return;

    const obj = target.bone.bone;

    // Measure drift on first frame after lock (mixer has blended one frame)
    if (!target.driftMeasured) {
      obj.getWorldPosition(_v3a);
      // Horizontal drift only (XZ plane)
      const dx = _v3a.x - target.startPosition.x;
      const dz = _v3a.z - target.startPosition.z;
      target.horizontalDrift = Math.sqrt(dx * dx + dz * dz);
      target.driftMeasured = true;
    }

    // Skip arc if drift is negligible
    if (target.horizontalDrift < MIN_DRIFT_FOR_STEP) return;

    // Arc height proportional to drift, capped by leg length
    const maxHeight = target.bone.refLength * MAX_STEP_HEIGHT_FRAC;
    const height = Math.min(target.horizontalDrift * 0.5, maxHeight);

    // Progress through arc (0→1 over FOOT_ARC_DURATION)
    const t = Math.min(this.elapsed / FOOT_ARC_DURATION, 1.0);
    const lift = stepArc(t) * height;

    // Apply Y offset (world up)
    _v3b.set(0, lift, 0);
    this._addWorldOffsetToBone(obj, _v3b);
  }

  /**
   * Convert a world-space offset to bone local space and apply.
   */
  private _addWorldOffsetToBone(obj: THREE.Object3D, worldOffset: THREE.Vector3): void {
    const parent = obj.parent;
    if (!parent) return;

    parent.getWorldQuaternion(_quat);
    _quat.invert();

    _v3c.copy(worldOffset).applyQuaternion(_quat);

    parent.getWorldScale(_scale);
    if (_scale.x !== 0) _v3c.x /= _scale.x;
    if (_scale.y !== 0) _v3c.y /= _scale.y;
    if (_scale.z !== 0) _v3c.z /= _scale.z;

    obj.position.add(_v3c);
  }
}
