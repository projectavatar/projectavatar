/**
 * AnimationController — weight-based multi-clip blending with body part scoping.
 *
 * Architecture:
 *   - Idle clip always plays as base layer (full body, weight 1.0)
 *   - Action clips play simultaneously, each scoped to body part groups
 *   - Each clip is split into sub-actions per body-part group for independent weight control
 *   - Per-group weight normalization ensures total influence always sums to 1.0
 *   - Expression controller adds blend shapes externally
 *
 * Blending model (inspired by three.js webgl_animation_skinning_blending):
 *   All clips play simultaneously via AnimationMixer. Each clip is split into
 *   per-body-part sub-clips (track filtering). Weights are normalized per group
 *   so that if only idle owns legs, legs play at full idle strength.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Emotion, Intensity } from '@project-avatar/shared';
import { loadMixamoAnimation } from './mixamo-loader.ts';
import type { ClipRegistry, ClipEntry } from './clip-registry.ts';
import { BODY_PARTS, BODY_PART_BONES } from './body-parts.ts';
import type { BodyPart } from './body-parts.ts';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_FADE_IN = 0.3;
const DEFAULT_FADE_OUT = 0.5;

// ─── Layer toggles ────────────────────────────────────────────────────────────

export interface LayerState {
  /** FBX clip playback enabled */
  fbxClips: boolean;
  /** Expression blend shapes (happy, sad, etc.) */
  expressions: boolean;
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
  /** Whether the clip is looping */
  isLooping: boolean;
  /** Current playback time in seconds */
  time: number;
  /** Total clip duration in seconds */
  duration: number;
  /** Body part group this sub-action covers */
  bodyPartGroup?: string;
}

const DEFAULT_LAYERS: LayerState = {
  fbxClips: true,
  expressions: true,
  blink: true,
};

/** Human-readable labels for each animation layer. */
export const LAYER_LABELS: Record<keyof LayerState, string> = {
  fbxClips: 'FBX Clips',
  expressions: 'Expressions',
  blink: 'Blink',
};

// ─── Sub-action: one mixer action per (clip × body-part-group) ────────────────

interface SubAction {
  action: THREE.AnimationAction;
  clipId: string;
  bodyPartGroup: BodyPart;
  /** The configured weight before normalization. */
  baseWeight: number;
}

// ─── AnimationController ──────────────────────────────────────────────────────

export class AnimationController {
  private vrm: VRM;
  private registry: ClipRegistry;
  private mixer: THREE.AnimationMixer;
  private clipCache = new Map<string, THREE.AnimationClip>();
  private currentAction: Action = 'idle';
  private currentEmotion: Emotion = 'idle';
  private currentIntensity: Intensity = 'medium';

  /** Active sub-actions for the current blended action. */
  private activeSubActions: SubAction[] = [];

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

