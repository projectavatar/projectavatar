/**
 * Body part → VRM bone mapping.
 *
 * 4 groups: head, torso, arms, legs.
 * legs includes hips — disabling legs also kills root motion,
 * preventing the model from floating.
 */

export const BODY_PARTS = ['head', 'torso', 'arms', 'legs'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const BODY_PART_BONES: Record<BodyPart, readonly string[]> = {
  head: ['neck', 'head'],
  torso: ['spine', 'chest', 'upperChest'],
  arms: [
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  ],
  legs: [
    'hips',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  ],
};

export const ALL_BONES = Object.values(BODY_PART_BONES).flat();

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

export function normalizeBodyParts(parts: string[]): string[] {
  if (parts.includes('full') || parts.length === 0) return [...BODY_PARTS];

  const known: string[] = [];
  for (const p of parts) {
    if ((BODY_PARTS as readonly string[]).includes(p)) {
      known.push(p);
    } else {
      console.warn(`[body-parts] Unknown body part "${p}" — ignored`);
    }
  }
  return known.length > 0 ? known : [...BODY_PARTS];
}

