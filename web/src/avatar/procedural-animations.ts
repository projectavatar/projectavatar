import * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Action } from '@project-avatar/shared';

export type BonePose = Map<VRMHumanBoneName, THREE.Quaternion>;
export type ProceduralAnimation = (elapsed: number, intensity: number) => BonePose;

function quat(x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
}

const B = {
  hips:         'hips'         as VRMHumanBoneName,
  spine:        'spine'        as VRMHumanBoneName,
  chest:        'chest'        as VRMHumanBoneName,
  upperChest:   'upperChest'   as VRMHumanBoneName,
  neck:         'neck'         as VRMHumanBoneName,
  head:         'head'         as VRMHumanBoneName,
  leftShoulder: 'leftShoulder' as VRMHumanBoneName,
  rightShoulder:'rightShoulder'as VRMHumanBoneName,
  leftUpperArm: 'leftUpperArm' as VRMHumanBoneName,
  leftLowerArm: 'leftLowerArm' as VRMHumanBoneName,
  leftHand:     'leftHand'     as VRMHumanBoneName,
  rightUpperArm:'rightUpperArm'as VRMHumanBoneName,
  rightLowerArm:'rightLowerArm'as VRMHumanBoneName,
  rightHand:    'rightHand'    as VRMHumanBoneName,
  leftUpperLeg: 'leftUpperLeg' as VRMHumanBoneName,
  rightUpperLeg:'rightUpperLeg'as VRMHumanBoneName,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// VRM 0.x Raw Bone Axis Reference (potato.vrm, confirmed empirically):
//
// UpperArm Z: +1.3 left / -1.3 right = arms at sides (from T-pose identity)
// UpperArm X: negative = swing forward/up, positive = swing backward
// UpperArm Y: twist around arm axis
// LowerArm Z: NEGATIVE bends left elbow, POSITIVE bends right elbow
//             -0.3 = slight bend, -0.8 = strong bend (left); mirror for right
// ═══════════════════════════════════════════════════════════════════════════════

// ─── waiting ──────────────────────────────────────────────────────────────────
// Relaxed idle pose. Arms hang naturally at sides, slight elbow bend so they
// don't look like a robot. Gentle breathing on spine/chest. Subtle weight shift.

const waiting: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.0 * intensity;
  const amp = 0.02 * intensity;

  const breathe = Math.sin(t * speed * 1.8);
  const sway = Math.sin(t * speed * 0.4) * amp * 0.8;

  // Body — gentle breathing + micro weight shift
  pose.set(B.spine,      quat(breathe * amp * 0.5, 0, sway));
  pose.set(B.chest,      quat(breathe * amp, 0, 0));
  pose.set(B.upperChest, quat(breathe * amp * 0.7, 0, 0));
  pose.set(B.neck,       quat(0, Math.sin(t * speed * 0.5) * amp * 0.4, 0));
  pose.set(B.head,       quat(0, 0, Math.sin(t * speed * 0.3) * amp * 0.3));

  // Arms at sides, natural slight elbow bend
  const armSway = Math.sin(t * speed * 0.4) * 0.008;
  pose.set(B.leftUpperArm,  quat(0.05, 0,  1.3 + armSway));
  pose.set(B.rightUpperArm, quat(0.05, 0, -1.3 - armSway));
  pose.set(B.leftLowerArm,  quat(0, 0, -0.25));
  pose.set(B.rightLowerArm, quat(0, 0,  0.25));

  return pose;
};

// ─── responding ──────────────────────────────────────────────────────────────
// Engaged conversational pose. Head nods periodically. Right arm gestures
// slightly forward (like punctuating points), left arm relaxed at side.
// Arms stay mostly down — this is talking, not flailing.

const responding: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.0 * intensity;
  const amp = 1.0 * intensity;

  const breathe = Math.sin(t * speed * 1.8) * 0.015 * amp;
  const nod = Math.sin(t * speed * 3.5) * 0.06 * amp;
  const tilt = Math.sin(t * speed * 1.2) * 0.03 * amp;
  const gesture = Math.sin(t * speed * 2.0) * 0.06 * amp;

  // Body — slight forward lean like engaged in conversation
  pose.set(B.spine,      quat(0.04 * amp + breathe, 0, 0));
  pose.set(B.chest,      quat(breathe + 0.03 * amp, 0, 0));
  pose.set(B.upperChest, quat(0.03 * amp, 0, 0));
  pose.set(B.neck,       quat(nod * 0.4, 0, 0));
  pose.set(B.head,       quat(nod, 0, tilt));

  // Left arm: relaxed at side, slight elbow bend
  pose.set(B.leftUpperArm,  quat(0.05, 0, 1.25));
  pose.set(B.leftLowerArm,  quat(0, 0, -0.3));

  // Right arm: gesturing subtly — slightly more forward and away from body,
  // with elbow bend that sways with the gesture rhythm
  pose.set(B.rightUpperArm, quat(-0.15 * amp, 0, -1.1 - gesture * 0.5));
  pose.set(B.rightLowerArm, quat(0, 0, 0.45 + gesture * 0.15));
  pose.set(B.rightHand,     quat(0, 0, gesture * 0.2));

  return pose;
};

