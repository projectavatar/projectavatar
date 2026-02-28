/**
 * Body part → VRM bone mapping.
 *
 * Used by the clip manager to:
 * 1. Filter animation tracks for isolated preview (bone masking)
 * 2. Display a toggleable body part picker in the clip detail editor
 *
 * Bone names match VRMHumanBoneName from @pixiv/three-vrm and the
 * keys used in mixamo-loader.ts's retarget map.
 *
 * hips is its own group because it carries root motion (position tracks)
 * that translate the entire character. Keeping it with torso causes the
 * model to float when legs are disabled.
 */

export const BODY_PARTS = ['head', 'torso', 'hips', 'arms', 'legs'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

/**
 * Which VRM bones belong to each body part group.
 */
export const BODY_PART_BONES: Record<BodyPart, readonly string[]> = {
  head: [
    'neck',
    'head',
  ],
  torso: [
    'spine',
    'chest',
    'upperChest',
  ],
  hips: [
    'hips',
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
 * Given a list of body parts, return the set of VRM bone names to animate.
 * Returns null when no masking is needed (all parts active or 'full').
 */
export function getBonesForParts(parts: string[]): Set<string> | null {
  if (parts.length === 0 || parts.includes('full')) return null;
  if (BODY_PARTS.every((bp) => parts.includes(bp))) return null;

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
 * Normalize body parts from clips.json format.
 * Converts 'full' or empty → all parts.
 */
export function normalizeBodyParts(parts: string[]): string[] {
  if (parts.includes('full') || parts.length === 0) {
    return [...BODY_PARTS];
  }
  return parts.filter((p) => (BODY_PARTS as readonly string[]).includes(p));
}

/**
 * Emoji/icon for each body part.
 */
export const BODY_PART_ICON: Record<BodyPart, string> = {
  head: '🗣️',
  torso: '👤',
  hips: '🦴',
  arms: '💪',
  legs: '🦵',
};

/**
 * Color for each body part.
 */
export const BODY_PART_COLOR: Record<BodyPart, string> = {
  head: '#e17055',
  torso: '#6c5ce7',
  hips: '#fd79a8',
  arms: '#00b894',
  legs: '#fdcb6e',
};
