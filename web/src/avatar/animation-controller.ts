/**
 * AnimationController — thin wrapper around ProceduralEngine.
 *
 * Maintains the same public API as the old mixer-based controller
 * so StateMachine doesn't need changes. But internally, all motion
 * is procedural — no FBX files, no Three.js AnimationMixer.
 *
 * Usage:
 *   const ctrl = new AnimationController(vrm);
 *   await ctrl.loadAnimations();  // no-op (instant, nothing to load)
 *   ctrl.playAction('typing', 'high');
 *   ctrl.update(delta);
 *   ctrl.dispose();
 */
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Intensity } from '@project-avatar/shared';
import { ProceduralEngine } from './procedural/engine.ts';

export class AnimationController {
  private engine: ProceduralEngine;

  /** Callback for when a non-looping action completes (used by state machine). */
  onActionFinished?: () => void;

  constructor(vrm: VRM) {
    this.engine = new ProceduralEngine(vrm);
    this.engine.onRecipeFinished = () => {
      this.onActionFinished?.();
    };
  }

  /**
   * Load animations — instant for procedural engine.
   * Kept for API compatibility with StateMachine.
   */
  async loadAnimations(): Promise<void> {
    // Nothing to load! Procedural animations are pure math.
    // The engine is ready the moment it's constructed.
    console.info('[AnimationController] Procedural engine ready (no FBX loading needed)');
  }

  /**
   * Play an action with the given intensity.
   */
  playAction(action: Action, intensity: Intensity = 'medium'): void {
    this.engine.play(action, intensity);
  }

  /**
   * Stop all animations and return to idle.
   */
  stopAll(): void {
    this.engine.stop();
  }

  /**
   * Tick the animation engine. Call every frame.
   */
  update(delta: number): void {
    this.engine.update(delta);
  }

  /**
   * Clean up.
   */
  dispose(): void {
    this.engine.dispose();
  }
}
