/**
 * Procedural Animation Engine
 *
 * The core orchestrator that replaces Three.js AnimationMixer entirely.
 * Every frame it:
 * 1. Applies base standing pose (T-pose → natural)
 * 2. Evaluates the idle layer (always running)
 * 3. Evaluates the active recipe (if any)
 * 4. Blends them based on recipe fade weight
 * 5. Writes final bone rotations to the VRM skeleton
 *
 * No FBX files. No mixer. No retargeting. Just math → bones.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Intensity } from '@project-avatar/shared';
import type {
  AnimBone,
  BoneState,
  Recipe,
  Primitive,
  SpringState,
} from './types.ts';
import { RECIPES } from './recipes.ts';
import { BASE_POSE } from './base-pose.ts';
import { evaluateIdleLayer } from './idle-layer.ts';
import {
  evalOscillate,
  evalReach,
  evalRecoil,
  evalNoise,
  evalPositionOscillate,
} from './primitives.ts';
import { stepSpring, createSpring } from './spring.ts';

// ─── Configuration ────────────────────────────────────────────────────────────

const INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.3,
};

/** During an active recipe, idle layer influence is reduced to this. */
const IDLE_SUPPRESSION = 0.3;

/** All animatable VRM bone names. */
const ALL_BONES: AnimBone[] = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg',
  'leftLowerLeg', 'rightLowerLeg',
];

// ─── Engine ───────────────────────────────────────────────────────────────────

export class ProceduralEngine {
  private vrm: VRM;
  private boneNodes = new Map<AnimBone, THREE.Object3D>();
  /** Rest-pose rotations captured once on init. */
  private restPoses = new Map<AnimBone, THREE.Euler>();
  private restPositions = new Map<AnimBone, THREE.Vector3>();

  /**
   * VRM 0.x vs 1.0: base pose, recipes, and idle layer are all authored in
   * VRM 0.x retarget convention. For VRM 1.0 normalized bones, X and Z axes
   * are inverted. We detect once and flip at write time.
   */
  private flipXZ: boolean;

  /** Global elapsed time (never resets). */
  private elapsed = 0;

  /** Currently active recipe. */
  private activeRecipe: Recipe | null = null;
  private activeAction: Action = 'idle';
  /** Time since the current recipe started playing. */
  private recipeElapsed = 0;
  /** Current blend weight of the active recipe (0–1, managed by fade). */
  private recipeWeight = 0;
  /** Target blend weight (1 when active, 0 when fading out). */
  private recipeWeightTarget = 0;
  /** Fade speed (1 / fadeDuration) — how fast we approach target. */
  private fadeInSpeed = 1 / 0.3;
  private fadeOutSpeed = 1 / 0.5;

  /** Whether we're currently fading out (recipe ending). */
  private fadingOut = false;

  /** Intensity scale applied to recipe amplitudes. */
  private intensityScale = 1.0;

  /** Per-bone spring states for spring primitives. */
  private springs = new Map<string, SpringState>();

  /** Reusable frame buffer — bone state accumulator. */
  private frameBuffer = new Map<AnimBone, BoneState>();

