import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Intensity } from '@project-avatar/shared';
import { loadMixamoAnimation, loadAdditiveAnimation } from './mixamo-loader.ts';

// ─── Fade Durations (seconds) ─────────────────────────────────────────────────

/** How long to fade in/out a posture (Layer 1) additive clip. */
const POSTURE_FADE = 0.4;

/** How long to fade in/out an activity (Layer 2) additive clip. */
const ACTIVITY_FADE = 0.6;

/** Delay between posture fade-start and activity fade-start (seconds). */
const ACTIVITY_STAGGER = 0.2;

/** How long to fade in a reaction (Layer 3) one-shot clip. */
const REACTION_FADE_IN = 0.15;

/** How long to fade out a reaction near clip end. */
const REACTION_FADE_OUT = 0.25;

// ─── Layer Weights ────────────────────────────────────────────────────────────

/** Posture additive layer weight at full blend. */
const POSTURE_WEIGHT = 0.7;

/** Activity additive layer base weight (scaled by intensity). */
const ACTIVITY_WEIGHT = 0.5;

/** Reaction one-shot layer weight. */
const REACTION_WEIGHT = 0.6;

// ─── Intensity Mapping ────────────────────────────────────────────────────────

const INTENSITY_SPEED: Record<Intensity, number> = {
  low: 0.7,
  medium: 1.0,
  high: 1.3,
};

const INTENSITY_WEIGHT_SCALE: Record<Intensity, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.4,
};

// ─── Animation Base Path ──────────────────────────────────────────────────────

const ANIM_BASE = '/animations';

function animUrl(filename: string): string {
  return `${ANIM_BASE}/${filename}`;
}

// ─── Asset Maps ───────────────────────────────────────────────────────────────

/** Layer 0: base idle — always playing, never stops. */
const BASE_FILE = 'idle.fbx';

/**
 * Layer 1: posture clips per action.
 * These are the SAME FBX files as the original action clips — we extract
 * frame 0 via subClip to get a static posture offset. null = no posture shift.
 */
const POSTURE_FILES: Record<Action, string | null> = {
  waiting: null,
  responding: 'responding.fbx',
  searching: 'searching.fbx',
  coding: 'coding.fbx',
  reading: 'reading.fbx',
  error: 'error.fbx',
  celebrating: 'celebrating.fbx',
};

/**
 * Layer 2: activity clips per action.
 * Full animations made additive — the motion delta on top of posture.
 * null = no activity layer (idle just uses the base).
 */
const ACTIVITY_FILES: Record<Action, string | null> = {
  waiting: null,
  responding: 'activity-phone.fbx',
  searching: 'activity-looking-distance.fbx',
  coding: 'activity-typing.fbx',
  reading: 'activity-looking-forward.fbx',
  error: 'error.fbx',
  celebrating: 'celebrate-fist-pump.fbx',
};

/** Which actions loop. Non-looping actions play once and return to idle. */
const LOOPING_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'waiting',
  'responding',
  'coding',
  'reading',
  'searching',
]);

/**
 * Layer 3: reaction one-shots.
 * Short clips fired on events — play once on top of everything.
 */
const REACTION_FILES: Record<string, string> = {
  // Agreement / confirmation
  'nod': 'reaction-nod.fbx',
  'hesitant-agree': 'reaction-hesitant-agree.fbx',

  // Disagreement / frustration
  'head-shake': 'reaction-head-shake.fbx',
  'frustrated': 'reaction-frustrated.fbx',
  'dismiss': 'reaction-dismiss.fbx',
  'sarcastic': 'reaction-sarcastic.fbx',

  // Thinking / confusion
  'plotting': 'reaction-plotting.fbx',
  'question': 'reaction-question.fbx',
  'awkward': 'reaction-awkward.fbx',
  'mind-blown': 'reaction-mind-blown.fbx',

  // Positive / excitement
  'happy-gesture': 'reaction-happy-gesture.fbx',
  'relief': 'reaction-relief.fbx',
  'laughing': 'reaction-laughing.fbx',
  'cocky': 'reaction-cocky.fbx',

  // Negative / concern
  'bashful': 'reaction-bashful.fbx',
  'terrified': 'reaction-terrified.fbx',
  'nervous-look': 'reaction-nervous-look.fbx',

  // Social
  'wave': 'reaction-wave.fbx',
  'greeting': 'reaction-greeting.fbx',
  'whisper': 'reaction-whisper.fbx',
  'point-back': 'reaction-point-back.fbx',

  // Idle fidgets
  'fidget': 'reaction-fidget.fbx',
  'impatient': 'reaction-impatient.fbx',
};

