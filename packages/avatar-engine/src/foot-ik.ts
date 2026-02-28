/**
 * Foot IK stabilizer — pins feet during animation transitions.
 *
 * Problem: Mixamo clips have different standing positions, so feet "teleport"
 * during crossfades between clips.
 *
 * Solution: On transition start, capture world positions of both feet.
 * During the crossfade window, apply positional correction to keep feet
 * pinned. Gradually release the constraint as the blend completes.
 *
 * Uses a "soft constraint" approach: after the mixer updates each frame,
 * measure how far each foot has drifted from the locked position, then
 * nudge it back proportionally. This plays nicely with crossfade blending
 * without fighting the mixer.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FootChain {
  upper: THREE.Object3D;   // upperLeg
  lower: THREE.Object3D;   // lowerLeg
  foot: THREE.Object3D;    // foot
  /** Rest-pose bone lengths (computed once). */
  upperLen: number;
  lowerLen: number;
}

interface FootTarget {
  position: THREE.Vector3;
  /** Blend factor: 1.0 = fully locked, 0.0 = fully released. */
  blend: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** How long (in seconds) to keep feet pinned during a transition. */
const LOCK_DURATION = 0.3;

/** Extra ease-out time after lock ends. */
const RELEASE_DURATION = 0.2;

/** Total IK active time per transition. */
const TOTAL_DURATION = LOCK_DURATION + RELEASE_DURATION;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();

/** Measure bone length between two Object3Ds in world space. */
function boneLengthWorld(a: THREE.Object3D, b: THREE.Object3D): number {
  a.getWorldPosition(_v3a);
  b.getWorldPosition(_v3b);
  return _v3a.distanceTo(_v3b);
}

// ─── FootIK class ─────────────────────────────────────────────────────────────

export class FootIK {
  private vrm: VRM;
  private leftChain: FootChain | null = null;
  private rightChain: FootChain | null = null;

  private leftTarget: FootTarget | null = null;
  private rightTarget: FootTarget | null = null;

  /** Time elapsed since last lock started. */
  private elapsed = 0;
  /** Whether a transition lock is currently active. */
  private active = false;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this._buildChains();
  }

  /**
   * Call when an animation transition starts.
   * Captures current foot world positions and starts the IK lock.
   */
  lock(): void {
    if (!this.leftChain || !this.rightChain) return;

    // Capture current foot positions in world space
    const leftPos = new THREE.Vector3();
    const rightPos = new THREE.Vector3();
    this.leftChain.foot.getWorldPosition(leftPos);
    this.rightChain.foot.getWorldPosition(rightPos);

    this.leftTarget = { position: leftPos, blend: 1.0 };
    this.rightTarget = { position: rightPos, blend: 1.0 };
    this.elapsed = 0;
    this.active = true;
  }

  /**
   * Call every frame AFTER the animation mixer has updated.
   * Applies positional correction to pin feet, then gradually releases.
   */
  update(delta: number): void {
    if (!this.active) return;
    if (!this.leftChain || !this.rightChain) return;
    if (!this.leftTarget || !this.rightTarget) return;

    this.elapsed += delta;

    if (this.elapsed >= TOTAL_DURATION) {
      this.active = false;
      this.leftTarget = null;
      this.rightTarget = null;
      return;
    }

    // Compute blend factor
    let blend: number;
    if (this.elapsed < LOCK_DURATION) {
      // Full lock phase
      blend = 1.0;
    } else {
      // Release phase: ease out
      const releaseT = (this.elapsed - LOCK_DURATION) / RELEASE_DURATION;
      blend = 1.0 - easeOutCubic(releaseT);
    }

    this.leftTarget.blend = blend;
    this.rightTarget.blend = blend;

    // Apply foot lock correction
    this._applyFootLock(this.leftChain, this.leftTarget);
    this._applyFootLock(this.rightChain, this.rightTarget);
  }

  /** Whether foot IK is currently active (for debug display). */
  get isActive(): boolean {
    return this.active;
  }

  /** Current blend factor (0–1). */
  get blendFactor(): number {
    if (!this.leftTarget) return 0;
    return this.leftTarget.blend;
  }

  dispose(): void {
    this.active = false;
    this.leftTarget = null;
    this.rightTarget = null;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private _buildChains(): void {
    const h = this.vrm.humanoid;
    if (!h) return;

    const getNode = (bone: string) => h.getNormalizedBoneNode(bone as any);

    const lUpper = getNode('leftUpperLeg');
    const lLower = getNode('leftLowerLeg');
    const lFoot = getNode('leftFoot');

    const rUpper = getNode('rightUpperLeg');
    const rLower = getNode('rightLowerLeg');
    const rFoot = getNode('rightFoot');

    if (lUpper && lLower && lFoot) {
      // Force a world matrix update so bone length measurement is accurate
      this.vrm.scene.updateMatrixWorld(true);
      this.leftChain = {
        upper: lUpper,
        lower: lLower,
        foot: lFoot,
        upperLen: boneLengthWorld(lUpper, lLower),
        lowerLen: boneLengthWorld(lLower, lFoot),
      };
    }

    if (rUpper && rLower && rFoot) {
      this.rightChain = {
        upper: rUpper,
        lower: rLower,
        foot: rFoot,
        upperLen: boneLengthWorld(rUpper, rLower),
        lowerLen: boneLengthWorld(rLower, rFoot),
      };
    }
  }

  /**
   * Soft constraint: measure how far the foot drifted from the locked
   * position, then nudge it back proportionally.
   *
   * Works by offsetting the foot bone's local position — plays nicely
   * with the mixer's crossfade rather than fighting it.
   */
  private _applyFootLock(chain: FootChain, target: FootTarget): void {
    if (target.blend < 0.01) return;

    // Get current foot world position (after mixer update)
    const currentPos = _v3a;
    chain.foot.getWorldPosition(currentPos);

    // Compute drift from locked position
    const drift = _v3b.subVectors(target.position, currentPos);
    const driftMag = drift.length();

    // If drift is negligible, skip
    if (driftMag < 0.0005) return;

    // Cap drift correction to prevent wild overshooting
    const maxCorrection = (chain.upperLen + chain.lowerLen) * 0.25;
    if (driftMag > maxCorrection) {
      drift.multiplyScalar(maxCorrection / driftMag);
    }

    // Scale by blend factor
    drift.multiplyScalar(target.blend);

    // Convert world-space offset to foot's local space
    const footParent = chain.foot.parent;
    if (!footParent) return;

    const parentWorldQuat = new THREE.Quaternion();
    footParent.getWorldQuaternion(parentWorldQuat);
    parentWorldQuat.invert();

    const localOffset = drift.clone().applyQuaternion(parentWorldQuat);

    // Account for parent's world scale
    const parentScale = new THREE.Vector3();
    footParent.getWorldScale(parentScale);
    if (parentScale.x !== 0) localOffset.x /= parentScale.x;
    if (parentScale.y !== 0) localOffset.y /= parentScale.y;
    if (parentScale.z !== 0) localOffset.z /= parentScale.z;

    chain.foot.position.add(localOffset);
    chain.foot.updateMatrixWorld(true);
  }
}

// ─── Easing ───────────────────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  const t1 = t - 1;
  return t1 * t1 * t1 + 1;
}
