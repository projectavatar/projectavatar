/**
 * AnimationController — hybrid FBX + procedural animation system.
 *
 * Architecture:
 *   Layer 1 (base):     FBX clip playback via THREE.AnimationMixer
 *   Layer 2 (additive): Procedural idle noise (breathing, sway, head drift)
 *   Layer 3 (external): Expression controller adds blend shapes + head offset
 *
 * The mixer drives the primary motion from Mixamo FBX clips.
 * The procedural idle layer adds organic variation on top — subtle enough
 * to not fight the clip, but enough that no two loops feel identical.
 *
 * Usage:
 *   const ctrl = new AnimationController(vrm);
 *   await ctrl.loadAnimations();   // preloads all FBX clips
 *   ctrl.playAction('waving', 'high', 'excited');
 *   ctrl.update(delta);            // call every frame
 *   ctrl.dispose();
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Emotion, Intensity } from '@project-avatar/shared';
import { loadMixamoAnimation } from './mixamo-loader.ts';
import { resolveClips, getAllClipFiles, getActionDuration } from './clip-map.ts';
import type { ClipEntry } from './clip-map.ts';
import { evaluateIdleLayer } from './procedural/idle-layer.ts';
import type { AnimBone, BoneState } from './procedural/types.ts';

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * When a FBX clip is playing, idle layer influence is reduced.
 * This prevents breathing/sway from fighting the clip's motion.
 * 0 = fully suppressed, 1 = full idle influence.
 */
const IDLE_INFLUENCE_DURING_CLIP = 0.15;

/**
 * Idle layer influence when only the idle clip is playing.
 * Higher because the idle clip is subtle and benefits from extra life.
 */
const IDLE_INFLUENCE_DURING_IDLE = 0.6;

/**
 * Default crossfade duration if not specified in clip entry.
 */
const DEFAULT_FADE_IN = 0.3;
const DEFAULT_FADE_OUT = 0.5;

// ─── Bones for additive idle layer ────────────────────────────────────────────

/**
 * Bones the idle layer may write to. Must be a superset of what
 * evaluateIdleLayer() actually touches — if the idle layer adds
 * new bones, add them here too.
 */
const IDLE_BONES: AnimBone[] = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'rightShoulder',
];

// ─── Layer toggles ────────────────────────────────────────────────────────────

export interface LayerState {
  /** FBX clip playback enabled */
  fbxClips: boolean;
  /** Procedural idle noise (breathing, sway, head drift) */
  idleNoise: boolean;
  /** Expression blend shapes (happy, sad, etc.) */
  expressions: boolean;
  /** Expression head bone offset */
  headOffset: boolean;
  /** Blink + micro-glance */
  blink: boolean;
}

const DEFAULT_LAYERS: LayerState = {
  fbxClips: true,
  idleNoise: true,
  expressions: true,
  headOffset: true,
  blink: true,
};

// ─── AnimationController ──────────────────────────────────────────────────────

export class AnimationController {
  private vrm: VRM;
  private mixer: THREE.AnimationMixer;
  private clipCache = new Map<string, THREE.AnimationClip>();
  private activeActions: THREE.AnimationAction[] = [];
  private currentAction: Action = 'idle';
  private currentEmotion: Emotion = 'idle';
  private currentIntensity: Intensity = 'medium';

  /** VRM 0.x vs 1.0 axis flip for additive idle layer. */
  private flipXZ: boolean;

  /** Bone node references for additive idle layer. */
  private boneNodes = new Map<AnimBone, THREE.Object3D>();
  /** Rest-pose positions captured once on init (for hip translation). */
  private restPositions = new Map<AnimBone, THREE.Vector3>();

  /** Global elapsed time for idle layer noise. */
  private elapsed = 0;

  /** Reusable frame buffer for idle layer evaluation. */
  private idleBuffer = new Map<AnimBone, BoneState>();

  /** Timer for non-looping action completion. */
  private durationTimer: ReturnType<typeof setTimeout> | null = null;

  /** Layer toggle state — dev panel can enable/disable layers. */
  layers: LayerState = { ...DEFAULT_LAYERS };

