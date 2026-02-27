/**
 * Base standing pose — extracted from Mixamo "Standing Idle" frame 0.
 *
 * VRM models load in T-pose. This defines the rotation offsets from T-pose
 * to a natural standing position, derived from the retargeted frame 0 of
 * Mixamo's standing-idle.fbx clip.
 *
 * Values are for VRM **normalized** bones (identity rest orientation).
 * No VRM 0.x axis flip — normalized bones are version-agnostic.
 *
 * Re-extracted with corrected pipeline (no X/Z negate).
 */
import type { AnimBone } from './types.ts';

interface BonePose {
  x: number;
  y: number;
  z: number;
}

/**
 * Retargeted frame 0 of Mixamo "Standing Idle" in VRM normalized bone space.
 */
export const BASE_POSE: Partial<Record<AnimBone, BonePose>> = {
  hips:              { x: -0.0655, y: -0.0911, z: -0.0656 },
  spine:             { x:  0.0575, y:  0.0269, z:  0.0477 },
  chest:             { x:  0.0201, y:  0.0059, z:  0.0271 },
  upperChest:        { x:  0.0197, y:  0.0063, z:  0.0272 },
  neck:              { x:  0.0982, y: -0.0014, z:  0.0079 },
  head:              { x: -0.1320, y:  0.0240, z: -0.0014 },
  leftShoulder:      { x:  0.0183, y: -0.3044, z: -0.2150 },
  leftUpperArm:      { x:  0.0684, y: -0.3489, z: -1.2176 },
  leftHand:          { x: -0.5800, y: -0.0238, z: -0.1080 },
  rightShoulder:     { x:  0.0210, y:  0.2678, z:  0.2567 },
  rightUpperArm:     { x:  0.2297, y:  0.4809, z:  1.0260 },
  rightHand:         { x: -0.3522, y: -0.0090, z:  0.1184 },
  leftUpperLeg:      { x: -0.1883, y:  0.2572, z:  0.1805 },
  leftLowerLeg:      { x:  0.2124, y:  0.0355, z:  0.0728 },
  rightUpperLeg:     { x:  0.0105, y: -0.1814, z:  0.0610 },
  rightLowerLeg:     { x:  0.1294, y: -0.1700, z: -0.0572 },
};
