/**
 * Evaluators for each motion primitive type.
 *
 * Each function takes a primitive definition + elapsed time
 * and returns a rotation delta in radians. The engine calls these
 * every frame and accumulates the results per bone per axis.
 */
import type {
  OscillatePrimitive,
  ReachPrimitive,
  RecoilPrimitive,
  NoisePrimitive,
  PositionOscillate,
} from './types.ts';
import { noise1D } from './noise.ts';

const TAU = Math.PI * 2;

/**
 * Evaluate an oscillation primitive.
 * Returns a rotation delta in radians.
 */
export function evalOscillate(p: OscillatePrimitive, elapsed: number): number {
  const phase = p.phase ?? 0;
  return Math.sin((elapsed / p.period) * TAU + phase) * p.amplitude;
}

/**
 * Evaluate a reach primitive.
 * Smoothly interpolates from 0 to target over duration using ease-in-out.
 *
 * @param elapsed Time since the action started (seconds)
 * @returns Current rotation value in radians
 */
export function evalReach(p: ReachPrimitive, elapsed: number): number {
  const delay = p.delay ?? 0;
  const t = elapsed - delay;
  if (t <= 0) return 0;
  if (t >= p.duration) return p.target;

  // Ease-in-out cubic
  const progress = t / p.duration;
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;

  return p.target * eased;
}

/**
 * Evaluate a recoil primitive.
 * Quick overshoot to peakAngle, then settle to settleAngle.
 *
 * @param elapsed Time since the action started (seconds)
 * @returns Current rotation value in radians
 */
export function evalRecoil(p: RecoilPrimitive, elapsed: number): number {
  if (elapsed <= 0) return 0;

  if (elapsed <= p.attackTime) {
    // Attack phase: ease-out to peak (fast start, decelerate)
    const progress = elapsed / p.attackTime;
    const eased = 1 - (1 - progress) * (1 - progress);
    return p.peakAngle * eased;
  }

  const settleElapsed = elapsed - p.attackTime;
  if (settleElapsed >= p.settleTime) return p.settleAngle;

  // Settle phase: ease-in-out from peak to settle
  const progress = settleElapsed / p.settleTime;
  const eased = progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;

  return p.peakAngle + (p.settleAngle - p.peakAngle) * eased;
}

/**
 * Evaluate a noise primitive.
 * Returns smooth, non-repeating organic drift.
 *
 * @param elapsed Time since the engine started (seconds)
 * @returns Current rotation offset in radians
 */
export function evalNoise(p: NoisePrimitive, elapsed: number): number {
  const seed = p.seed ?? 0;
  return noise1D(elapsed * p.speed, seed) * p.amplitude;
}

/**
 * Evaluate a position oscillation (for hip translation).
 */
export function evalPositionOscillate(p: PositionOscillate, elapsed: number): number {
  const phase = p.phase ?? 0;
  return Math.sin((elapsed / p.period) * TAU + phase) * p.amplitude;
}
