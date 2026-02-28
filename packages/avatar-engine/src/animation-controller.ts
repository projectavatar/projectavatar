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
 *   const registry = new ClipRegistry(clipsData);
 *   const ctrl = new AnimationController(vrm, registry);
 *   await ctrl.loadAnimations();
 *   ctrl.playAction('waving', 'high', 'excited');
 *   ctrl.update(delta);
 *   ctrl.dispose();
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Emotion, Intensity } from '@project-avatar/shared';
import { loadMixamoAnimation } from './mixamo-loader.ts';
import type { ClipRegistry, ClipEntry } from './clip-registry.ts';
import { evaluateIdleLayer } from './procedural/idle-layer.ts';
import type { AnimBone, BoneState } from './procedural/types.ts';

// ─── Configuration ────────────────────────────────────────────────────────────

const IDLE_INFLUENCE_DURING_CLIP = 0.4;
const IDLE_INFLUENCE_DURING_IDLE = 1.0;
const DEFAULT_FADE_IN = 0.3;
const DEFAULT_FADE_OUT = 0.5;

// ─── Bones for additive idle layer ────────────────────────────────────────────

const IDLE_BONES: AnimBone[] = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
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

/** Info about an active animation clip — exposed for dev panel. */
export interface ActiveClipInfo {
  /** FBX filename */
  name: string;
  /** Current effective blend weight (0–1) */
  weight: number;
  /** Current effective time scale */
  timeScale: number;
  /** Whether this is the primary clip (vs additive layer) */
  isPrimary: boolean;
  /** Whether the clip is looping */
  isLooping: boolean;
  /** Current playback time in seconds */
  time: number;
  /** Total clip duration in seconds */
  duration: number;
}

const DEFAULT_LAYERS: LayerState = {
  fbxClips: true,
  idleNoise: true,
  expressions: true,
  headOffset: true,
  blink: true,
};

/** Human-readable labels for each animation layer. */
export const LAYER_LABELS: Record<keyof LayerState, string> = {
  fbxClips: 'FBX Clips',
  idleNoise: 'Idle Noise',
  expressions: 'Expressions',
  headOffset: 'Head Offset',
  blink: 'Blink',
};

// ─── AnimationController ──────────────────────────────────────────────────────

export class AnimationController {
  private vrm: VRM;
  private registry: ClipRegistry;
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
  /** Rest-pose rotations captured once on init (for reset when FBX off). */
  private restRotations = new Map<AnimBone, THREE.Euler>();

  /** Global elapsed time for idle layer noise. */
  private elapsed = 0;

  /** Reusable frame buffer for idle layer evaluation. */
  private idleBuffer = new Map<AnimBone, BoneState>();

  /** Whether loadAnimations() has completed. Idle layer is suppressed until then. */
  private _loaded = false;

  /** Whether all animations have been preloaded. */
  get loaded(): boolean { return this._loaded; }

  /** Timer for non-looping action completion. */
  private durationTimer: ReturnType<typeof setTimeout> | null = null;

  /** Layer toggle state — dev panel can enable/disable layers. */
  layers: LayerState = { ...DEFAULT_LAYERS };

  /** Callback when a non-looping action completes (used by state machine). */
  onActionFinished?: () => void;

  constructor(vrm: VRM, registry: ClipRegistry) {
    this.vrm = vrm;
    this.registry = registry;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.flipXZ = (vrm.meta as any)?.metaVersion !== '0';
    this._captureBones();
  }

