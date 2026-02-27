/**
 * Type definitions for the procedural animation engine.
 *
 * Every animation is a Recipe — a collection of BoneTargets that describe
 * how specific bones should move over time using motion Primitives.
 */

// ─── VRM Bone Names ───────────────────────────────────────────────────────────

/** Bones we actually animate. Subset of VRM humanoid bones. */
export type AnimBone =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftUpperArm'
  | 'rightUpperArm'
  | 'leftLowerArm'
  | 'rightLowerArm'
  | 'leftHand'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'rightUpperLeg'
  | 'leftLowerLeg'
  | 'rightLowerLeg';

/** Euler axis for rotation. */
export type Axis = 'x' | 'y' | 'z';

// ─── Motion Primitives ────────────────────────────────────────────────────────

/** Sine/cosine oscillation on a bone axis. */
export interface OscillatePrimitive {
  kind: 'oscillate';
  axis: Axis;
  amplitude: number;   // radians
  period: number;       // seconds per cycle
  phase?: number;       // offset in radians (default 0)
}

/** Damped spring toward a target rotation. */
export interface SpringPrimitive {
  kind: 'spring';
  axis: Axis;
  target: number;       // target rotation in radians
  stiffness?: number;   // spring constant (default 12)
  damping?: number;     // damping ratio (default 0.7)
}

/**
 * Smooth reach toward a target rotation over a duration.
 * Uses ease-in-out cubic for natural acceleration/deceleration.
 */
export interface ReachPrimitive {
  kind: 'reach';
  axis: Axis;
  target: number;       // target rotation in radians
  duration: number;     // seconds to reach target
  delay?: number;       // seconds to wait before starting (default 0)
}

/** Hold current rotation for a duration (used in sequences). */
export interface HoldPrimitive {
  kind: 'hold';
  duration: number;     // seconds
}

/** Quick overshoot then settle — for punchy gestures. */
export interface RecoilPrimitive {
  kind: 'recoil';
  axis: Axis;
  peakAngle: number;    // radians — overshoot peak
  settleAngle: number;  // radians — final resting angle
  attackTime: number;   // seconds to reach peak
  settleTime: number;   // seconds from peak to settle
}

/**
 * Noise-driven organic drift on a bone axis.
 * Uses simplex noise for natural, non-repeating movement.
 */
export interface NoisePrimitive {
  kind: 'noise';
  axis: Axis;
  amplitude: number;    // radians — max deviation
  speed: number;        // noise time multiplier (higher = faster)
  seed?: number;        // noise seed offset (default 0)
}

export type Primitive =
  | OscillatePrimitive
  | SpringPrimitive
  | ReachPrimitive
  | HoldPrimitive
  | RecoilPrimitive
  | NoisePrimitive;

// ─── Bone Targets ─────────────────────────────────────────────────────────────

/**
 * A set of primitives applied to a single bone.
 * Multiple primitives on the same bone are ADDITIVE (they stack).
 */
export interface BoneTarget {
  bone: AnimBone;
  primitives: Primitive[];
}

// ─── Position primitive for hips translation ──────────────────────────────────

export interface PositionOscillate {
  kind: 'position_oscillate';
  axis: Axis;
  amplitude: number;    // units
  period: number;       // seconds
  phase?: number;
}

export interface PositionTarget {
  bone: AnimBone;
  primitives: PositionOscillate[];
}

// ─── Recipe ───────────────────────────────────────────────────────────────────

/**
 * A complete animation recipe for one Action.
 *
 * Recipes are declarative — they describe WHAT should happen, not HOW.
 * The engine evaluates them every frame to produce bone rotations.
 */
export interface Recipe {
  /** Human-readable name for debugging. */
  name: string;

  /** Rotation targets per bone (additive on top of idle layer). */
  bones: BoneTarget[];

  /** Optional position targets (currently only hips translation). */
  positions?: PositionTarget[];

  /**
   * How long the recipe takes to reach full influence (seconds).
   * The engine ramps the recipe's blend weight from 0→1 over this duration.
   * Default: 0.3
   */
  fadeIn?: number;

  /**
   * How long to fade out when transitioning away (seconds).
   * Default: 0.5
   */
  fadeOut?: number;

  /**
   * If true, the recipe loops (primitives restart after their cycle).
   * If false, the recipe plays once and then holds its final pose
   * until the engine fades it out.
   * Default: true
   */
  loop?: boolean;

  /**
   * Total duration for non-looping recipes (seconds).
   * After this time, the engine auto-fades to idle.
   * Ignored for looping recipes.
   */
  duration?: number;
}

// ─── Engine State ─────────────────────────────────────────────────────────────

/** Per-bone accumulated rotation for one frame. */
export interface BoneState {
  rx: number;
  ry: number;
  rz: number;
  /** Position offsets (only used for hips). */
  px: number;
  py: number;
  pz: number;
}

/** Runtime state for a spring primitive. */
export interface SpringState {
  velocity: number;
  current: number;
}
