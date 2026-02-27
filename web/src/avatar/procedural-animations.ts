import * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Action } from '@project-avatar/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A BonePose maps VRM bone names to target quaternion rotations.
 * Identity quaternion = rest pose. All rotations are offsets from rest.
 */
export type BonePose = Map<VRMHumanBoneName, THREE.Quaternion>;

/**
 * A procedural animation function.
 * Given elapsed time (seconds) and an intensity multiplier (0.7–1.3),
 * returns the desired bone rotations for this frame.
 */
export type ProceduralAnimation = (elapsed: number, intensity: number) => BonePose;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a quaternion from Euler angles (radians, XYZ order). */
function quat(x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
}

/** Shorthand for bone name typing. */
const B = {
  hips: 'hips' as VRMHumanBoneName,
  spine: 'spine' as VRMHumanBoneName,
  chest: 'chest' as VRMHumanBoneName,
  upperChest: 'upperChest' as VRMHumanBoneName,
  neck: 'neck' as VRMHumanBoneName,
  head: 'head' as VRMHumanBoneName,
  leftShoulder: 'leftShoulder' as VRMHumanBoneName,
  rightShoulder: 'rightShoulder' as VRMHumanBoneName,
  leftUpperArm: 'leftUpperArm' as VRMHumanBoneName,
  leftLowerArm: 'leftLowerArm' as VRMHumanBoneName,
  leftHand: 'leftHand' as VRMHumanBoneName,
  rightUpperArm: 'rightUpperArm' as VRMHumanBoneName,
  rightLowerArm: 'rightLowerArm' as VRMHumanBoneName,
  rightHand: 'rightHand' as VRMHumanBoneName,
  leftUpperLeg: 'leftUpperLeg' as VRMHumanBoneName,
  rightUpperLeg: 'rightUpperLeg' as VRMHumanBoneName,
} as const;

// ─── Animation: waiting (idle breathing) ──────────────────────────────────────

/**
 * Gentle breathing: slow chest/spine vertical oscillation, very subtle lateral sway.
 * This is the base state — everything returns here when idle.
 */
const waiting: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.0 * intensity;
  const amp = 0.02 * intensity;

  // Breathing: chest rises and falls
  const breathCycle = Math.sin(t * speed * 1.8);

  // Subtle lateral sway — slower than breathing, gives life
  const sway = Math.sin(t * speed * 0.4) * amp * 0.8;
  pose.set(B.spine, quat(breathCycle * amp * 0.5, 0, sway));

  pose.set(B.chest, quat(breathCycle * amp, 0, 0));
  pose.set(B.upperChest, quat(breathCycle * amp * 0.7, 0, 0));

  // Neck micro-movement — follows sway slightly
  const neckSway = Math.sin(t * speed * 0.5) * amp * 0.4;
  pose.set(B.neck, quat(0, neckSway, 0));

  // Head very subtle tilt
  const headTilt = Math.sin(t * speed * 0.3) * amp * 0.3;
  pose.set(B.head, quat(0, 0, headTilt));

  return pose;
};

// ─── Animation: responding (talking) ──────────────────────────────────────────

/**
 * Slight forward lean, rhythmic head nodding like talking/explaining.
 * Arms have subtle gestural movement.
 */
const responding: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.0 * intensity;
  const amp = 1.0 * intensity;

  // Forward lean — engaged in conversation
  pose.set(B.upperChest, quat(0.03 * amp, 0, 0));

  // Head nodding — primary conversational rhythm
  const nod = Math.sin(t * speed * 3.5) * 0.06 * amp;
  const tilt = Math.sin(t * speed * 1.2) * 0.03 * amp;
  pose.set(B.neck, quat(nod * 0.4, 0, 0));
  pose.set(B.head, quat(nod, 0, tilt));

  // Breathing underneath + forward lean
  const breathe = Math.sin(t * speed * 1.8) * 0.015 * amp;
  pose.set(B.spine, quat(0.04 * amp + breathe, 0, 0));
  pose.set(B.chest, quat(breathe + 0.03 * amp, 0, 0));

  // Right arm subtle gesture — like emphasizing a point
  const gesture = Math.sin(t * speed * 2.0) * 0.08 * amp;
  pose.set(B.rightUpperArm, quat(-0.1 * amp, 0, -0.15 * amp + gesture * 0.5));
  pose.set(B.rightLowerArm, quat(-0.15 * amp + gesture, 0, 0));

  // Left arm mirrors slightly, less motion
  const lGesture = Math.sin(t * speed * 2.0 + 1.5) * 0.04 * amp;
  pose.set(B.leftUpperArm, quat(-0.05 * amp, 0, 0.1 * amp + lGesture));
  pose.set(B.leftLowerArm, quat(-0.08 * amp + lGesture, 0, 0));

  return pose;
};

// ─── Animation: searching (thinking) ──────────────────────────────────────────

