/**
 * Base standing pose — the natural resting position for a VRM avatar.
 *
 * VRM models load in T-pose (arms straight out, legs straight).
 * This defines the rotation offsets from T-pose to a natural standing
 * position: arms relaxed at sides, slight elbow bend, natural stance.
 *
 * The engine applies these BEFORE any idle layer or recipe evaluation.
 * Everything else is additive on top of this base.
 *
 * Values are in radians, applied to the VRM normalized bone rotations.
 * Coordinate system (VRM 0.x normalized):
 *   x = pitch (positive = forward/down)
 *   y = yaw (positive = inward rotation)
 *   z = roll (positive = toward body for right side, away for left)
 */
import type { AnimBone } from './types.ts';

interface BonePose {
  x: number;
  y: number;
  z: number;
}

/**
 * Offsets from T-pose to natural standing pose.
 * Only bones that need adjustment are listed — unlisted bones stay at T-pose (0,0,0).
 */
export const BASE_POSE: Partial<Record<AnimBone, BonePose>> = {
  // ── Arms ──
  // Bring arms down from T-pose to relaxed at sides
  // In VRM normalized space, positive Z on right side = adduct (toward body)
  rightUpperArm: { x: 0.05, y: 0, z: 1.1 },     // arm down ~63°, slight forward
  leftUpperArm:  { x: 0.05, y: 0, z: -1.1 },     // mirrored

  // Slight natural bend in elbows (arms not perfectly straight)
  rightLowerArm: { x: -0.15, y: 0, z: 0 },       // slight bend
  leftLowerArm:  { x: -0.15, y: 0, z: 0 },       // mirrored

  // Hands relaxed, slightly curled inward
  rightHand: { x: 0.05, y: 0, z: 0.08 },
  leftHand:  { x: 0.05, y: 0, z: -0.08 },

  // ── Shoulders ──
  // Slight natural droop (not military-straight)
  rightShoulder: { x: 0, y: 0, z: 0.03 },
  leftShoulder:  { x: 0, y: 0, z: -0.03 },

  // ── Spine ──
  // Very slight S-curve — not ramrod straight
  spine:      { x: -0.02, y: 0, z: 0 },          // tiny lordosis
  chest:      { x: 0.01, y: 0, z: 0 },            // slight kyphosis compensation
  upperChest: { x: -0.01, y: 0, z: 0 },

  // ── Neck / Head ──
  // Natural slight forward tilt
  neck: { x: 0.03, y: 0, z: 0 },
  head: { x: -0.02, y: 0, z: 0 },                // compensate so eyes are level

  // ── Hips ──
  // Centered, no offset needed
  hips: { x: 0, y: 0, z: 0 },

  // ── Legs ──
  // Very slight outward rotation + knee micro-bend for natural stance
  rightUpperLeg: { x: 0.02, y: 0, z: 0.02 },
  leftUpperLeg:  { x: 0.02, y: 0, z: -0.02 },
  rightLowerLeg: { x: 0.03, y: 0, z: 0 },        // micro knee bend (not locked)
  leftLowerLeg:  { x: 0.03, y: 0, z: 0 },
};