// ─── AnimationController ──────────────────────────────────────────────────────

/**
 * Layered animation controller using Three.js additive blending.
 *
 * Architecture:
 *   Layer 0 (base):     idle.fbx — always playing at weight 1.0, never stops
 *   Layer 1 (posture):  static pose offsets per action (additive, crossfaded)
 *   Layer 2 (activity): task-specific motion loops (additive, staggered fade)
 *   Layer 3 (reaction): one-shot clips fired on events (additive, overlapping)
 *
 * The key insight: transitions shift posture FIRST (immediate), then activity
 * follows after a short stagger delay. This creates natural body motion —
 * the torso settles into position before the hands start working.
 *
 * Public API preserved from the old controller:
 *   playAction(action, intensity)  — called by StateMachine
 *   update(delta)                  — called every frame
 *   stopAll()                      — return to idle
 *   dispose()                      — cleanup
 *   fireReaction(name)             — NEW: trigger one-shot reaction
 */
export class AnimationController {
  private vrm: VRM;
  private mixer: THREE.AnimationMixer | null = null;

  // Reference clip for computing additive deltas
  private idleClip: THREE.AnimationClip | null = null;

  // Layer 0: base idle
  private baseAction: THREE.AnimationAction | null = null;

  // Layer 1: posture additive
  private postureClips = new Map<Action, THREE.AnimationClip>();
  private currentPostureAction: THREE.AnimationAction | null = null;
  private currentPostureKey: Action | null = null;

  // Layer 2: activity additive
  private activityClips = new Map<Action, THREE.AnimationClip>();
  private currentActivityAction: THREE.AnimationAction | null = null;
  private currentActivityKey: Action | null = null;

  // Layer 3: reactions
  private reactionClips = new Map<string, THREE.AnimationClip>();
  private activeReactions = new Set<THREE.AnimationAction>();

  // Stagger state
  private pendingActivity: {
    action: Action;
    intensity: Intensity;
    delayRemaining: number;
  } | null = null;

  // Current state
  private currentAction: Action = 'waiting';
  private loaded = false;

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  // ─── Loading ──────────────────────────────────────────────────────────

