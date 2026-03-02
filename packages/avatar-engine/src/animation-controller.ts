/**
 * AnimationController — weight-based multi-clip blending with body part scoping.
 *
 * v3: Animation groups with weighted random selection.
 *   - Each action has multiple animation groups, each with a rarity weight
 *   - When an action fires, one group is randomly selected
 *   - For looping actions (idle), a new group is selected after each cycle
 *
 * Architecture:
 *   - All clips play simultaneously via AnimationMixer
 *   - Each clip is split into per-body-part sub-clips (track filtering)
 *   - Weights are normalized per group so total influence sums to 1.0
 *   - Expression controller adds blend shapes externally
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Intensity } from '@project-avatar/shared';
import { loadMixamoAnimation } from './mixamo-loader.ts';
import { loadVRMAAnimation } from './vrma-loader.ts';
import type { ClipRegistry, ClipEntry, ClipPropBinding } from './clip-registry.ts';
import { IdleLayer } from './idle-layer.ts';
import type { AssetResolver } from './asset-resolver.ts';
import type { IdleMode, HandGesture } from './idle-layer.ts';
import { BODY_PARTS, BODY_PART_BONES } from './body-parts.ts';
import type { BodyPart } from './body-parts.ts';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_FADE_IN = 0.3;

/** Finger bone name fragments for detecting finger animation tracks. */
const FINGER_BONE_NAMES = [
  'Index', 'Middle', 'Ring', 'Little', 'Thumb',
];
/** In air mode, dampen leg/feet clip weight so idle dangle dominates. */
const AIR_LEG_WEIGHT = 0.45;



// ─── Layer toggles ────────────────────────────────────────────────────────────

export interface LayerState {
  /** FBX clip playback enabled */
  fbxClips: boolean;
  /** Expression blend shapes (happy, sad, etc.) */
  expressions: boolean;
  /** Blink + micro-glance */
  blink: boolean;
  /** Procedural idle layer (hover/breathing) */
  idleLayer: boolean;
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
  idleLayer: true,
};

/** Human-readable labels for each animation layer. */
export const LAYER_LABELS: Record<keyof LayerState, string> = {
  fbxClips: 'FBX Clips',
  expressions: 'Expressions',
  blink: 'Blink',
  idleLayer: 'Idle Layer',
};

// ─── Sub-action: one mixer action per (clip × body-part-group) ────────────────

interface SubAction {
  action: THREE.AnimationAction;
  clipId: string;
  bodyPartGroup: BodyPart;
  /** The configured weight before normalization. */
  baseWeight: number;
  /** Fade out duration from clip config. */
  fadeOut?: number;
}

// ─── AnimationController ──────────────────────────────────────────────────────

export class AnimationController {
  private vrm: VRM;
  private registry: ClipRegistry;
  private mixer: THREE.AnimationMixer;
  private clipCache = new Map<string, THREE.AnimationClip>();
  private assetResolver: AssetResolver | null = null;
  private currentAction: Action = 'idle';
  private currentEmotion: string = 'idle';
  private currentIntensity: Intensity = 'medium';

  /** Currently selected animation group index for the active action. */
  private currentGroupIndex = 0;

  /** Active sub-actions for the current blended action. */
  private activeSubActions: SubAction[] = [];

  /** Whether loadAnimations() has completed. Idle layer is suppressed until then. */
  private _loaded = false;
  private _firstFrameFired = false;
  private _firstFrameCallback: (() => void) | null = null;

  /** Whether all animations have been preloaded. */
  get loaded(): boolean { return this._loaded; }

  /** Timer for non-looping action completion. */
  private durationTimer: ReturnType<typeof setTimeout> | null = null;

  /** Tracks the longest looping clip duration for cycle detection. */
  private loopCycleDuration = 0;

  /** Accumulated time since last loop cycle roll. */
  private loopCycleElapsed = 0;

  /** Whether the current action is looping and has multiple groups. */
  private isLoopCycling = false;

  /** Procedural idle layer — hover/breathing on top of mixer clips. */
  private idleLayer: IdleLayer;