/**
 * Head tilts side-to-side slowly. Hand raised to chin (thinking pose).
 * Contemplative, slightly slower rhythm.
 */
const searching: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 0.8 * intensity;
  const amp = 1.0 * intensity;

  // Head tilts — the classic "hmm" motion
  const headTilt = Math.sin(t * speed * 0.8) * 0.12 * amp;
  const headYaw = Math.sin(t * speed * 0.5) * 0.06 * amp;
  pose.set(B.head, quat(-0.05 * amp, headYaw, headTilt));
  pose.set(B.neck, quat(-0.03 * amp, headYaw * 0.3, headTilt * 0.3));

  // Slight upward gaze — looking into the distance
  pose.set(B.upperChest, quat(-0.02 * amp, 0, 0));

  // Right arm: hand to chin thinking pose
  pose.set(B.rightUpperArm, quat(-0.4 * amp, 0.1 * amp, -0.3 * amp));
  pose.set(B.rightLowerArm, quat(-0.8 * amp, 0, 0));
  // Slight wrist movement — tapping chin
  const chinTap = Math.sin(t * speed * 1.5) * 0.04 * amp;
  pose.set(B.rightHand, quat(-0.2 * amp + chinTap, 0, 0));

  // Left arm relaxed at side
  pose.set(B.leftUpperArm, quat(0, 0, 0.05 * amp));

  // Breathing
  const breathe = Math.sin(t * speed * 1.8) * 0.015 * amp;
  pose.set(B.spine, quat(breathe, 0, 0));
  pose.set(B.chest, quat(breathe * 0.7, 0, 0));

  return pose;
};

// ─── Animation: coding (typing) ──────────────────────────────────────────────

/**
 * Slight forward hunch (focused posture). Arms positioned as if typing.
 * Rhythmic wrist/hand motion simulating keystrokes.
 */
const coding: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.0 * intensity;
  const amp = 1.0 * intensity;

  // Breathing (slightly suppressed — focused) + forward hunch
  const breathe = Math.sin(t * speed * 1.8) * 0.01 * amp;
  pose.set(B.spine, quat(0.06 * amp + breathe, 0, 0));
  pose.set(B.chest, quat(0.04 * amp, 0, 0));
  pose.set(B.upperChest, quat(0.03 * amp, 0, 0));

  // Head slightly down — reading screen
  pose.set(B.head, quat(0.08 * amp, 0, 0));
  pose.set(B.neck, quat(0.04 * amp, 0, 0));

  // Arms in typing position
  pose.set(B.leftUpperArm, quat(-0.2 * amp, 0, 0.35 * amp));
  pose.set(B.rightUpperArm, quat(-0.2 * amp, 0, -0.35 * amp));
  pose.set(B.leftLowerArm, quat(-0.5 * amp, 0, 0));
  pose.set(B.rightLowerArm, quat(-0.5 * amp, 0, 0));

  // Typing rhythm — offset between hands for realism
  const typeL = Math.sin(t * speed * 8.0) * 0.06 * amp;
  const typeR = Math.sin(t * speed * 8.0 + 2.1) * 0.06 * amp;
  // Occasional pause in typing — modulate with slower wave
  const typingEnvelope = 0.5 + 0.5 * Math.sin(t * speed * 0.7);
  pose.set(B.leftHand, quat(typeL * typingEnvelope, 0, 0));
  pose.set(B.rightHand, quat(typeR * typingEnvelope, 0, 0));

  // Subtle shoulder tension
  pose.set(B.leftShoulder, quat(0, 0, 0.02 * amp));
  pose.set(B.rightShoulder, quat(0, 0, -0.02 * amp));

  return pose;
};

// ─── Animation: reading ───────────────────────────────────────────────────────

/**
 * Head angled down. Arms slightly raised and forward as if holding a book.
 * Slow, peaceful rhythm. Occasional page-turn motion.
 */
const reading: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 0.7 * intensity;
  const amp = 1.0 * intensity;

  // Slow eye-scanning motion — head micro-pans left to right
  const scan = Math.sin(t * speed * 0.6) * 0.03 * amp;

  // Head down — looking at book (combined with scan)
  pose.set(B.head, quat(0.15 * amp, scan, 0));
  pose.set(B.neck, quat(0.08 * amp, 0, 0));

  // Slight forward lean
  pose.set(B.spine, quat(0.04 * amp, 0, 0));
  pose.set(B.upperChest, quat(0.02 * amp, 0, 0));

  // Arms holding book position
  pose.set(B.leftUpperArm, quat(-0.3 * amp, 0.1 * amp, 0.2 * amp));
  pose.set(B.leftLowerArm, quat(-0.6 * amp, 0, 0));
  pose.set(B.rightUpperArm, quat(-0.3 * amp, -0.1 * amp, -0.2 * amp));
  pose.set(B.rightLowerArm, quat(-0.6 * amp, 0, 0));

  // Hands angled inward (holding a book)
  pose.set(B.leftHand, quat(0, 0, -0.15 * amp));
  pose.set(B.rightHand, quat(0, 0, 0.15 * amp));

  // Very gentle breathing
  const breathe = Math.sin(t * speed * 1.8) * 0.012 * amp;
  pose.set(B.chest, quat(breathe, 0, 0));

  return pose;
};

