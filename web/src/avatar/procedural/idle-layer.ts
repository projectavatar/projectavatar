/**
 * The idle layer — an always-running procedural animation that makes
 * the avatar feel alive even when no action is playing.
 *
 * This is NOT a recipe. It's a separate system that runs underneath
 * all action recipes. The engine blends its influence down when an
 * action is active (but never to zero — breathing persists always).
 *
 * Components:
 * - Breathing: spine chain oscillation (inhale/exhale)
 * - Weight shift: hips lateral drift + subtle leg compensation
 * - Micro-sway: layered noise on spine for organic feel
 * - Head drift: slow noise-driven look-around
 * - Shoulder settle: asymmetric micro-rotations
 */
import type { BoneState, AnimBone } from './types.ts';
import { noise1D } from './noise.ts';

const TAU = Math.PI * 2;

// ─── Breathing ────────────────────────────────────────────────────────────────
const BREATHE_PERIOD = 5.5;         // seconds per breath cycle (~11/min)
const BREATHE_SPINE  = 0.008;       // radians — chest expansion
const BREATHE_CHEST  = 0.006;       // radians — upper chest
const BREATHE_SHOULDERS = 0.004;    // radians — shoulders rise/fall

// ─── Weight Shift ─────────────────────────────────────────────────────────────
const WEIGHT_PERIOD  = 13.7;        // seconds per full L-R-L cycle
const WEIGHT_HIP_X   = 0.003;      // units — hip lateral translation
const WEIGHT_HIP_ROT = 0.006;      // radians — hip tilt
const WEIGHT_SPINE_COMP = 0.004;   // radians — spine counter-tilt

// ─── Micro-sway (noise-driven) ───────────────────────────────────────────────
const SWAY_AMP_SPINE  = 0.005;     // radians
const SWAY_AMP_CHEST  = 0.004;
const SWAY_AMP_NECK   = 0.003;
const SWAY_SPEED      = 0.25;      // noise time multiplier

// ─── Head drift ───────────────────────────────────────────────────────────────
const HEAD_DRIFT_YAW   = 0.015;    // radians — looking left/right
const HEAD_DRIFT_PITCH = 0.008;    // radians — looking up/down
const HEAD_DRIFT_SPEED = 0.12;     // noise speed (very slow)

// ─── Shoulder settle ──────────────────────────────────────────────────────────
const SHOULDER_AMP    = 0.005;     // radians
const SHOULDER_PERIOD = 9.1;       // seconds
const SHOULDER_PHASE_OFFSET = Math.PI * 0.6; // asymmetry between L/R

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
  const breathPhase = Math.sin((t / BREATHE_PERIOD) * TAU);
  // Inhale: spine extends back, chest opens
  addRotation(output, 'spine',      'x', breathPhase * BREATHE_SPINE * influence);
  addRotation(output, 'chest',      'x', breathPhase * BREATHE_CHEST * influence);
  addRotation(output, 'upperChest', 'x', breathPhase * BREATHE_CHEST * 0.5 * influence);
  // Shoulders rise slightly on inhale
  addRotation(output, 'leftShoulder',  'z',  -(breathPhase * BREATHE_SHOULDERS * influence));
  addRotation(output, 'rightShoulder', 'z', breathPhase * BREATHE_SHOULDERS * influence);

  // ── Weight shift ──
  const weightPhase = Math.sin((t / WEIGHT_PERIOD) * TAU);
  addPosition(output, 'hips', 'x', -(weightPhase * WEIGHT_HIP_X * influence));
  addRotation(output, 'hips',  'z', -(weightPhase * WEIGHT_HIP_ROT * influence));
  addRotation(output, 'spine', 'z', weightPhase * WEIGHT_SPINE_COMP * influence);

  // ── Micro-sway (noise) ──
  const swayT = t * SWAY_SPEED;
  addRotation(output, 'spine', 'z', -(noise1D(swayT, 0) * SWAY_AMP_SPINE * influence));
  addRotation(output, 'spine', 'x', -(noise1D(swayT, 1) * SWAY_AMP_SPINE * 0.5 * influence));
  addRotation(output, 'chest', 'z', -(noise1D(swayT, 2) * SWAY_AMP_CHEST * influence));
  addRotation(output, 'neck',  'z', -(noise1D(swayT, 3) * SWAY_AMP_NECK * influence));

  // ── Head drift ──
  const headT = t * HEAD_DRIFT_SPEED;
  addRotation(output, 'head', 'y', noise1D(headT, 10) * HEAD_DRIFT_YAW * influence);
  addRotation(output, 'head', 'x', -(noise1D(headT, 11) * HEAD_DRIFT_PITCH * influence));

  // ── Shoulder settle ──
  const shoulderPhase = (t / SHOULDER_PERIOD) * TAU;
  addRotation(output, 'leftShoulder',  'z',
    Math.sin(shoulderPhase) * SHOULDER_AMP * influence);
  addRotation(output, 'rightShoulder', 'z',
    Math.sin(shoulderPhase + SHOULDER_PHASE_OFFSET) * SHOULDER_AMP * influence);
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

function addPosition(
  output: Map<AnimBone, BoneState>,
  bone: AnimBone,
  axis: 'x' | 'y' | 'z',
  value: number,
): void {
  const state = getOrCreate(output, bone);
  if (axis === 'x') state.px += value;
  else if (axis === 'y') state.py += value;
  else state.pz += value;
}