  /** Layer toggle state — dev panel can enable/disable layers. */
  layers: LayerState = { ...DEFAULT_LAYERS };

  /** Get the current idle layer bob offset (for prop sync). */
  getIdleBobOffset(): number {
    return this.idleLayer.getBobOffset();
  }

  /** Callback when a non-looping action completes (used by state machine). */
  onActionFinished?: () => void;

  /** Callback when the active prop binding changes (driven by clip selection). */
  onPropChange?: (binding: ClipPropBinding | undefined) => void;
  /** Callback fired after each individual clip is loaded (for progress tracking). */
  onClipLoaded?: () => void;

  constructor(vrm: VRM, registry: ClipRegistry, assetResolver?: AssetResolver) {
    this.vrm = vrm;
    this.registry = registry;
    this.assetResolver = assetResolver ?? null;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.idleLayer = new IdleLayer(vrm, 'air');
  }

  /**
   * Load all animation clips (FBX and VRMA) referenced in the clip registry.
   * Should be called once after construction, before any playAction calls.
   */
  async loadAnimations(): Promise<void> {
    const files = this.registry.getAllClipFiles();
    const basePath = '/animations/';

    console.info(`[AnimationController] Loading ${files.length} animation clips...`);

    await Promise.all(
      files.map(async (file) => {
        try {
          const rawPath = basePath + file;
          const url = this.assetResolver ? await this.assetResolver.resolve(rawPath) : rawPath;
          const clip = file.toLowerCase().endsWith('.vrma')
            ? await loadVRMAAnimation(url, this.vrm)
            : await loadMixamoAnimation(url, this.vrm);
          clip.name = file;
          this.clipCache.set(file, clip);
          this.onClipLoaded?.();
        } catch (err) {
          console.warn(`[AnimationController] Failed to load ${file}:`, err);
        }
      }),
    );

    console.info(`[AnimationController] Loaded ${this.clipCache.size}/${files.length} clips`);

    // Start idle with a random group
    const groupIndex = this.registry.selectGroup('idle');
    const initGesture = this.registry.getHandGesture('idle', groupIndex) as HandGesture | undefined;
    this.idleLayer.setHandGesture(initGesture ?? 'relaxed');
    this._playBlendedAction('idle', 'idle', 'medium', groupIndex);
    this._loaded = true;
  }

  /**
   * Play an action with the given intensity, influenced by current emotion.
   */
  playAction(action: Action, intensity: Intensity = 'medium', emotion?: string, force?: boolean): void {
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

    // Select a random group for this action
    const groupIndex = this.registry.selectGroup(action);

    // Update idle layer based on action properties
    this._syncIdleLayerState(action, groupIndex);

    this._playBlendedAction(action, this.currentEmotion, intensity, groupIndex);
  }

  /**
   * Play an action with a specific group index (used by clip manager preview).
   * Bypasses random selection to preview a specific animation group.
   */
  playActionWithGroup(action: Action, intensity: Intensity = 'medium', emotion: string = 'idle', groupIndex: number): void {
    this.currentAction = action;
    this.currentIntensity = intensity;
    this.currentEmotion = emotion;

    this._syncIdleLayerState(action, groupIndex);

    this._playBlendedAction(action, emotion, intensity, groupIndex);
  }

  /**
   * Update the current emotion. May change the active clip if the emotion
   * has overrides for the current action.
   */
  setEmotion(emotion: string): void {
    if (emotion === this.currentEmotion) return;
    this.currentEmotion = emotion;
    // Re-resolve with current group (emotion change shouldn't re-roll the group)
    this._playBlendedAction(this.currentAction, emotion, this.currentIntensity, this.currentGroupIndex);
  }

  stopAll(): void {
    this.playAction('idle', 'medium');
  }