  /**
   * Load all animation clips and start the base idle layer.
   * Degrades gracefully — if additive assets are missing, the system
   * still works with just the base idle layer.
   */
  async loadAnimations(): Promise<void> {
    const mixer = new THREE.AnimationMixer(this.vrm.scene);
    this.mixer = mixer;

    // Clean up finished reactions
    mixer.addEventListener('finished', (event) => {
      const action = event.action as THREE.AnimationAction;
      if (this.activeReactions.has(action)) {
        this.activeReactions.delete(action);
        action.stop();
      }
    });

    // ── Layer 0: base idle (MUST succeed) ──
    this.idleClip = await loadMixamoAnimation(animUrl(BASE_FILE), this.vrm);
    this.idleClip.name = 'idle_base';

    this.baseAction = mixer.clipAction(this.idleClip);
    this.baseAction.setLoop(THREE.LoopRepeat, Infinity);
    this.baseAction.play();

    // ── Layer 1: posture clips (extracted from action FBX frame 0) ──
    const postureEntries = Object.entries(POSTURE_FILES) as [Action, string | null][];
    await Promise.allSettled(
      postureEntries.map(async ([action, file]) => {
        if (!file) return;
        try {
          // Load and retarget the full clip
          const fullClip = await loadMixamoAnimation(animUrl(file), this.vrm);
          // Extract frame 0 as a single-frame clip for a static posture
          const poseClip = THREE.AnimationUtils.subclip(fullClip, `posture_${action}`, 0, 1, 30);
          // Make it additive relative to idle
          THREE.AnimationUtils.makeClipAdditive(poseClip, 0, this.idleClip!);
          poseClip.name = `posture_${action}`;
          this.postureClips.set(action, poseClip);
        } catch (err) {
          console.warn(`[AnimCtrl] Posture load failed for "${action}":`, err);
        }
      }),
    );

    // ── Layer 2: activity clips (full animations, additive) ──
    const activityEntries = Object.entries(ACTIVITY_FILES) as [Action, string | null][];
    await Promise.allSettled(
      activityEntries.map(async ([action, file]) => {
        if (!file) return;
        try {
          const clip = await loadAdditiveAnimation(animUrl(file), this.vrm, this.idleClip!);
          clip.name = `activity_${action}`;
          this.activityClips.set(action, clip);
        } catch (err) {
          console.warn(`[AnimCtrl] Activity load failed for "${action}":`, err);
        }
      }),
    );

    // ── Layer 3: reaction clips (additive one-shots) ──
    const reactionEntries = Object.entries(REACTION_FILES);
    await Promise.allSettled(
      reactionEntries.map(async ([name, file]) => {
        try {
          const clip = await loadAdditiveAnimation(animUrl(file), this.vrm, this.idleClip!);
          clip.name = `reaction_${name}`;
          this.reactionClips.set(name, clip);
        } catch (err) {
          console.warn(`[AnimCtrl] Reaction load failed for "${name}":`, err);
        }
      }),
    );

    this.loaded = true;

    console.info(
      `[AnimCtrl] Loaded: base + ${this.postureClips.size} postures, ` +
      `${this.activityClips.size} activities, ${this.reactionClips.size} reactions`,
    );

    // Apply any action that was requested before loading finished
    if (this.currentAction !== 'waiting') {
      this.playAction(this.currentAction, 'medium');
    }
  }

  // ─── Action Transitions ───────────────────────────────────────────────

  /**
   * Transition to a new action state.
   * Posture shifts immediately. Activity follows after a stagger delay.
   */
  playAction(action: Action, intensity: Intensity = 'medium'): void {
    if (!this.loaded) {
      // Store intent — applied when loading completes
      this.currentAction = action;
      return;
    }

    if (action === this.currentAction) {
      // Same action — just update activity weight/speed for intensity change
      if (this.currentActivityAction) {
        this.currentActivityAction.setEffectiveWeight(
          ACTIVITY_WEIGHT * INTENSITY_WEIGHT_SCALE[intensity],
        );
        this.currentActivityAction.setEffectiveTimeScale(INTENSITY_SPEED[intensity]);
      }
      return;
    }

    this.currentAction = action;

    // Phase 1: posture transition (immediate)
    this._transitionPosture(action);

    // Phase 2: activity transition (staggered)
    this.pendingActivity = null; // cancel any pending transition
    if (action === 'waiting') {
      // Going to idle — fade activity out immediately, no stagger
      this._transitionActivity(action, intensity);
    } else {
      this.pendingActivity = {
        action,
        intensity,
        delayRemaining: ACTIVITY_STAGGER,
      };
    }
  }

  /**
   * Fire a one-shot reaction animation.
   * Plays on top of everything, self-cleans when done.
   * Multiple reactions can overlap.
   */
  fireReaction(name: string): void {
    if (!this.loaded || !this.mixer) return;

    const clip = this.reactionClips.get(name);
    if (!clip) {
      console.warn(`[AnimCtrl] Reaction "${name}" not loaded`);
      return;
    }

    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    action.setEffectiveWeight(REACTION_WEIGHT);
    action.fadeIn(REACTION_FADE_IN);
    action.play();

    this.activeReactions.add(action);

    // Schedule fade-out near the end of the clip
    const fadeOutStart = Math.max(0, clip.duration - REACTION_FADE_OUT);
    setTimeout(() => {
      if (this.activeReactions.has(action)) {
        action.fadeOut(REACTION_FADE_OUT);
      }
    }, fadeOutStart * 1000);
  }

  /**
   * Return to idle.
   */
  stopAll(): void {
    this.playAction('waiting', 'medium');
  }

