/**
 * The idle layer — an always-running procedural animation that makes
 * the avatar feel alive even when no action is playing.
 *
 * All components run continuously using layered sine waves at
 * irrational frequency ratios. This breaks the repeating pattern
 * of single-sine motion — the combination never exactly repeats,
 * creating organic, non-rhythmic movement.
 *
 * Components:
 * - Breathing: spine chain oscillation (inhale/exhale)
 * - Weight shift: hips tilt side to side
 * - Micro-sway: layered sine on spine/chest/neck
 * - Head drift: slow look-around
 * - Shoulder settle: asymmetric micro-rotations
 * - Arm swing: gentle lateral motion
 */
import type { BoneState, AnimBone } from './types.ts';

const TAU = Math.PI * 2;

// ─── Breathing ────────────────────────────────────────────────────────────────
const BREATHE_PERIOD_1   = 7.2;       // primary cycle
const BREATHE_PERIOD_2   = 11.0;       // secondary — irrational ratio to primary
const BREATHE_SPINE      = 0.04;
const BREATHE_CHEST      = 0.03;
const BREATHE_SHOULDERS  = 0.02;

// ─── Weight Shift ─────────────────────────────────────────────────────────────
const WEIGHT_PERIOD_1    = 17.5;
const WEIGHT_PERIOD_2    = 26.0;
const WEIGHT_HIP_ROT     = 0.03;
const WEIGHT_SPINE_COMP  = 0.05;

// ─── Micro-sway ──────────────────────────────────────────────────────────────
const SWAY_PERIOD_1      = 12.0;
const SWAY_PERIOD_2      = 20.0;
const SWAY_AMP_SPINE     = 0.06;
const SWAY_AMP_CHEST     = 0.04;
const SWAY_AMP_NECK      = 0.03;

// ─── Head drift ───────────────────────────────────────────────────────────────
const HEAD_PERIOD_1      = 14.5;
const HEAD_PERIOD_2      = 22.0;
const HEAD_DRIFT_YAW     = 0.1;
const HEAD_DRIFT_PITCH   = 0.06;

// ─── Shoulder settle ──────────────────────────────────────────────────────────
const SHOULDER_PERIOD_1  = 12.0;
const SHOULDER_PERIOD_2  = 18.0;
const SHOULDER_AMP       = 0.05;

// ─── Arm swing ────────────────────────────────────────────────────────────────
const ARM_PERIOD_1       = 8.0;
const ARM_PERIOD_2       = 13.0;
const ARM_SWING_AMP      = 0.05;
const ARM_LOWER_AMP      = 0.025;

/**
 * Dual sine wave — two sine waves at irrational frequency ratios.
 * The result never exactly repeats, breaking rhythmic patterns.
 *
 * @param t       Elapsed time
 * @param period1 Primary period (seconds)
 * @param period2 Secondary period (seconds) — should be irrational ratio to period1
 * @param phase   Phase offset for secondary wave (radians)
 * @returns       Value in approximately [-1, 1] (can exceed slightly due to sum)
 */
function dualSine(t: number, period1: number, period2: number, phase: number = 0): number {
  // Primary wave (70% weight) + secondary wave (30% weight)
  // Weighted sum stays in roughly [-1, 1] range
  return Math.sin((t / period1) * TAU) * 0.7
       + Math.sin((t / period2) * TAU + phase) * 0.3;
}

/**
 * Evaluate the idle layer and write additive bone rotations.
 *
 * @param elapsed   Total elapsed time in seconds (engine clock)
 * @param output    Map of bone → accumulated state. Values are ADDED to.
 * @param influence Blend weight 0–1. Allows engine to reduce idle during actions.
 */