  setLayer(layer: keyof LayerState, enabled: boolean): void {
    this.layers[layer] = enabled;

    if (layer === 'idleLayer') {
      this.idleLayer.setEnabled(enabled);
    }

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
      if (!this._firstFrameFired) {
        this._firstFrameFired = true;
        this._firstFrameCallback?.();
        this._firstFrameCallback = null;
      }
      // Check if a looping action's cycle has completed → re-roll group
      if (this.isLoopCycling) {
        this.loopCycleElapsed += dt;
        if (this.loopCycleElapsed >= this.loopCycleDuration) {
          this.loopCycleElapsed = 0;
          const newGroupIndex = this.registry.selectGroup(this.currentAction);
          // Only transition if we actually got a different group
          if (newGroupIndex !== this.currentGroupIndex) {
            this._playBlendedAction(
              this.currentAction,
              this.currentEmotion,
              this.currentIntensity,
              newGroupIndex,
            );
          }
        }
      }
    }

    // Dynamically adjust leg/feet clip weights based on air↔ground blend.
    // In air mode, legs are dampened so idle layer dangle dominates.
    // In ground mode, clips have full leg control.
    // This runs every frame so mode transitions are smooth — no stuck poses.
    this._updateLegWeights();

    // Procedural idle layer: hover bob, breathing, etc.
    // Runs AFTER mixer so additive offsets aren't overwritten by clips.
    // Independent of FBX clips toggle — has its own toggle.
    this.idleLayer.update(dt, this._loaded, this.layers.fbxClips);
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

  /** Set the idle layer mode (air = hovering, ground = breathing/sway). */
  setIdleMode(mode: IdleMode): void {
    this.idleLayer.setMode(mode);
  }

  /** Get the current idle layer mode. */
  getIdleMode(): IdleMode {
    return this.idleLayer.getMode();
  }

  /** Set camera for head tracking in idle layer. */
  setCamera(camera: THREE.Camera): void {
    this.idleLayer.setCamera(camera);
  }

  /** Whether head/eye tracking is currently bypassed (e.g. typing animation). */
  get isHeadTrackingBypassed(): boolean {
    return this.idleLayer.isHeadTrackingBypassed;
  }

  /** Set cursor world-space position for head tracking. */
  setCursorTarget(worldPos: THREE.Vector3 | null): void {
    this.idleLayer.setCursorTarget(worldPos);
  }

  /** Enable/disable the procedural idle layer. */
  setIdleLayerEnabled(enabled: boolean): void {
    this.idleLayer.setEnabled(enabled);
  }

  /** Check if a cached clip has tracks for finger bones. */
  private _clipHasFingerTracks(filename: string): boolean {
    const clip = this.clipCache.get(filename);
    if (!clip) return false;
    return clip.tracks.some((track) =>
      FINGER_BONE_NAMES.some((name) => track.name.includes(name)),
    );
  }

  /** Register a callback to fire after the first mixer update post-load. */
  onFirstFrame(callback: () => void): void {
    if (this._firstFrameFired) {
      callback(); // already happened
    } else {
      this._firstFrameCallback = callback;
    }
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
    this.idleLayer.dispose();
  }

  // ─── Private: blended action playback ───────────────────────────────────

  /**
   * Core blending logic — plays clips from the selected animation group.
   *
   * 1. Select the group's clips (each with body part scoping + weight)
   * 2. For each body part group, collect clips that claim it
   * 3. Normalize weights per group so they sum to 1.0
   * 4. Create sub-actions (one per clip×group) with normalized weights
   * 5. For looping actions with multiple groups, track cycle duration
   */
  private _playBlendedAction(
    action: Action,
    emotion: string,
    intensity: Intensity,
    groupIndex: number,
  ): void {
    if (this.durationTimer !== null) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }

    this.currentGroupIndex = groupIndex;

    // Notify prop change — the primary clip determines the prop
    const propBinding = this.registry.getPropBinding(action, groupIndex);
    this.onPropChange?.(propBinding);
    this.idleLayer.setPropActive(!!propBinding);

    // Resolve incoming clips
    const { clips } = this.registry.resolveClips(action, emotion, intensity, groupIndex);
    let maxFadeIn = DEFAULT_FADE_IN;
    for (const entry of clips) {
      const fi = entry.fadeIn ?? DEFAULT_FADE_IN;
      if (fi > maxFadeIn) maxFadeIn = fi;
    }