// ─── Animation: error (confused) ──────────────────────────────────────────────

/**
 * Sharp head shake left-right (the "what?!" motion). Exaggerated confused
 * body language — shoulders raise, hands spread.
 */
const error: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.2 * intensity;
  const amp = 1.0 * intensity;

  // Head shake — fast, sharp oscillation
  const shake = Math.sin(t * speed * 6.0) * 0.15 * amp;
  // Damped over time to avoid infinite frantic shaking — pulses
  const shakePulse = 0.5 + 0.5 * Math.sin(t * speed * 0.8);
  pose.set(B.head, quat(0, shake * shakePulse, 0));
  pose.set(B.neck, quat(0, shake * shakePulse * 0.3, 0));

  // Slight backward lean — recoil
  pose.set(B.spine, quat(-0.04 * amp, 0, 0));
  pose.set(B.upperChest, quat(-0.03 * amp, 0, 0));

  // Shoulders raise — confusion/frustration
  pose.set(B.leftShoulder, quat(0, 0, 0.08 * amp));
  pose.set(B.rightShoulder, quat(0, 0, -0.08 * amp));

  // Arms spread out — "what is happening" gesture
  const armSpread = Math.sin(t * speed * 1.5) * 0.1 * amp;
  pose.set(B.leftUpperArm, quat(-0.15 * amp, 0, 0.4 * amp + armSpread));
  pose.set(B.leftLowerArm, quat(-0.2 * amp, 0, 0));
  pose.set(B.rightUpperArm, quat(-0.15 * amp, 0, -0.4 * amp - armSpread));
  pose.set(B.rightLowerArm, quat(-0.2 * amp, 0, 0));

  // Hands open/tense
  pose.set(B.leftHand, quat(-0.1 * amp, 0, 0.1 * amp));
  pose.set(B.rightHand, quat(-0.1 * amp, 0, -0.1 * amp));

  // Nervous breathing — faster
  const breathe = Math.sin(t * speed * 3.0) * 0.02 * amp;
  pose.set(B.chest, quat(breathe, 0, 0));

  return pose;
};

// ─── Animation: celebrating ───────────────────────────────────────────────────

/**
 * Arms up! Bouncy motion! Big energy!
 * The avatar equivalent of 🎉
 */
const celebrating: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.3 * intensity;
  const amp = 1.0 * intensity;

  // Bounce — whole body bobs up and down
  const bounce = Math.abs(Math.sin(t * speed * 4.0)) * 0.05 * amp;
  pose.set(B.hips, quat(bounce, 0, 0));
  pose.set(B.spine, quat(-bounce * 0.5, 0, 0)); // counter-rotate to keep head stable-ish

  // Chest sway — celebratory wiggle
  const wiggle = Math.sin(t * speed * 3.0) * 0.06 * amp;
  pose.set(B.upperChest, quat(0, 0, wiggle));

  // Head — excited bobbing
  const headBob = Math.sin(t * speed * 4.0) * 0.08 * amp;
  const headTilt = Math.sin(t * speed * 2.0) * 0.05 * amp;
  pose.set(B.head, quat(headBob, 0, headTilt));

  // Arms UP — the victory pose
  // They wave back and forth in celebration
  const armWave = Math.sin(t * speed * 3.5) * 0.15 * amp;
  pose.set(B.leftUpperArm, quat(-0.5 * amp, 0, 0.5 * amp + armWave));
  pose.set(B.leftLowerArm, quat(-0.3 * amp, 0, 0));
  pose.set(B.rightUpperArm, quat(-0.5 * amp, 0, -0.5 * amp - armWave));
  pose.set(B.rightLowerArm, quat(-0.3 * amp, 0, 0));

  // Hands — open and excited
  const handWiggle = Math.sin(t * speed * 6.0) * 0.1 * amp;
  pose.set(B.leftHand, quat(handWiggle, 0, 0));
  pose.set(B.rightHand, quat(-handWiggle, 0, 0));

  // Legs — subtle bounce
  const legBounce = Math.sin(t * speed * 4.0) * 0.03 * amp;
  pose.set(B.leftUpperLeg, quat(legBounce, 0, 0));
  pose.set(B.rightUpperLeg, quat(legBounce, 0, 0));

  return pose;
};

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Map of action name → procedural animation function.
 * Used by AnimationController to look up the animation for a given action.
 */
export const PROCEDURAL_ANIMATIONS: Record<Action, ProceduralAnimation> = {
  waiting,
  responding,
  searching,
  coding,
  reading,
  error,
  celebrating,
};
