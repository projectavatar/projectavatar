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
export type { ClipEntry, ClipJson, ResolvedClips, ClipsJsonData, AnimationGroupJson } from './clip-registry.ts';

export { StateMachine } from './state-machine.ts';
export type { EventLogEntry } from './state-machine.ts';

export { loadMixamoAnimation } from './mixamo-loader.ts';
export { loadVRMAAnimation } from './vrma-loader.ts';

// ─── Idle layer ───────────────────────────────────────────────────────────────
export { IdleLayer } from './idle-layer.ts';
export type { IdleMode, HandGesture } from './idle-layer.ts';

// ─── Body parts ───────────────────────────────────────────────────────────────
export {
  BODY_PARTS,
  BODY_PART_BONES,
  ALL_BONES,
  getBonesForParts,
  normalizeBodyParts,
} from './body-parts.ts';
export type { BodyPart } from './body-parts.ts';


// ─── Effects ──────────────────────────────────────────────────────────────────
export { EffectsManager, DEFAULT_EFFECTS_STATE, EFFECT_LABELS, EFFECT_DESCRIPTIONS } from './effects/index.ts';
export type { EffectsState } from './effects/index.ts';
