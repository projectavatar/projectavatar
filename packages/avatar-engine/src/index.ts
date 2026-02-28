// ─── Core ─────────────────────────────────────────────────────────────────────
export { AvatarScene } from './avatar-scene.ts';
export type { AvatarSceneOptions } from './avatar-scene.ts';

export { VrmManager } from './vrm-manager.ts';

export { AnimationController } from './animation-controller.ts';
export { LAYER_LABELS } from './animation-controller.ts';
export type { LayerState, ActiveClipInfo } from './animation-controller.ts';

export { ExpressionController } from './expression-controller.ts';
export { BlinkController } from './blink-controller.ts';
export { PropManager } from './prop-manager.ts';

export { ClipRegistry } from './clip-registry.ts';
export type { ClipEntry, ClipJson, ResolvedClips, ClipsJsonData } from './clip-registry.ts';

export { StateMachine } from './state-machine.ts';
export type { EventLogEntry } from './state-machine.ts';

export { loadMixamoAnimation } from './mixamo-loader.ts';

export { FootIK } from './foot-ik.ts';

// ─── Body parts ───────────────────────────────────────────────────────────────
export {
  BODY_PARTS,
  BODY_PART_BONES,
  ALL_BONES,
  getBonesForParts,
  normalizeBodyParts,
} from './body-parts.ts';
export type { BodyPart } from './body-parts.ts';