  /** Callback when a non-looping recipe finishes (used by AnimationController). */
  onRecipeFinished?: () => void;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    // VRM 0.x: metaVersion === '0'. VRM 1.0: metaVersion === '1'.
    // Values are authored for VRM 0.x — flip X/Z for VRM 1.0.
    this.flipXZ = (vrm.meta as any)?.metaVersion !== '0';
    this._captureBones();
  }

  /**
   * Set the active recipe for an action.
   * Fades out the current recipe and fades in the new one.
   */
  play(action: Action, intensity: Intensity = 'medium'): void {
    // Same action — just update intensity
    if (action === this.activeAction && !this.fadingOut) {
      this.intensityScale = INTENSITY_SCALE[intensity];
      return;
    }

    const recipe = RECIPES[action];
    if (!recipe) return;

    // If switching to idle, just fade out current
    if (action === 'idle') {
      this.fadingOut = true;
      this.recipeWeightTarget = 0;
      this.activeAction = 'idle';
      return;
    }

    this.activeRecipe = recipe;
    this.activeAction = action;
    this.recipeElapsed = 0;
    this.recipeWeight = 0;
    this.recipeWeightTarget = 1;
    this.fadingOut = false;
    this.intensityScale = INTENSITY_SCALE[intensity];
    this.fadeInSpeed = 1 / (recipe.fadeIn ?? 0.3);
    this.fadeOutSpeed = 1 / (recipe.fadeOut ?? 0.5);
    this.springs.clear();
  }

  /**
   * Evaluate all layers and write bone rotations. Call every frame.
   *
   * @param delta Frame delta time in seconds
   */
  update(delta: number): void {
    // Clamp delta to prevent explosion after tab-switch
    const dt = Math.min(delta, 0.1);

    this.elapsed += dt;
    this.recipeElapsed += dt;

    // ── Update recipe blend weight ──
    this._updateFade(dt);

    // ── Check for non-looping recipe completion ──
    if (
      this.activeRecipe &&
      !this.fadingOut &&
      this.activeRecipe.loop === false &&
      this.activeRecipe.duration &&
      this.recipeElapsed >= this.activeRecipe.duration
    ) {
      // Start fading out
      this.fadingOut = true;
      this.recipeWeightTarget = 0;
    }

    // ── Clear frame buffer ──
    this.frameBuffer.clear();

    // ── Evaluate idle layer ──
    const idleInfluence = this.recipeWeight > 0.001
      ? 1 - this.recipeWeight * (1 - IDLE_SUPPRESSION)
      : 1;
    evaluateIdleLayer(this.elapsed, this.frameBuffer, idleInfluence);

    // ── Evaluate active recipe ──
    if (this.activeRecipe && this.recipeWeight > 0.001) {
      this._evaluateRecipe(this.activeRecipe, this.recipeElapsed, this.recipeWeight);
    }

    // ── Write to bones ──
    this._writeBones();
  }

  /** Stop everything and return to idle. */
  stop(): void {
    this.play('idle', 'medium');
  }

  /** Clean up. */
  dispose(): void {
    this.boneNodes.clear();
    this.restPoses.clear();
    this.restPositions.clear();
    this.springs.clear();
    this.frameBuffer.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────────

  /** Capture VRM bone references and rest poses once. */
  private _captureBones(): void {
    for (const boneName of ALL_BONES) {
      const node = this.vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (node) {
        this.boneNodes.set(boneName, node);
        this.restPoses.set(boneName, node.rotation.clone());
        this.restPositions.set(boneName, node.position.clone());
      }
    }
  }

  /** Smooth fade of recipe blend weight toward target. */
  private _updateFade(dt: number): void {
    const speed = this.fadingOut ? this.fadeOutSpeed : this.fadeInSpeed;
    const diff = this.recipeWeightTarget - this.recipeWeight;

    if (Math.abs(diff) < 0.001) {
      this.recipeWeight = this.recipeWeightTarget;

      // If we finished fading out, clean up
      if (this.fadingOut && this.recipeWeight <= 0) {
        this.activeRecipe = null;
        this.fadingOut = false;
        this.onRecipeFinished?.();
      }
      return;
    }

    // Exponential approach
    this.recipeWeight += diff * (1 - Math.exp(-speed * 3 * dt));
  }

  /** Evaluate a recipe and add results to frameBuffer. */
  private _evaluateRecipe(recipe: Recipe, elapsed: number, weight: number): void {
    const scale = weight * this.intensityScale;

    for (const boneTarget of recipe.bones) {
      let rx = 0, ry = 0, rz = 0;

      for (const prim of boneTarget.primitives) {
        const value = this._evalPrimitive(prim, elapsed, boneTarget.bone);
        if (prim.kind === 'hold') continue;
        const axis = (prim as any).axis as string;
        if (axis === 'x') rx += value;
        else if (axis === 'y') ry += value;
        else if (axis === 'z') rz += value;
      }

      this._addToBuffer(boneTarget.bone, rx * scale, ry * scale, rz * scale, 0, 0, 0);
    }

    // Position targets (hips translation)
    if (recipe.positions) {
      for (const posTarget of recipe.positions) {
        let px = 0, py = 0, pz = 0;
        for (const prim of posTarget.primitives) {
          const value = evalPositionOscillate(prim, elapsed);
          if (prim.axis === 'x') px += value;
          else if (prim.axis === 'y') py += value;
          else pz += value;
        }
        this._addToBuffer(posTarget.bone, 0, 0, 0, px * scale, py * scale, pz * scale);
      }
    }
  }

  /** Evaluate a single primitive. */
  private _evalPrimitive(prim: Primitive, elapsed: number, bone: AnimBone): number {
    switch (prim.kind) {
      case 'oscillate':
        return evalOscillate(prim, elapsed);
      case 'reach':
        return evalReach(prim, elapsed);
      case 'recoil':
        return evalRecoil(prim, elapsed);
      case 'noise':
        return evalNoise(prim, this.elapsed); // Use global elapsed for noise continuity
      case 'spring': {
        const key = `${bone}_${prim.axis}`;
        let state = this.springs.get(key);
        if (!state) {
          state = createSpring(0);
          this.springs.set(key, state);
        }
        return stepSpring(state, prim.target, prim.stiffness ?? 12, prim.damping ?? 0.7, 1 / 60);
      }
      case 'hold':
        return 0;
    }
  }

  /** Add rotation/position to the frame buffer for a bone. */
  private _addToBuffer(
    bone: AnimBone,
    rx: number, ry: number, rz: number,
    px: number, py: number, pz: number,
  ): void {
    let state = this.frameBuffer.get(bone);
    if (!state) {
      state = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 };
      this.frameBuffer.set(bone, state);
    }
    state.rx += rx;
    state.ry += ry;
    state.rz += rz;
    state.px += px;
    state.py += py;
    state.pz += pz;
  }

  /**
   * Write accumulated frame buffer to VRM bones.
   * Applies as REST POSE + accumulated offsets.
   */
  private _writeBones(): void {
    // All values (base pose, idle layer, recipes) are in VRM 0.x convention.
    // For VRM 1.0 models, negate X and Z to convert coordinate systems.
    const s = this.flipXZ ? -1 : 1;

    for (const [boneName, node] of this.boneNodes) {
      const rest = this.restPoses.get(boneName);
      const state = this.frameBuffer.get(boneName);
      const base = BASE_POSE[boneName];

      if (rest) {
        const ox = (base?.x ?? 0) + (state?.rx ?? 0);
        const oy = (base?.y ?? 0) + (state?.ry ?? 0);
        const oz = (base?.z ?? 0) + (state?.rz ?? 0);
        node.rotation.set(
          rest.x + ox * s,
          rest.y + oy,
          rest.z + oz * s,
        );
      }

      if (state && (state.px !== 0 || state.py !== 0 || state.pz !== 0)) {
        const restPos = this.restPositions.get(boneName);
        if (restPos) {
          node.position.set(
            restPos.x + state.px * s,
            restPos.y + state.py,
            restPos.z + state.pz * s,
          );
        }
      }
    }
  }
}
