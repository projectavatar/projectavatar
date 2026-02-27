import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Intensity } from '@project-avatar/shared';
import { loadMixamoAnimation } from './mixamo-loader.ts';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Base URL for animation assets (served from /animations/ in public/) */
const ANIMATIONS_BASE = '/animations';

/** Map from Action state to the FBX filename served from /animations/ */
const ACTION_TO_FILE: Record<Action, string> = {
  idle:            'standing-idle.fbx',
  talking:         'happy-forward-hand-gesture.fbx',
  typing:          'sitting-at-a-computer-and-typing.fbx',
  nodding:         'nodding-head-yes.fbx',
  waving:          'emotional-waving-forward.fbx',
  greeting:        'greeting-while-standing.fbx',
  laughing:        'talking-finding-something-funny.fbx',
  pointing:        'pointing-behind-with-thumb.fbx',
  fist_pump:       'high-enthusiasm-fist-pump.fbx',
  dismissive:      'dismissing-with-back-hand.fbx',
  plotting:        'evil-plotting.fbx',
  sarcastic:       'sarcastically-looking-away.fbx',
  looking_around:  'standing-up-and-looking-around.fbx',
  shading_eyes:    'looking-with-hand-shading-eyes.fbx',
  telling_secret:  'telling-a-secret.fbx',
  victory:         'big-vegas-victory-idle.fbx',
  head_shake:      'gesturing-head-side-to-side.fbx',
  relief:          'shaking-it-off-in-relief.fbx',
  cautious_agree:  'step-back-cautiously-agreeing.fbx',
  angry_fist:      'vexed-shaking-of-the-fist.fbx',
  rallying:        'rallying-the-crowd-to-make-them-cheer.fbx',
  sad_idle:        'standing-in-a-sad-disposition.fbx',
  nervous_look:    'nervously-looking-around-left-to-right-loop.fbx',
  terrified:       'being-terrified-while-standing.fbx',
  scratching_head: 'right-hand-behind-head.fbx',
  cocky:           'cocky-lean-back.fbx',
  questioning:     'asking-a-question-with-one-hand.fbx',
  phone:           'female-standing-talking-on-phone.fbx',
  celebrating:     'victory-from-a-boxing-win.fbx',
};

/** Actions that loop continuously. Everything else plays once and clamps. */
const LOOPING_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'idle',
  'talking',
  'typing',
  'plotting',
  'looking_around',
  'sad_idle',
  'nervous_look',
  'phone',
  'cocky',
]);

const INTENSITY_SPEED: Record<Intensity, number> = {
  low: 0.7,
  medium: 1.0,
  high: 1.3,
};

const FADE_DURATION = 0.6;

// ─── AnimationController ──────────────────────────────────────────────────────

/**
 * Plays retargeted Mixamo FBX animations on a VRM model.
 *
 * Usage:
 *   const ctrl = new AnimationController(vrm);
 *   await ctrl.loadAnimations();          // non-blocking; idle plays when ready
 *   ctrl.playAction('typing', 'high');    // crossfade to new animation
 *   ctrl.update(delta);                   // call every frame
 *   ctrl.dispose();                       // cleanup
 */
export class AnimationController {
  private vrm: VRM;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<Action, THREE.AnimationAction>();
  private currentAction: Action = 'idle';
  private loaded = false;

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  /**
   * Load all Mixamo FBX animations, retarget them to the VRM, and start idle.
   *
   * Safe to call in the background — if it fails, the controller simply
   * does nothing on update() (no crashes, just a static pose).
   */
  async loadAnimations(): Promise<void> {
    const mixer = new THREE.AnimationMixer(this.vrm.scene);
    this.mixer = mixer;

    const entries = Object.entries(ACTION_TO_FILE) as [Action, string][];

    // Load all animations in parallel
    const results = await Promise.allSettled(
      entries.map(async ([action, filename]) => {
        const url = `${ANIMATIONS_BASE}/${filename}`;
        const clip = await loadMixamoAnimation(url, this.vrm);
        // Give the clip a meaningful name for debugging
        clip.name = action;
        return { action, clip };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { action, clip } = result.value;
        const animAction = mixer.clipAction(clip);

        // Configure loop mode
        if (LOOPING_ACTIONS.has(action)) {
          animAction.setLoop(THREE.LoopRepeat, Infinity);
        } else {
          animAction.setLoop(THREE.LoopOnce, 1);
          animAction.clampWhenFinished = true;
        }

        this.actions.set(action, animAction);
      } else {
        console.warn(
          `[AnimationController] Failed to load animation for "${(result as any).reason?.message ?? 'unknown'}":`,
          result.reason,
        );
      }
    }

    this.loaded = true;

    // Listen for play-once animations finishing → return to idle
    mixer.addEventListener('finished', (e) => {
      const finishedAction = (e as THREE.AnimationMixerEventMap['finished']).action;
      // Only auto-return if this was the active play-once action
      if (finishedAction === this.actions.get(this.currentAction)) {
        this.playAction('idle', 'medium');
      }
    });

    console.info(
      `[AnimationController] Loaded ${this.actions.size}/${entries.length} animations`,
    );

    // Apply any action that was requested before animations finished loading
    const pendingAction = this.currentAction;
    const idleAction = this.actions.get('idle');
    if (idleAction) {
      idleAction.play();
      this.currentAction = 'idle';
    }
    // Replay pending action if it was set before load completed
    if (pendingAction !== 'idle') {
      this.playAction(pendingAction, 'medium');
    }
  }

  /**
   * Crossfade to a new action with the given intensity.
   *
   * If the same action+intensity is already playing, this is a no-op.
   * If animations haven't loaded yet, the request is stored so it takes
   * effect once loadAnimations() completes.
   */
  playAction(action: Action, intensity: Intensity = 'medium'): void {
    if (!this.loaded) {
      // Store intent — will be applied when animations finish loading
      this.currentAction = action;
      return;
    }

    const nextAnimAction = this.actions.get(action);
    if (!nextAnimAction) {
      console.warn(`[AnimationController] No animation loaded for action "${action}"`);
      return;
    }

    const prevAnimAction = this.actions.get(this.currentAction);

    // If same action already playing, just update timeScale
    if (action === this.currentAction && prevAnimAction?.isRunning()) {
      prevAnimAction.timeScale = INTENSITY_SPEED[intensity];
      return;
    }

    // Fade out current
    if (prevAnimAction && prevAnimAction !== nextAnimAction) {
      prevAnimAction.fadeOut(FADE_DURATION);
    }

    // Configure and fade in next
    nextAnimAction.reset();
    nextAnimAction.timeScale = INTENSITY_SPEED[intensity];
    nextAnimAction.fadeIn(FADE_DURATION);
    nextAnimAction.play();

    this.currentAction = action;
  }

  /**
   * Stop all animations and return to idle.
   */
  stopAll(): void {
    this.playAction('idle', 'medium');
  }

  /**
   * Tick the animation mixer. Call every frame.
   */
  update(delta: number): void {
    this.mixer?.update(delta);
  }

  /**
   * Clean up the mixer and all cached actions.
   */
  dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      // Uncache all clips to free memory
      for (const action of this.actions.values()) {
        this.mixer.uncacheClip(action.getClip());
      }
      this.mixer = null;
    }
    this.actions.clear();
    this.loaded = false;
  }
}