  /**
   * Load all FBX animations referenced in the clip registry.
   * Should be called once after construction, before any playAction calls.
   */
  async loadAnimations(): Promise<void> {
    const files = this.registry.getAllClipFiles();
    const basePath = '/animations/';

    console.info(`[AnimationController] Loading ${files.length} FBX clips...`);

    await Promise.all(
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

    console.info(`[AnimationController] Loaded ${this.clipCache.size}/${files.length} clips`);

    const missing = files.filter((f) => !this.clipCache.has(f));
    if (missing.length > 0) {
      console.error('[AnimationController] Missing clips after load:', missing);
    }

    // Start with idle clip
    this._playClipSet('idle', 'idle', 'medium');
    this._loaded = true;
  }

  /**
   * Play an action with the given intensity, influenced by current emotion.
   */
  playAction(action: Action, intensity: Intensity = 'medium', emotion?: Emotion): void {
    if (emotion !== undefined) {
      this.currentEmotion = emotion;
    }

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
   */
  setEmotion(emotion: Emotion): void {
    if (emotion === this.currentEmotion) return;

    const before = this.registry.resolveClips(this.currentAction, this.currentEmotion, this.currentIntensity);
    const after = this.registry.resolveClips(this.currentAction, emotion, this.currentIntensity);

    this.currentEmotion = emotion;

    if (
      before.primary.file === after.primary.file &&
      before.layers.length === after.layers.length &&
      before.layers.every((l, i) => l.file === after.layers[i]?.file)
    ) {
      return;
    }

    this._playClipSet(this.currentAction, emotion, this.currentIntensity);
  }

  stopAll(): void {
    this.playAction('idle', 'medium');
  }

  setLayer(layer: keyof LayerState, enabled: boolean): void {
    this.layers[layer] = enabled;

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
   */
  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.elapsed += dt;

    if (this.layers.fbxClips && this._loaded) {
      this.mixer.update(dt);
    } else {
      this._resetBonesToRest();
    }

    if (this.layers.idleNoise && this._loaded) {
      this._applyIdleLayer();
    }
  }

  getActiveClips(): ActiveClipInfo[] {
    return this.activeActions
      .filter((a) => a.isRunning() || a.getEffectiveWeight() > 0.001)
      .map((a, i) => ({
        name: a.getClip().name,
        weight: a.getEffectiveWeight(),
        timeScale: a.getEffectiveTimeScale(),
        isPrimary: i === 0,
        isLooping: a.loop === THREE.LoopRepeat,
        time: a.time,
        duration: a.getClip().duration,
      }));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
    this.clipCache.clear();
    this.activeActions.length = 0;
    this.boneNodes.clear();
    this.restPositions.clear();
    this.restRotations.clear();
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
        this.restRotations.set(boneName, node.rotation.clone());
      }
    }
  }

  private _resetBonesToRest(): void {
    for (const [boneName, node] of this.boneNodes) {
      const restRot = this.restRotations.get(boneName);
      const restPos = this.restPositions.get(boneName);
      if (restRot) {
        node.rotation.copy(restRot);
      }
      if (restPos) {
        node.position.copy(restPos);
      }
    }
  }

  private _playClipSet(action: Action, emotion: Emotion, intensity: Intensity): void {
    if (this.durationTimer !== null) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }

    const { primary, layers } = this.registry.resolveClips(action, emotion, intensity);

    const fadeOutDuration = primary.fadeOut ?? DEFAULT_FADE_OUT;
    for (const activeAction of this.activeActions) {
      activeAction.fadeOut(fadeOutDuration);
    }
    this.activeActions = [];

    const primaryAction = this._playClip(primary);
    if (primaryAction) {
      this.activeActions.push(primaryAction);
    }

    for (const layer of layers) {
      const layerAction = this._playClip(layer);
      if (layerAction) {
        this.activeActions.push(layerAction);
      }
    }

    const duration = this.registry.getActionDuration(action);
    if (duration !== null) {
      this.durationTimer = setTimeout(() => {
        this.durationTimer = null;
        this.onActionFinished?.();
      }, duration * 1000);
    }
  }

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

  private _applyIdleLayer(): void {
    const influence = this.currentAction === 'idle'
      ? IDLE_INFLUENCE_DURING_IDLE
      : IDLE_INFLUENCE_DURING_CLIP;

    if (influence <= 0.001) return;

    this.idleBuffer.clear();
    evaluateIdleLayer(this.elapsed, this.idleBuffer, influence);

    const s = this.flipXZ ? -1 : 1;

    for (const [boneName, node] of this.boneNodes) {
      const state = this.idleBuffer.get(boneName);
      if (!state) continue;

      node.rotation.x += state.rx * s;
      node.rotation.y += state.ry;
      node.rotation.z += state.rz * s;

      if (state.px !== 0 || state.py !== 0 || state.pz !== 0) {
        node.position.x += state.px * s;
        node.position.y += state.py;
        node.position.z += state.pz * s;
      }
    }
  }
}