  /**
   * Tick the animation mixer. Call every frame with delta seconds.
   */
  update(delta: number): void {
    if (!this.loaded || !this.mixer) return;

    // Handle staggered activity transition
    if (this.pendingActivity) {
      this.pendingActivity.delayRemaining -= delta;
      if (this.pendingActivity.delayRemaining <= 0) {
        const { action, intensity } = this.pendingActivity;
        this.pendingActivity = null;
        // Only apply if the action hasn't changed during the delay
        if (action === this.currentAction) {
          this._transitionActivity(action, intensity);
        }
      }
    }

    this.mixer.update(delta);
  }

  /**
   * Clean up the mixer and all cached actions.
   */
  dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }
    this.postureClips.clear();
    this.activityClips.clear();
    this.reactionClips.clear();
    this.activeReactions.clear();
    this.currentPostureAction = null;
    this.currentActivityAction = null;
    this.currentPostureKey = null;
    this.currentActivityKey = null;
    this.pendingActivity = null;
    this.loaded = false;
  }

  // ─── Private Layer Transitions ────────────────────────────────────────

  /**
   * Crossfade the posture layer to match a new action.
   * Posture clips are single-frame additive offsets — they hold the body
   * in position while the base layer breathes underneath.
   */
  private _transitionPosture(action: Action): void {
    if (!this.mixer) return;
    if (action === this.currentPostureKey) return;

    this.currentPostureKey = action;

    // Fade out current posture
    if (this.currentPostureAction) {
      const outgoing = this.currentPostureAction;
      outgoing.fadeOut(POSTURE_FADE);
      setTimeout(() => {
        if (this.currentPostureAction !== outgoing) {
          outgoing.stop();
        }
      }, POSTURE_FADE * 1000 + 100);
    }

    // Fade in new posture (or just clear if going to idle)
    const clip = action === 'waiting' ? null : this.postureClips.get(action) ?? null;
    if (clip) {
      const incoming = this.mixer.clipAction(clip);
      incoming.setLoop(THREE.LoopRepeat, Infinity);
      incoming.setEffectiveWeight(POSTURE_WEIGHT);
      incoming.reset();
      incoming.fadeIn(POSTURE_FADE);
      incoming.play();
      this.currentPostureAction = incoming;
    } else {
      this.currentPostureAction = null;
    }
  }

  /**
   * Crossfade the activity layer.
   * Activity clips are full additive loops — the repetitive motion
   * (typing, scanning, talking) that sits on top of the posture.
   */
  private _transitionActivity(action: Action, intensity: Intensity): void {
    if (!this.mixer) return;

    // Same activity, just update weight/speed
    if (action === this.currentActivityKey && this.currentActivityAction) {
      this.currentActivityAction.setEffectiveWeight(
        ACTIVITY_WEIGHT * INTENSITY_WEIGHT_SCALE[intensity],
      );
      this.currentActivityAction.setEffectiveTimeScale(INTENSITY_SPEED[intensity]);
      return;
    }

    this.currentActivityKey = action;

    // Fade out current activity
    if (this.currentActivityAction) {
      const outgoing = this.currentActivityAction;
      outgoing.fadeOut(ACTIVITY_FADE);
      setTimeout(() => {
        if (this.currentActivityAction !== outgoing) {
          outgoing.stop();
        }
      }, ACTIVITY_FADE * 1000 + 100);
    }

    // Fade in new activity
    const clip = action === 'waiting' ? null : this.activityClips.get(action) ?? null;
    if (clip) {
      const incoming = this.mixer.clipAction(clip);

      if (LOOPING_ACTIONS.has(action)) {
        incoming.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        incoming.setLoop(THREE.LoopOnce, 1);
        incoming.clampWhenFinished = true;
      }

      incoming.setEffectiveWeight(ACTIVITY_WEIGHT * INTENSITY_WEIGHT_SCALE[intensity]);
      incoming.setEffectiveTimeScale(INTENSITY_SPEED[intensity]);
      incoming.reset();
      incoming.fadeIn(ACTIVITY_FADE);
      incoming.play();
      this.currentActivityAction = incoming;
    } else {
      this.currentActivityAction = null;
    }
  }
}