    const crossfadeDuration = maxFadeIn;

    // Build a map of outgoing sub-actions by body part for crossFadeTo matching
    const outgoingByGroup = new Map<BodyPart, SubAction[]>();
    for (const sub of this.activeSubActions) {
      const list = outgoingByGroup.get(sub.bodyPartGroup) ?? [];
      list.push(sub);
      outgoingByGroup.set(sub.bodyPartGroup, list);
    }

    const previousSubActions = this.activeSubActions;
    this.activeSubActions = [];

    // Track max clip duration for loop cycling
    let maxClipDuration = 0;

    // Track body parts claimed by new action
    const claimedGroups = new Set<BodyPart>();

    // For each body part group, collect claiming clips and normalize weights
    for (const group of BODY_PARTS) {
      const claiming: { entry: ClipEntry; weight: number }[] = [];
      for (const entry of clips) {
        if (entry.bodyParts.includes(group)) {
          claiming.push({ entry, weight: entry.weight });
        }
      }

      if (claiming.length === 0) continue;

      claimedGroups.add(group);
      const totalWeight = claiming.reduce((sum, c) => sum + c.weight, 0);
      for (const claimed of claiming) {
        const normalizedWeight = totalWeight > 0 ? claimed.weight / totalWeight : 0;
        const sub = this._createSubAction(claimed.entry, group, normalizedWeight, false);
        if (sub) {
          // crossFadeTo from matching outgoing action for smooth warped transition
          const outgoing = outgoingByGroup.get(group);
          const fadeDuration = crossfadeDuration;

          if (outgoing && outgoing.length > 0) {
            const outSub = outgoing.shift()!;
            // crossFadeTo handles weight warping — synchronized fade with no gaps
            outSub.action.crossFadeTo(sub.action, fadeDuration, true);
          } else {
            sub.action.fadeIn(claimed.entry.fadeIn ?? DEFAULT_FADE_IN);
          }

          sub.action.play();
          this.activeSubActions.push(sub);
          const clipDuration = sub.action.getClip().duration;
          if (clipDuration > maxClipDuration) maxClipDuration = clipDuration;
        }
      }
    }

    // For unclaimed body parts, crossfade outgoing actions to idle clip
    // instead of fading to nothing (which causes quaternion spin).
    // Use the first idle clip directly from clip data (not action groups,
    // since action groups may exclude legs/feet for the idle layer).
    const idleFallbackEntry = this._getIdleFallbackClip();
    for (const [group, subs] of outgoingByGroup) {
      if (subs.length === 0) continue;
      const idleEntry = idleFallbackEntry;
      if (idleEntry) {
        const idleSub = this._createSubAction(idleEntry, group, 1.0, true);
        if (idleSub) {
          for (const sub of subs) {
            const fadeDuration = sub.fadeOut ?? DEFAULT_FADE_IN;
            sub.action.crossFadeTo(idleSub.action, fadeDuration, true);
          }
          idleSub.action.play();
          this.activeSubActions.push(idleSub);
          continue;
        }
      }
      // No idle clip for this part — just fade out
      for (const sub of subs) {
        sub.action.fadeOut(sub.fadeOut ?? DEFAULT_FADE_IN);
      }
    }

    // Clean up old actions after crossfade completes
    if (previousSubActions.length > 0) {
      const captured = [...previousSubActions];
      setTimeout(() => {
        const activeClipNames = new Set(
          this.activeSubActions.map((s) => s.action.getClip().name),
        );
        for (const sub of captured) {
          sub.action.stop();
          const clip = sub.action.getClip();
          this.mixer.uncacheAction(clip);
          if (!activeClipNames.has(clip.name)) {
            this.mixer.uncacheClip(clip);
          }
        }
      }, (crossfadeDuration + 0.5) * 1000);
    }

