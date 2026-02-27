/**
 * Damped spring simulation for natural settle-into-pose motion.
 *
 * Physics: critically/under-damped harmonic oscillator.
 * Feels organic because it overshoots slightly then settles,
 * like a real body adjusting posture.
 */
import type { SpringState } from './types.ts';

/**
 * Step a damped spring one frame.
 *
 * @param state     Mutable spring state (current value + velocity)
 * @param target    Target value to spring toward
 * @param stiffness Spring constant — higher = snappier (default 12)
 * @param damping   Damping ratio — 1.0 = critical, <1 = bouncy (default 0.7)
 * @param delta     Frame delta time in seconds
 * @returns         The new current value (also written to state.current)
 */
export function stepSpring(
  state: SpringState,
  target: number,
  stiffness: number,
  damping: number,
  delta: number,
): number {
  // Clamp delta to prevent explosion after tab-switch (max 100ms)
  const dt = Math.min(delta, 0.1);

  const displacement = state.current - target;
  const springForce = -stiffness * displacement;
  const dampingForce = -2 * damping * Math.sqrt(stiffness) * state.velocity;
  const acceleration = springForce + dampingForce;

  state.velocity += acceleration * dt;
  state.current += state.velocity * dt;

  // Snap to target if close enough (prevents infinite micro-oscillation)
  if (Math.abs(displacement) < 0.0001 && Math.abs(state.velocity) < 0.0001) {
    state.current = target;
    state.velocity = 0;
  }

  return state.current;
}

/** Create a new spring state at a given initial value. */
export function createSpring(initial: number = 0): SpringState {
  return { current: initial, velocity: 0 };
}