export function evaluateIdleLayer(
  elapsed: number,
  output: Map<AnimBone, BoneState>,
  influence: number = 1.0,
): void {
  if (influence <= 0.001) return;

  const t = elapsed;

  // ── Breathing ──
  const breath = dualSine(t, BREATHE_PERIOD_1, BREATHE_PERIOD_2);
  addRotation(output, 'spine',      'x', -breath * BREATHE_SPINE * influence);
  addRotation(output, 'chest',      'x', -breath * BREATHE_CHEST * influence);
  addRotation(output, 'upperChest', 'x', -breath * BREATHE_CHEST * 0.5 * influence);
  addRotation(output, 'leftShoulder',  'z',  breath * BREATHE_SHOULDERS * influence);
  addRotation(output, 'rightShoulder', 'z', -breath * BREATHE_SHOULDERS * influence);

  // ── Weight shift ──
  const weight = dualSine(t, WEIGHT_PERIOD_1, WEIGHT_PERIOD_2, 0.8);
  addRotation(output, 'hips',  'z', weight * WEIGHT_HIP_ROT * influence);
  addRotation(output, 'spine', 'z', -weight * WEIGHT_SPINE_COMP * influence);

  // ── Micro-sway ──
  // Each bone gets different phase offsets so they don't move in lockstep
  const swaySpineZ = dualSine(t, SWAY_PERIOD_1, SWAY_PERIOD_2, 0.0);
  const swaySpineX = dualSine(t, SWAY_PERIOD_1 * 1.1, SWAY_PERIOD_2 * 0.9, 1.5);
  const swayChest  = dualSine(t, SWAY_PERIOD_1 * 0.95, SWAY_PERIOD_2 * 1.05, 2.3);
  const swayNeck   = dualSine(t, SWAY_PERIOD_1 * 1.15, SWAY_PERIOD_2 * 0.85, 3.7);
  addRotation(output, 'spine', 'z', swaySpineZ * SWAY_AMP_SPINE * influence);
  addRotation(output, 'spine', 'x', swaySpineX * SWAY_AMP_SPINE * 0.4 * influence);
  addRotation(output, 'chest', 'z', swayChest * SWAY_AMP_CHEST * influence);
  addRotation(output, 'neck',  'z', swayNeck * SWAY_AMP_NECK * influence);

  // ── Head drift ──
  const headYaw   = dualSine(t, HEAD_PERIOD_1, HEAD_PERIOD_2, 0.0);
  const headPitch = dualSine(t, HEAD_PERIOD_1 * 1.3, HEAD_PERIOD_2 * 0.8, 2.1);
  addRotation(output, 'head', 'y', headYaw * HEAD_DRIFT_YAW * influence);
  addRotation(output, 'head', 'x', headPitch * HEAD_DRIFT_PITCH * influence);

  // ── Shoulder settle ──
  // Different phase offsets for asymmetry
  const shoulderL = dualSine(t, SHOULDER_PERIOD_1, SHOULDER_PERIOD_2, 0.0);
  const shoulderR = dualSine(t, SHOULDER_PERIOD_1, SHOULDER_PERIOD_2, 1.9);
  addRotation(output, 'leftShoulder',  'z', shoulderL * SHOULDER_AMP * influence);
  addRotation(output, 'rightShoulder', 'z', shoulderR * SHOULDER_AMP * influence);

  // ── Arm swing ──
  const armL = dualSine(t, ARM_PERIOD_1, ARM_PERIOD_2, 0.0);
  const armR = dualSine(t, ARM_PERIOD_1, ARM_PERIOD_2, Math.PI);
  addRotation(output, 'leftUpperArm',  'z',  armL * ARM_SWING_AMP * influence);
  addRotation(output, 'rightUpperArm', 'z', -armR * ARM_SWING_AMP * influence);
  addRotation(output, 'leftUpperArm',  'x',  armL * ARM_SWING_AMP * 0.25 * influence);
  addRotation(output, 'rightUpperArm', 'x',  armR * ARM_SWING_AMP * 0.25 * influence);
  addRotation(output, 'leftLowerArm',  'z',  armL * ARM_LOWER_AMP * influence);
  addRotation(output, 'rightLowerArm', 'z', -armR * ARM_LOWER_AMP * influence);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreate(output: Map<AnimBone, BoneState>, bone: AnimBone): BoneState {
  let state = output.get(bone);
  if (!state) {
    state = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 };
    output.set(bone, state);
  }
  return state;
}

function addRotation(
  output: Map<AnimBone, BoneState>,
  bone: AnimBone,
  axis: 'x' | 'y' | 'z',
  value: number,
): void {
  const state = getOrCreate(output, bone);
  if (axis === 'x') state.rx += value;
  else if (axis === 'y') state.ry += value;
  else state.rz += value;
}
