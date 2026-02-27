/**
 * Base standing pose — extracted from Mixamo "Standing Idle" frame 0.
 *
 * VRM models load in T-pose. This defines the rotation offsets from T-pose
 * to a natural standing position, derived from the retargeted frame 0 of
 * Mixamo's standing-idle.fbx clip.
 *
 * Values were extracted by loading the FBX, retargeting quaternions through
 * the same pipeline as mixamo-loader.ts (parent world rotation, rest inverse,
 * VRM 0.x axis flip), then converting to euler angles.
 *
 * The engine applies these BEFORE any idle layer or recipe evaluation.
 * Everything else is additive on top of this base.
 */
import type { AnimBone } from './types.ts';

interface BonePose {
  x: number;
  y: number;
  z: number;
}

/**
 * Retargeted frame 0 of Mixamo "Standing Idle" in VRM 0.x space.
 * These are the exact euler rotations the old mixer-based system applied.
 */
export const BASE_POSE: Partial<Record<AnimBone, BonePose>> = {
  hips:           { x:  0.0655, y: -0.0911, z:  0.0656 },
  spine:          { x: -0.0575, y:  0.0269, z: -0.0477 },
  chest:          { x: -0.0201, y:  0.0059, z: -0.0271 },
  upperChest:     { x: -0.0197, y:  0.0063, z: -0.0272 },
  neck:           { x: -0.0982, y: -0.0014, z: -0.0079 },
  head:           { x:  0.1320, y:  0.0240, z:  0.0014 },
  rightShoulder:  { x: -0.0210, y:  0.2678, z: -0.2567 },
  rightUpperArm:  { x: -0.2297, y:  0.4809, z: -1.0260 },
  rightLowerArm:  { x:  0.0000, y:  0.1168, z: -0.0000 },
  rightHand:      { x:  0.3522, y: -0.0090, z: -0.1184 },
  leftShoulder:   { x: -0.0183, y: -0.3044, z:  0.2150 },
  leftUpperArm:   { x: -0.0684, y: -0.3489, z:  1.2176 },
  leftLowerArm:   { x:  0.0000, y: -0.0255, z: -0.0000 },
  leftHand:       { x:  0.5800, y: -0.0238, z:  0.1080 },
  rightUpperLeg:  { x: -0.0105, y: -0.1814, z: -0.0610 },
  rightLowerLeg:  { x: -0.1294, y: -0.1700, z:  0.0572 },
  leftUpperLeg:   { x:  0.1883, y:  0.2572, z: -0.1805 },
  leftLowerLeg:   { x: -0.2124, y:  0.0355, z: -0.0728 },
};
