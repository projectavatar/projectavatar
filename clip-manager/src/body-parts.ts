/**
 * Body part → VRM bone mapping.
 *
 * Used by the clip manager to:
 * 1. Filter animation tracks for isolated preview (bone masking)
 * 2. Display a clickable body part picker in the clip detail editor
 *
 * Bone names match VRMHumanBoneName from @pixiv/three-vrm and the
 * keys used in mixamo-loader.ts's retarget map.
 */

export const BODY_PARTS = ['head', 'torso', 'arms', 'legs'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

/**
 * Which VRM bones belong to each body part group.
 * 'full' is not listed — it means all bones (no masking).
 */
export const BODY_PART_BONES: Record<BodyPart, readonly string[]> = {
  head: [
    'neck',
    'head',
  ],
  torso: [
    'hips',
    'spine',
    'chest',
    'upperChest',
  ],
  arms: [
    'leftShoulder',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'rightShoulder',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
  ],
  legs: [
    'leftUpperLeg',
    'leftLowerLeg',
    'leftFoot',
    'leftToes',
    'rightUpperLeg',
    'rightLowerLeg',
    'rightFoot',
    'rightToes',
  ],
};

/** All bone names across all body parts. */
export const ALL_BONES = Object.values(BODY_PART_BONES).flat();

/**
 * Given a list of body parts (e.g. ['arms', 'head']), return
 * the set of VRM bone names those parts cover.
 * If parts includes 'full' or is empty, returns null (no masking).
 */
export function getBonesForParts(parts: string[]): Set<string> | null {
  if (parts.length === 0 || parts.includes('full')) return null;

  const bones = new Set<string>();
  for (const part of parts) {
    const partBones = BODY_PART_BONES[part as BodyPart];
    if (partBones) {
      for (const bone of partBones) bones.add(bone);
    }
  }
  return bones.size > 0 ? bones : null;
}

/**
 * Emoji/icon for each body part (used in UI chips).
 */
export const BODY_PART_ICON: Record<BodyPart | 'full', string> = {
  head: '🗣️',
  torso: '👤',
  arms: '💪',
  legs: '🦵',
  full: '🧍',
};

/**
 * Color for each body part (used for visual distinction in UI).
 */
export const BODY_PART_COLOR: Record<BodyPart | 'full', string> = {
  head: '#e17055',
  torso: '#6c5ce7',
  arms: '#00b894',
  legs: '#fdcb6e',
  full: '#74b9ff',
};