// ─── searching ───────────────────────────────────────────────────────────────
// Classic "thinking" pose. Right hand to chin — right upper arm raised forward
// and inward, right elbow bent strongly to bring hand near face. Left arm
// relaxed at side. Head tilts slightly as if pondering.

const searching: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 0.8 * intensity;
  const amp = 1.0 * intensity;

  const headTilt = Math.sin(t * speed * 0.8) * 0.08 * amp;
  const headYaw = Math.sin(t * speed * 0.5) * 0.06 * amp;
  const breathe = Math.sin(t * speed * 1.8) * 0.015 * amp;
  const chinTap = Math.sin(t * speed * 1.5) * 0.03 * amp;

  // Body — mostly still, slight breathing
  pose.set(B.spine,      quat(breathe, 0, 0));
  pose.set(B.chest,      quat(breathe * 0.7, 0, 0));
  pose.set(B.upperChest, quat(-0.02 * amp, 0, 0));
  pose.set(B.neck,       quat(-0.03 * amp, headYaw * 0.3, headTilt * 0.3));
  pose.set(B.head,       quat(-0.05 * amp, headYaw, headTilt));

  // Left arm: relaxed at side with natural elbow bend
  pose.set(B.leftUpperArm,  quat(0.05, 0, 1.3));
  pose.set(B.leftLowerArm,  quat(0, 0, -0.3));

  // Right arm: raised forward and across toward chin
  // x: negative = swing forward/up. z: less negative = less dropped = more raised
  // y: slight inward twist to bring hand toward face center
  pose.set(B.rightUpperArm, quat(-0.5 * amp, 0.2 * amp, -0.7 * amp));
  pose.set(B.rightLowerArm, quat(0, 0, 1.1 * amp));     // strong elbow bend
  pose.set(B.rightHand,     quat(-0.2 * amp + chinTap, 0, 0));

  return pose;
};

// ─── coding ──────────────────────────────────────────────────────────────────
// Typing at a keyboard. Both arms forward and down, elbows bent at ~90°,
// forearms roughly horizontal. Slight forward hunch. Fingers wiggle (hand
// bones) to simulate keystrokes. Head tilted down looking at screen.

const coding: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.0 * intensity;
  const amp = 1.0 * intensity;

  const breathe = Math.sin(t * speed * 1.8) * 0.01 * amp;
  const typeL = Math.sin(t * speed * 8.0) * 0.05 * amp;
  const typeR = Math.sin(t * speed * 8.0 + 2.1) * 0.05 * amp;
  const typingEnvelope = 0.5 + 0.5 * Math.sin(t * speed * 0.7);

  // Body — slight coding hunch
  pose.set(B.spine,      quat(0.06 * amp + breathe, 0, 0));
  pose.set(B.chest,      quat(0.04 * amp, 0, 0));
  pose.set(B.upperChest, quat(0.03 * amp, 0, 0));
  pose.set(B.neck,       quat(0.04 * amp, 0, 0));
  pose.set(B.head,       quat(0.08 * amp, 0, 0));

  // Arms forward (x: -0.3 = forward swing), still mostly at sides (z: ~1.0)
  // Elbows bent strongly for typing position
  pose.set(B.leftUpperArm,  quat(-0.3 * amp, 0,  1.05 * amp));
  pose.set(B.leftLowerArm,  quat(0, 0, -0.7 * amp));
  pose.set(B.rightUpperArm, quat(-0.3 * amp, 0, -1.05 * amp));
  pose.set(B.rightLowerArm, quat(0, 0,  0.7 * amp));

  // Typing finger wiggle
  pose.set(B.leftHand,  quat(typeL * typingEnvelope, 0, 0));
  pose.set(B.rightHand, quat(typeR * typingEnvelope, 0, 0));

  return pose;
};

// ─── reading ─────────────────────────────────────────────────────────────────
// Holding a book/tablet. Both arms forward and slightly raised, elbows bent
// to bring hands together in front of chest. Head tilted down as if reading.
// Eyes scan left-to-right (head Y oscillation).

const reading: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 0.7 * intensity;
  const amp = 1.0 * intensity;

  const scan = Math.sin(t * speed * 0.6) * 0.03 * amp;
  const breathe = Math.sin(t * speed * 1.8) * 0.012 * amp;

  // Body — slight lean, head down
  pose.set(B.spine,      quat(0.04 * amp, 0, 0));
  pose.set(B.upperChest, quat(0.02 * amp, 0, 0));
  pose.set(B.chest,      quat(breathe, 0, 0));
  pose.set(B.neck,       quat(0.08 * amp, 0, 0));
  pose.set(B.head,       quat(0.15 * amp, scan, 0));

  // Arms forward and slightly raised — holding a book
  // x: -0.35 = forward, z: ~0.85 = partially dropped (not full side, not T-pose)
  // y: slight inward twist to angle hands toward center
  pose.set(B.leftUpperArm,  quat(-0.35 * amp,  0.1 * amp,  0.85 * amp));
  pose.set(B.leftLowerArm,  quat(0, 0, -0.65 * amp));
  pose.set(B.rightUpperArm, quat(-0.35 * amp, -0.1 * amp, -0.85 * amp));
  pose.set(B.rightLowerArm, quat(0, 0,  0.65 * amp));

  // Hands angled inward slightly to "hold" the book
  pose.set(B.leftHand,  quat(0, 0, -0.15 * amp));
  pose.set(B.rightHand, quat(0, 0,  0.15 * amp));

  return pose;
};

