// ─── Core ─────────────────────────────────────────────────────────────────────
export { AvatarScene } from './avatar-scene.ts';
export type { AvatarSceneOptions } from './avatar-scene.ts';

export { VrmManager } from './vrm-manager.ts';

export { AnimationController } from './animation-controller.ts';
export type { LayerState, ActiveClipInfo } from './animation-controller.ts';

export { ExpressionController } from './expression-controller.ts';
export { BlinkController } from './blink-controller.ts';
export { PropManager } from './prop-manager.ts';

export { ClipRegistry } from './clip-registry.ts';
export type { ClipEntry, ResolvedClips, ClipsJsonData } from './clip-registry.ts';

export { StateMachine } from './state-machine.ts';
export type { EventLogEntry } from './state-machine.ts';

export { loadMixamoAnimation } from './mixamo-loader.ts';

// ─── Body parts ───────────────────────────────────────────────────────────────
export {
  BODY_PARTS,
  BODY_PART_BONES,
  ALL_BONES,
  getBonesForParts,
  normalizeBodyParts,
  BODY_PART_ICON,
  BODY_PART_COLOR,
} from './body-parts.ts';
export type { BodyPart } from './body-parts.ts';

// ─── Procedural ───────────────────────────────────────────────────────────────
export { evaluateIdleLayer } from './procedural/idle-layer.ts';
export { noise1D } from './procedural/noise.ts';
export type { AnimBone, BoneState } from './procedural/types.ts';
