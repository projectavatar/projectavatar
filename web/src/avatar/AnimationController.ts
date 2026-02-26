import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Intensity } from '@project-avatar/shared';

/**
 * Action → animation clip playback with crossfade.
 *
 * Gracefully no-ops if no animation clips are available.
 * Animation clips would be pre-authored GLBs loaded at runtime;
 * for now, this is wired up but produces no motion until real clips exist.
 */

const ACTION_CLIP_NAMES: Record<Action, string> = {
  responding:  'talking',
  searching:   'searching',
  coding:      'typing',
  reading:     'reading',
  waiting:     'idle_breathe',
  error:       'confused_scratch',
  celebrating: 'celebrate',
};

const SPEED_MAP: Record<Intensity, number> = {
  low: 0.7,
  medium: 1.0,
  high: 1.3,
};

export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationClip>();
  private currentAction: THREE.AnimationAction | null = null;
  private fadeDuration = 0.5;

  constructor(vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene);
  }

  /** Register an animation clip for a given action. */
  registerClip(actionName: string, clip: THREE.AnimationClip): void {
    this.clips.set(actionName, clip);
  }

  /** Play the animation for a given action. Crossfades from current. */
  playAction(action: Action, intensity: Intensity = 'medium'): void {
    const clipName = ACTION_CLIP_NAMES[action];
    const clip = this.clips.get(clipName);

    if (!clip) {
      // No clip available — graceful no-op
      // This is expected until real animation GLBs are added
      return;
    }

    const newAction = this.mixer.clipAction(clip);
    newAction.timeScale = SPEED_MAP[intensity];

    if (this.currentAction && this.currentAction !== newAction) {
      this.currentAction.fadeOut(this.fadeDuration);
      newAction.reset().fadeIn(this.fadeDuration).play();
    } else if (!this.currentAction) {
      newAction.reset().play();
    }

    this.currentAction = newAction;
  }

  /** Stop all animations. */
  stopAll(): void {
    this.mixer.stopAllAction();
    this.currentAction = null;
  }

  /** Update the animation mixer. Call every frame. */
  update(delta: number): void {
    this.mixer.update(delta);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