    // Set up loop cycling for looping actions with multiple groups
    const isLooping = this.registry.isActionLooping(action, groupIndex);
    const groupCount = this.registry.getGroupCount(action);
    this.isLoopCycling = isLooping && groupCount > 1;
    this.loopCycleDuration = Math.max(maxClipDuration, 1.0);
    this.loopCycleElapsed = 0;

    // Duration timer for non-looping actions
    if (!isLooping) {
      const duration = this.registry.getActionDuration(action);
      if (duration !== null) {
        this.durationTimer = setTimeout(() => {
          this.durationTimer = null;
          this.onActionFinished?.();
        }, duration * 1000);
      }
    }
  }


  /**
   * Create a sub-action: a mixer action for a specific clip filtered to a single body-part group.
   */
  private _createSubAction(
    entry: ClipEntry,
    group: BodyPart,
    normalizedWeight: number,
    autoPlay: boolean = true,
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
    action.reset();
    // Leg/feet weights are dynamically adjusted in _updateLegWeights()
    // based on air↔ground blend, so we set base weight here.
    action.setEffectiveWeight(normalizedWeight);
    action.setEffectiveTimeScale(1);
    if (autoPlay) {
      action.fadeIn(entry.fadeIn ?? DEFAULT_FADE_IN);
      action.play();
    }

    return {
      action,
      clipId: entry.file,
      bodyPartGroup: group,
      baseWeight: normalizedWeight,
      fadeOut: entry.fadeOut,
    };
  }

  /**
   * Dynamically adjust leg/feet sub-action weights based on air↔ground blend.
   *
   * In air mode (modeBlend → 0), leg/feet clips are dampened to AIR_LEG_WEIGHT
   * so the idle layer’s procedural dangle dominates.
   * In ground mode (modeBlend → 1), clips have full leg control.
   *
   * Runs every frame so transitions are smooth — no stuck leg poses
   * when switching ground → air.
   */
  private _updateLegWeights(): void {
    const blend = this.idleLayer.getModeBlend(); // 0=air, 1=ground
    for (const sub of this.activeSubActions) {
      if (sub.bodyPartGroup === 'legs' || sub.bodyPartGroup === 'feet') {
        // Lerp between dampened (air) and full (ground) weight
        const airWeight = sub.baseWeight * AIR_LEG_WEIGHT;
        const groundWeight = sub.baseWeight;
        const targetWeight = THREE.MathUtils.lerp(airWeight, groundWeight, blend);
        sub.action.setEffectiveWeight(targetWeight);
      }
    }
  }

  /**
   * Sync idle layer state (head tracking bypass, hand gesture, finger tracks) with current action.
   */
  private _syncIdleLayerState(action: Action, groupIndex: number): void {
    const bypass = this.registry.shouldBypassHeadTracking(action);
    this.idleLayer.setBypassHeadTracking(bypass);
    if (this.vrm.lookAt) this.vrm.lookAt.autoUpdate = !bypass;

    // Check if any clip in this action group has finger animation tracks
    const { clips } = this.registry.resolveClips(action, this.currentEmotion, this.currentIntensity, groupIndex);
    const hasFingers = clips.some((clip) => this._clipHasFingerTracks(clip.file));
    this.idleLayer.setClipHasFingers(hasFingers);

    // Only apply procedural hand gesture if clip doesn't have its own fingers
    if (!hasFingers) {
      const gesture = this.registry.getHandGesture(action, groupIndex) as HandGesture | undefined;
      this.idleLayer.setHandGesture(gesture ?? 'relaxed');
    }
  }

  /**
   * Get the first idle clip entry with ALL body parts — used as fallback
   * for unclaimed body parts during transitions.
   */
  private _getIdleFallbackClip(): import('./clip-registry.ts').ClipEntry | null {
    const clipData = this.registry.getClipData('idle');
    if (!clipData) return null;
    return {
      file: clipData.file,
      weight: 1.0,
      loop: clipData.loop,
      fadeIn: clipData.fadeIn,
      fadeOut: clipData.fadeOut,
      bodyParts: ['head', 'torso', 'arms', 'legs', 'feet'],
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
