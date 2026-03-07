// ─── Core ─────────────────────────────────────────────────────────────────────
export { AvatarScene } from './avatar-scene.ts';
export type { AvatarSceneOptions } from './avatar-scene.ts';

export { VrmManager } from './vrm-manager.ts';

export { AssetResolver } from './asset-resolver.ts';
export type { AssetCache, AssetResolverOptions } from './asset-resolver.ts';

export { AnimationController } from './animation-controller.ts';
export { LAYER_LABELS } from './animation-controller.ts';
export type { LayerState, ActiveClipInfo } from './animation-controller.ts';

export { ExpressionController } from './expression-controller.ts';
export { resolveBlend, createNeutralBlend, EmotionDecay, NEUTRAL_WEIGHTS, EMOTION_COLORS, ENERGY_COEFFICIENTS } from './emotion-blend.ts';
export type { ResolvedBlend } from './emotion-blend.ts';
export { BlinkController } from './blink-controller.ts';
export { PropManager } from './prop-manager.ts';

export { ClipRegistry } from './clip-registry.ts';
export type { ClipEntry, ClipJson, ResolvedClips, ClipsJsonData, AnimationGroupJson, PropTransform, ClipPropBinding } from './clip-registry.ts';

export { StateMachine } from './state-machine.ts';
export type { EventLogEntry } from './state-machine.ts';

export { loadMixamoAnimation } from './mixamo-loader.ts';
export { loadVRMAAnimation } from './vrma-loader.ts';

// ─── Talking layer ────────────────────────────────────────────────────────────
export { TalkingLayer } from './talking-layer.ts';

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

export { VfxManager } from './effects/vfx-manager.ts';
export type { VfxBinding, VfxType } from './effects/emotion-vfx.ts';
export type { VfxBindingJson } from './clip-registry.ts';