    // Start idle
    this._playBlendedAction('idle', 'idle', 'medium');
    this._loaded = true;
  }

  /**
   * Play an action with the given intensity, influenced by current emotion.
   */
  playAction(action: Action, intensity: Intensity = 'medium', emotion?: Emotion, force?: boolean): void {
    if (emotion !== undefined) {
      this.currentEmotion = emotion;
    }

    if (
      action === this.currentAction && !force &&
      intensity === this.currentIntensity &&
      (emotion === undefined || emotion === this.currentEmotion)
    ) {
      return;
    }

    this.currentAction = action;
    this.currentIntensity = intensity;

    this._playBlendedAction(action, this.currentEmotion, intensity);
  }

  /**
   * Update the current emotion. May change the active clip if the emotion
   * has overrides for the current action.
   */
  setEmotion(emotion: Emotion): void {
    if (emotion === this.currentEmotion) return;
    this.currentEmotion = emotion;
    // Re-resolve in case emotion changes clip selection
    this._playBlendedAction(this.currentAction, emotion, this.currentIntensity);
  }

  stopAll(): void {
    this.playAction('idle', 'medium');
  }

  setLayer(layer: keyof LayerState, enabled: boolean): void {
    this.layers[layer] = enabled;

    if (layer === 'fbxClips') {
      const allSubs = this.activeSubActions;
      for (const sub of allSubs) {
        sub.action.paused = !enabled;
      }
    }
  }

  /**
   * Tick the animation system. Call every frame.
   */
  update(delta: number): void {
    const dt = Math.min(delta, 0.1);

    if (this.layers.fbxClips && this._loaded) {
      this.mixer.update(dt);
    }

  }

  getActiveClips(): ActiveClipInfo[] {
    const result: ActiveClipInfo[] = [];
    const allSubs = this.activeSubActions;

    for (const sub of allSubs) {
      if (sub.action.isRunning() || sub.action.getEffectiveWeight() > 0.001) {
        result.push({
          name: sub.action.getClip().name,
          weight: sub.action.getEffectiveWeight(),
          timeScale: sub.action.getEffectiveTimeScale(),
          isLooping: sub.action.loop === THREE.LoopRepeat,
          time: sub.action.time,
          duration: sub.action.getClip().duration,
          bodyPartGroup: sub.bodyPartGroup,
        });
      }
    }

    return result;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
    this.clipCache.clear();
    this.activeSubActions.length = 0;
    if (this.durationTimer !== null) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }

  // ─── Private: bone setup ────────────────────────────────────────────────

  // ─── Private: blended action playback ───────────────────────────────────

  /**
   * Core blending logic — explicit clips only.
   *
   * 1. Resolve the action's clips (each with body part scoping + weight)
   * 2. For each body part group, collect clips that claim it
   * 3. Normalize weights per group so they sum to 1.0
   * 4. Create sub-actions (one per clip×group) with normalized weights
   */
  /**
   * Core blending logic — explicit clips only, no implicit idle.
   *
   * 1. Resolve the action's clips (each with body part scoping + weight)
   * 2. For each body part group, collect clips that claim it
   * 3. Normalize weights per group so they sum to 1.0
   * 4. Create sub-actions (one per clip×group) with normalized weights
   *
   * If you want idle blended into an action, add the idle clip explicitly
   * to that action's clips[] in clips.json.
   */
  private _playBlendedAction(action: Action, emotion: Emotion, intensity: Intensity): void {
    if (this.durationTimer !== null) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }

    // Fade out and uncache old sub-actions (prevents mixer memory leak)
    for (const sub of this.activeSubActions) {
      sub.action.fadeOut(DEFAULT_FADE_OUT);
      const clip = sub.action.getClip();
      setTimeout(() => {
        this.mixer.uncacheClip(clip);
        this.mixer.uncacheAction(clip);
      }, (DEFAULT_FADE_OUT + 0.1) * 1000);
    }
    this.activeSubActions = [];

    // Resolve action clips
    const { clips } = this.registry.resolveClips(action, emotion, intensity);

    // For each body part group, collect claiming clips and normalize weights
    for (const group of BODY_PARTS) {
      const claiming: { entry: ClipEntry; weight: number }[] = [];
      for (const entry of clips) {
        if (entry.bodyParts.includes(group)) {
          claiming.push({ entry, weight: entry.weight });
        }
      }

      if (claiming.length === 0) continue; // No clip covers this group — rest pose

      // Normalize so weights sum to 1.0
      const totalWeight = claiming.reduce((sum, c) => sum + c.weight, 0);
      for (const claimed of claiming) {
        const normalizedWeight = totalWeight > 0 ? claimed.weight / totalWeight : 0;
        const sub = this._createSubAction(claimed.entry, group, normalizedWeight);
        if (sub) this.activeSubActions.push(sub);
      }
    }

    // Duration timer for non-looping actions
    const duration = this.registry.getActionDuration(action);
    if (duration !== null) {
      this.durationTimer = setTimeout(() => {
        this.durationTimer = null;
        this.onActionFinished?.();
      }, duration * 1000);
    }
  }

  /**
   * Create a sub-action: a mixer action for a specific clip filtered to a single body-part group.
   */
  private _createSubAction(
    entry: ClipEntry,
    group: BodyPart,
    normalizedWeight: number,
  ): SubAction | null {
    const fullClip = this.clipCache.get(entry.file);
    if (!fullClip) {
      console.warn(`[AnimationController] Clip not loaded: ${entry.file}`);
      return null;
    }

    // Filter tracks to only include bones in this group
    const filteredClip = this._filterClipToGroup(fullClip, group);
    if (filteredClip.tracks.length === 0) return null;

    const action = this.mixer.clipAction(filteredClip);
    action.setLoop(
      entry.loop ? THREE.LoopRepeat : THREE.LoopOnce,
      entry.loop ? Infinity : 1,
    );
    action.clampWhenFinished = !entry.loop;
    action.setEffectiveWeight(normalizedWeight);
    action.setEffectiveTimeScale(1);
    action.fadeIn(entry.fadeIn ?? DEFAULT_FADE_IN);
    action.reset().play();

    return {
      action,
      clipId: entry.file,
      bodyPartGroup: group,
      baseWeight: normalizedWeight,
    };
  }

  /**
   * Filter an animation clip to only include tracks for bones in the given body part group.
   * Creates a new clip with a unique name so the mixer caches it separately.
   */
  private _filterClipToGroup(clip: THREE.AnimationClip, group: BodyPart): THREE.AnimationClip {
    const groupBones = BODY_PART_BONES[group];
    const groupNodeNames = new Set<string>();

    for (const boneName of groupBones) {
      const node = this.vrm.humanoid?.getNormalizedBoneNode(boneName as any);
      if (node) groupNodeNames.add(node.name);
    }

    const filteredTracks = clip.tracks.filter((track) => {
      const dotIdx = track.name.indexOf('.');
      if (dotIdx === -1) return false;
      const nodeName = track.name.slice(0, dotIdx);
      return groupNodeNames.has(nodeName);
    });

    return new THREE.AnimationClip(
      `${clip.name}:${group}`,
      clip.duration,
      filteredTracks,
    );
  }

}
