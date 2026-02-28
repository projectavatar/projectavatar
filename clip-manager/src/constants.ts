/** UI presentation constants for body parts — clip-manager only. */
import type { BodyPart } from '@project-avatar/avatar-engine';

export const BODY_PART_ICON: Record<BodyPart, string> = {
  head: '🗣️',
  torso: '👤',
  arms: '💪',
  legs: '🦵',
};

export const BODY_PART_COLOR: Record<BodyPart, string> = {
  head: '#e17055',
  torso: '#6c5ce7',
  arms: '#00b894',
  legs: '#fdcb6e',
};
