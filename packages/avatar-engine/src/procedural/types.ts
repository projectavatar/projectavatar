/**
 * Type definitions for the procedural idle layer.
 *
 * Minimal types retained from the original procedural engine.
 * Only AnimBone and BoneState are still used — by the idle layer
 * and the animation controller's additive noise system.
 */

// ─── VRM Bone Names ───────────────────────────────────────────────────────────

/** Bones the idle layer can animate. Subset of VRM humanoid bones. */
export type AnimBone =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftUpperArm'
  | 'rightUpperArm'
  | 'leftLowerArm'
  | 'rightLowerArm'
  | 'leftHand'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'rightUpperLeg'
  | 'leftLowerLeg'
  | 'rightLowerLeg';

// ─── Engine State ─────────────────────────────────────────────────────────────

/** Per-bone accumulated rotation/position for one frame. */
export interface BoneState {
  rx: number;
  ry: number;
  rz: number;
  /** Position offsets (only used for hips). */
  px: number;
  py: number;
  pz: number;
}