  /** Callback when a non-looping action completes (used by state machine). */
  onActionFinished?: () => void;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.flipXZ = (vrm.meta as any)?.metaVersion !== '0';
    this._captureBones();
  }

  /**
   * Load all FBX animations referenced in the clip map.
   * Should be called once after construction, before any playAction calls.
   */
  async loadAnimations(): Promise<void> {
    const files = getAllClipFiles();
    const basePath = '/animations/';

    console.info(`[AnimationController] Loading ${files.length} FBX clips...`);

    const results = await Promise.allSettled(
      files.map(async (file) => {
        try {
          const clip = await loadMixamoAnimation(basePath + file, this.vrm);
          clip.name = file;
          this.clipCache.set(file, clip);
        } catch (err) {
          console.warn(`[AnimationController] Failed to load ${file}:`, err);
        }
      }),
    );

    const loaded = results.filter((r) => r.status === 'fulfilled').length;
    console.info(`[AnimationController] Loaded ${loaded}/${files.length} clips`);

    // Dev-mode: warn about any clip-map references that failed to load
    const missing = files.filter((f) => !this.clipCache.has(f));
    if (missing.length > 0) {
      console.error('[AnimationController] Missing clips after load:', missing);
    }

    // Start with idle clip
    this._playClipSet('idle', 'idle', 'medium');
  }

  /**
   * Play an action with the given intensity, influenced by current emotion.
   */
  playAction(action: Action, intensity: Intensity = 'medium', emotion?: Emotion): void {
    if (emotion !== undefined) {
      this.currentEmotion = emotion;
    }

    // Same action with same parameters (including emotion) — skip
    if (
      action === this.currentAction &&
      intensity === this.currentIntensity &&
      (emotion === undefined || emotion === this.currentEmotion)
    ) {
      return;
    }

    this.currentAction = action;
    this.currentIntensity = intensity;

    this._playClipSet(action, this.currentEmotion, intensity);
  }

  /**
   * Update the current emotion. May change the active clip if the emotion
   * has overrides for the current action.
   *
   * Compares resolved clips before and after — only triggers a fade cycle
   * if the actual clip set changes.
   */
  setEmotion(emotion: Emotion): void {
    if (emotion === this.currentEmotion) return;

    // Check if the clip set actually changes before triggering a fade cycle
    const before = resolveClips(this.currentAction, this.currentEmotion, this.currentIntensity);
    const after = resolveClips(this.currentAction, emotion, this.currentIntensity);

    this.currentEmotion = emotion;

    // Compare primary + all layer files
    if (
      before.primary.file === after.primary.file &&
      before.layers.length === after.layers.length &&
      before.layers.every((l, i) => l.file === after.layers[i]?.file)
    ) {
      // Same clips — update emotion state without re-triggering animation
      return;
    }

    // Different clips — trigger crossfade
    this._playClipSet(this.currentAction, emotion, this.currentIntensity);
  }

  /**
   * Stop all animations and return to idle.
   */
  stopAll(): void {
    this.playAction('idle', 'medium');
  }

  /**
   * Set a layer toggle. Used by dev panel.
   */
  setLayer(layer: keyof LayerState, enabled: boolean): void {
    this.layers[layer] = enabled;

    // If FBX clips toggled off, pause the mixer
    if (layer === 'fbxClips') {
      if (!enabled) {
        for (const action of this.activeActions) {
          action.paused = true;
        }
      } else {
        for (const action of this.activeActions) {
          action.paused = false;
        }
      }
    }
  }

  /**
   * Tick the animation system. Call every frame.
   *
   * Order of operations:
   * 1. THREE.AnimationMixer updates bone transforms from FBX clip
   * 2. Idle layer adds procedural noise on top (additive)
   */
  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.elapsed += dt;

    // Step 1: FBX mixer updates bones (if layer enabled)
    if (this.layers.fbxClips) {
      this.mixer.update(dt);
    }

    // Step 2: Additive idle layer on top (if layer enabled)
    if (this.layers.idleNoise) {
      this._applyIdleLayer();
    }
  }

  /**
   * Clean up.
   */
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
    this.clipCache.clear();
    this.activeActions.length = 0;
    this.boneNodes.clear();
    this.restPositions.clear();
    this.idleBuffer.clear();
    if (this.durationTimer !== null) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private _captureBones(): void {
    for (const boneName of IDLE_BONES) {
      const node = this.vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (node) {
        this.boneNodes.set(boneName, node);
        this.restPositions.set(boneName, node.position.clone());
      }
    }
  }

  /**
   * Resolve and play the clip set for an action + emotion + intensity.
   */
  private _playClipSet(action: Action, emotion: Emotion, intensity: Intensity): void {
    // Clear duration timer
    if (this.durationTimer !== null) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }

    const { primary, layers } = resolveClips(action, emotion, intensity);

    // Fade out all current actions
    const fadeOutDuration = primary.fadeOut ?? DEFAULT_FADE_OUT;
    for (const activeAction of this.activeActions) {
      activeAction.fadeOut(fadeOutDuration);
    }
    this.activeActions = [];

    // Play primary clip
    const primaryAction = this._playClip(primary);
    if (primaryAction) {
      this.activeActions.push(primaryAction);
    }

    // Play layer clips
    for (const layer of layers) {
      const layerAction = this._playClip(layer);
      if (layerAction) {
        this.activeActions.push(layerAction);
      }
    }

    // Set up duration timer for non-looping actions
    const duration = getActionDuration(action);
    if (duration !== null) {
      this.durationTimer = setTimeout(() => {
        this.durationTimer = null;
        this.onActionFinished?.();
      }, duration * 1000);
    }
  }

  /**
   * Start playing a single clip entry. Returns the THREE.AnimationAction, or null
   * if the clip wasn't loaded.
   */
  private _playClip(entry: ClipEntry): THREE.AnimationAction | null {
    const clip = this.clipCache.get(entry.file);
    if (!clip) {
      console.warn(`[AnimationController] Clip not loaded: ${entry.file}`);
      return null;
    }

    const action = this.mixer.clipAction(clip);
    action.setLoop(
      entry.loop ? THREE.LoopRepeat : THREE.LoopOnce,
      entry.loop ? Infinity : 1,
    );
    action.clampWhenFinished = !entry.loop;
    action.setEffectiveWeight(entry.weight);
    action.setEffectiveTimeScale(1);
    action.fadeIn(entry.fadeIn ?? DEFAULT_FADE_IN);
    action.reset().play();

    return action;
  }

  /**
   * Apply the procedural idle layer additively on top of the mixer's bone poses.
   *
   * The mixer has already written bone rotations from the FBX clip.
   * We evaluate the idle layer (breathing, sway, head drift) and ADD
   * small euler offsets and position offsets on top for organic variation.
   */
  private _applyIdleLayer(): void {
    // Determine idle influence based on current action
    const influence = this.currentAction === 'idle'
      ? IDLE_INFLUENCE_DURING_IDLE
      : IDLE_INFLUENCE_DURING_CLIP;

    if (influence <= 0.001) return;

    // Evaluate idle layer into buffer
    this.idleBuffer.clear();
    evaluateIdleLayer(this.elapsed, this.idleBuffer, influence);

    // Apply idle offsets additively to bones
    const s = this.flipXZ ? -1 : 1;

    for (const [boneName, node] of this.boneNodes) {
      const state = this.idleBuffer.get(boneName);
      if (!state) continue;

      // Add idle rotation offsets on top of whatever the mixer wrote.
      // Idle values are small (< 0.02 rad) so euler addition is fine.
      node.rotation.x += state.rx * s;
      node.rotation.y += state.ry;
      node.rotation.z += state.rz * s;

      // Add position offsets (hip lateral sway from weight shift)
      if (state.px !== 0 || state.py !== 0 || state.pz !== 0) {
        node.position.x += state.px * s;
        node.position.y += state.py;
        node.position.z += state.pz * s;
      }
    }
  }
}