// ─── error ───────────────────────────────────────────────────────────────────
// Exasperated "what happened?!" pose. Arms spread outward in a shrug-like
// gesture. Head shakes side to side. Shoulders raised slightly. The arm spread
// oscillates to feel alive rather than static.

const error: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.2 * intensity;
  const amp = 1.0 * intensity;

  const shake = Math.sin(t * speed * 6.0) * 0.15 * amp;
  const shakePulse = 0.5 + 0.5 * Math.sin(t * speed * 0.8);
  const breathe = Math.sin(t * speed * 3.0) * 0.02 * amp;
  const armSpread = Math.sin(t * speed * 1.5) * 0.08 * amp;

  // Body — slight backward lean (recoil)
  pose.set(B.spine,       quat(-0.04 * amp, 0, 0));
  pose.set(B.upperChest,  quat(-0.03 * amp, 0, 0));
  pose.set(B.chest,       quat(breathe, 0, 0));
  pose.set(B.neck,        quat(0, shake * shakePulse * 0.3, 0));
  pose.set(B.head,        quat(0, shake * shakePulse, 0));
  pose.set(B.leftShoulder, quat(0, 0,  0.08 * amp));
  pose.set(B.rightShoulder,quat(0, 0, -0.08 * amp));

  // Arms spread outward — "what?!" shrug. z closer to 0 = more spread out
  // (farther from 1.3 = less dropped, more T-pose-ish but not fully)
  // Elbows bent to keep it looking natural, not rigid
  pose.set(B.leftUpperArm,  quat(-0.15 * amp, 0,  0.7 * amp + armSpread));
  pose.set(B.leftLowerArm,  quat(0, 0, -0.4 * amp));
  pose.set(B.rightUpperArm, quat(-0.15 * amp, 0, -0.7 * amp - armSpread));
  pose.set(B.rightLowerArm, quat(0, 0,  0.4 * amp));

  // Hands splayed open (slight outward rotation)
  pose.set(B.leftHand,  quat(-0.1 * amp, 0,  0.1 * amp));
  pose.set(B.rightHand, quat(-0.1 * amp, 0, -0.1 * amp));

  return pose;
};

// ─── celebrating ─────────────────────────────────────────────────────────────
// Victory! Arms raised high with fist pumps. Bouncy body. Head bobbing with
// excitement. Arms wave overhead. The whole body is energetic.

const celebrating: ProceduralAnimation = (t, intensity) => {
  const pose: BonePose = new Map();
  const speed = 1.3 * intensity;
  const amp = 1.0 * intensity;

  const bounce = Math.abs(Math.sin(t * speed * 4.0)) * 0.05 * amp;
  const wiggle = Math.sin(t * speed * 3.0) * 0.06 * amp;
  const headBob = Math.sin(t * speed * 4.0) * 0.08 * amp;
  const headTilt = Math.sin(t * speed * 2.0) * 0.05 * amp;
  const armWave = Math.sin(t * speed * 3.5) * 0.12 * amp;
  const handWiggle = Math.sin(t * speed * 6.0) * 0.1 * amp;
  const legBounce = Math.sin(t * speed * 4.0) * 0.03 * amp;

  // Body — bouncy and wiggly
  pose.set(B.hips,       quat(bounce, 0, 0));
  pose.set(B.spine,      quat(-bounce * 0.5, 0, 0));
  pose.set(B.upperChest, quat(0, 0, wiggle));
  pose.set(B.head,       quat(headBob, 0, headTilt));

  // Arms raised high — x: -0.8 = raised forward/up, z: small = arms spread wide
  // (z closer to 0 on left = more T-pose = more horizontal/up vs dropped)
  // Elbows bent so forearms fold upward in a victory pose
  pose.set(B.leftUpperArm,  quat(-0.8 * amp, 0,  0.4 * amp + armWave));
  pose.set(B.leftLowerArm,  quat(0, 0, -0.6 * amp));
  pose.set(B.rightUpperArm, quat(-0.8 * amp, 0, -0.4 * amp - armWave));
  pose.set(B.rightLowerArm, quat(0, 0,  0.6 * amp));

  // Waving hands
  pose.set(B.leftHand,  quat(handWiggle, 0, 0));
  pose.set(B.rightHand, quat(-handWiggle, 0, 0));

  // Bouncy legs
  pose.set(B.leftUpperLeg,  quat(legBounce, 0, 0));
  pose.set(B.rightUpperLeg, quat(legBounce, 0, 0));

  return pose;
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const PROCEDURAL_ANIMATIONS: Record<Action, ProceduralAnimation> = {
  waiting,
  responding,
  searching,
  coding,
  reading,
  error,
  celebrating,
};
