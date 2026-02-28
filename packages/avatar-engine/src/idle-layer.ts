/**
 * Idle Layer — procedural animation applied on top of mixer clips.
 *
 * Two modes:
 *   - "ground": breathing (chest expansion), weight shift, micro-sway
 *   - "air": vertical hover bob, gentle body tilt, slow drift
 *
 * Runs every frame AFTER the mixer update but BEFORE expressions.
 * Writes directly to bone transforms (additive on top of mixer pose).
 *
 * The layer is suppressed until animations are loaded to prevent
 * procedural noise on T-pose (which looks horrifying).
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdleMode = 'air' | 'ground';

// ─── Tuning ───────────────────────────────────────────────────────────────────

// Air mode
const HOVER_AMPLITUDE   = 0.015;   // meters — subtle Y bob
const HOVER_FREQUENCY   = 0.4;     // Hz — slow, dreamy
const TILT_AMPLITUDE    = 0.03;    // radians (~1.7°) — gentle forward/back lean
const TILT_FREQUENCY    = 0.25;    // Hz — slower than bob for variety
const DRIFT_AMPLITUDE   = 0.02;    // radians — subtle left/right sway
const DRIFT_FREQUENCY   = 0.15;    // Hz — slowest cycle

// Air mode — leg dangle
const KNEE_BEND_ANGLE   = 0.18;    // radians (~10°) — base knee bend
const TOE_DROOP_ANGLE   = 0.12;    // radians (~7°) — toes pointing slightly down

// Ground mode
const BREATHE_AMPLITUDE = 0.003;   // chest rotation oscillation
const BREATHE_FREQUENCY = 0.2;     // Hz — natural breathing rate
const SWAY_AMPLITUDE    = 0.008;   // radians — micro torso sway
const SWAY_FREQUENCY    = 0.12;    // Hz — slow weight shift
const SHIFT_AMPLITUDE   = 0.003;   // meters — hips side-to-side
const SHIFT_FREQUENCY   = 0.08;    // Hz — very slow weight shift

// ─── IdleLayer ────────────────────────────────────────────────────────────────

export class IdleLayer {
  private vrm: VRM;
  private mode: IdleMode;
  private elapsed = 0;
  private enabled = true;

  // Bone references (cached on init)
  private hips: THREE.Object3D | null = null;
  private spine: THREE.Object3D | null = null;
  private chest: THREE.Object3D | null = null;
  private leftUpperLeg: THREE.Object3D | null = null;
  private rightUpperLeg: THREE.Object3D | null = null;
  private leftLowerLeg: THREE.Object3D | null = null;
  private rightLowerLeg: THREE.Object3D | null = null;
  private leftFoot: THREE.Object3D | null = null;
  private rightFoot: THREE.Object3D | null = null;

  private initialized = false;

  /** Base Y position for the VRM scene (set by VrmManager). */
  private baseY = -0.4;

  /** Hips rest Y position — captured once after first mixer update. */
  private hipsRestY: number | null = null;

  /**
   * Sign multiplier for leg bend direction (+1 or -1).
   * Detected from the bone chain geometry — some VRM models have flipped axes.
   */
  private legBendSign = 1;

  constructor(vrm: VRM, mode: IdleMode = 'air') {
    this.vrm = vrm;
    this.mode = mode;
    this.baseY = vrm.scene.position.y;
    this._buildBones();
  }

  /** Change idle mode at runtime. */
  setMode(mode: IdleMode): void {
    this.mode = mode;
  }

  /** Get current mode. */
  getMode(): IdleMode {
    return this.mode;
  }

  /** Enable/disable the idle layer. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update procedural idle animation. Call every frame AFTER mixer update.
   *
   * @param delta — frame delta time in seconds
   * @param loaded — whether animation clips have finished loading
   */
  update(delta: number, loaded: boolean): void {
    if (!this.enabled || !this.initialized || !loaded) return;

    this.elapsed += delta;
    const t = this.elapsed;

    if (this.mode === 'air') {
      this._updateAir(t);
    } else {
      this._updateGround(t);
    }
  }

  dispose(): void {
    // Reset scene Y in case we were in air mode
    if (this.vrm.scene) {
      this.vrm.scene.position.y = this.baseY;
    }
  }

  // ─── Private: bone setup ──────────────────────────────────────────────

  private _buildBones(): void {
    const h = this.vrm.humanoid;
    if (!h) {
      console.warn('[IdleLayer] No humanoid — disabled');
      return;
    }

    const get = (name: string) => h.getNormalizedBoneNode(name as any);

    this.hips          = get('hips');
    this.spine         = get('spine');
    this.chest         = get('chest') ?? get('upperChest');
    this.leftUpperLeg  = get('leftUpperLeg');
    this.rightUpperLeg = get('rightUpperLeg');
    this.leftLowerLeg  = get('leftLowerLeg');
    this.rightLowerLeg = get('rightLowerLeg');
    this.leftFoot      = get('leftFoot');
    this.rightFoot     = get('rightFoot');

    this.initialized = !!(this.hips || this.spine || this.chest);

    // Detect leg bend direction from bone chain geometry.
    // Compare upper leg and lower leg world Y positions — if the lower leg
    // is below the upper leg, a positive X rotation should bend the knee
    // backward (normal). If the axis is flipped, we negate.
    this._detectLegBendDirection();
  }

  /**
   * Detect which direction positive X rotation bends the knee.
   * We do a small test rotation on the upper leg and check if the
   * lower leg moves forward (wrong) or backward (correct).
   */
  private _detectLegBendDirection(): void {
    if (!this.leftUpperLeg || !this.leftLowerLeg) return;

    const _v = new THREE.Vector3();

    // Capture lower leg world Z before rotation
    this.vrm.scene.updateMatrixWorld(true);
    this.leftLowerLeg.getWorldPosition(_v);
    const zBefore = _v.z;

    // Apply a small positive X rotation to upper leg
    const testAngle = 0.1;
    this.leftUpperLeg.rotation.x += testAngle;
    this.vrm.scene.updateMatrixWorld(true);
    this.leftLowerLeg.getWorldPosition(_v);
    const zAfter = _v.z;

    // Undo the test rotation
    this.leftUpperLeg.rotation.x -= testAngle;
    this.vrm.scene.updateMatrixWorld(true);

    // If the lower leg moved forward (positive Z in VRM 1.0 = toward camera),
    // the knee bent forward — wrong direction, so we flip.
    // For a correct backward bend, Z should decrease (move away from camera).
    const zDelta = zAfter - zBefore;
    if (zDelta > 0) {
      // Positive X rotation moved knee forward — flip it
      this.legBendSign = -1;
      console.info('[IdleLayer] Detected flipped leg axis — using negative bend');
    } else {
      this.legBendSign = 1;
      console.info('[IdleLayer] Detected normal leg axis — using positive bend');
    }
  }

  // ─── Private: air mode ────────────────────────────────────────────────

  private _updateAir(t: number): void {
    // 1. Vertical hover bob — applied to VRM scene root (moves entire model)
    if (this.vrm.scene) {
      const bobOffset = Math.sin(t * HOVER_FREQUENCY * Math.PI * 2) * HOVER_AMPLITUDE;
      this.vrm.scene.position.y = this.baseY + bobOffset;
    }

    // 2. Pin hips Y — prevent clips from moving the model up/down.
    //    Mixer writes hips position every frame (root motion); we override
    //    the Y component to keep the model locked to the hover plane.
    if (this.hips) {
      if (this.hipsRestY === null) {
        // Capture rest Y on first frame after mixer has written pose
        this.hipsRestY = this.hips.position.y;
      }
      this.hips.position.y = this.hipsRestY;
    }

    // 3. Gentle body tilt — spine leans forward/back
    if (this.spine) {
      const tiltX = Math.sin(t * TILT_FREQUENCY * Math.PI * 2) * TILT_AMPLITUDE;
      this.spine.rotation.x += tiltX;
    }

    // 4. Slow left/right drift — hips sway
    if (this.hips) {
      const driftZ = Math.sin(t * DRIFT_FREQUENCY * Math.PI * 2) * DRIFT_AMPLITUDE;
      this.hips.rotation.z += driftZ;
    }

    // 5. Leg dangle — relaxed hanging pose
    this._applyLegDangle();
  }

  // ─── Private: ground mode ─────────────────────────────────────────────

  private _updateGround(t: number): void {
    // Ensure scene Y is at ground level
    if (this.vrm.scene) {
      this.vrm.scene.position.y = this.baseY;
    }

    // 1. Breathing — chest subtle rotation oscillation
    if (this.chest) {
      const breathe = Math.sin(t * BREATHE_FREQUENCY * Math.PI * 2) * BREATHE_AMPLITUDE;
      this.chest.rotation.x += breathe;
    }

    // 2. Torso micro-sway — gentle left/right
    if (this.spine) {
      const sway = Math.sin(t * SWAY_FREQUENCY * Math.PI * 2) * SWAY_AMPLITUDE;
      this.spine.rotation.z += sway;
    }

    // 3. Weight shift — hips side-to-side translation
    if (this.hips) {
      const shift = Math.sin(t * SHIFT_FREQUENCY * Math.PI * 2) * SHIFT_AMPLITUDE;
      this.hips.position.x += shift;
    }
  }

  // ─── Private: leg dangle (air mode) ───────────────────────────────────

  /**
   * Apply a relaxed dangle pose to legs — slight knee bend + toe droop.
   * Additive on top of whatever the mixer wrote.
   * Slight asymmetry between left/right for natural look.
   */
  private _applyLegDangle(): void {
    // Left leg: relaxed, mostly straight — the "weight-bearing" leg
    if (this.leftUpperLeg) {
      this.leftUpperLeg.rotation.x += KNEE_BEND_ANGLE * 1.12 * this.legBendSign;
    }
    if (this.leftLowerLeg) {
      this.leftLowerLeg.rotation.x += KNEE_BEND_ANGLE * 1.4 * this.legBendSign;
    }

    // Right leg: visibly tucked up — the "casual" leg
    if (this.rightUpperLeg) {
      this.rightUpperLeg.rotation.x += KNEE_BEND_ANGLE * 2.52 * this.legBendSign;
    }
    if (this.rightLowerLeg) {
      this.rightLowerLeg.rotation.x += KNEE_BEND_ANGLE * 3.5 * this.legBendSign;
    }

    // Toes droop — more on the tucked leg
    if (this.leftFoot) {
      this.leftFoot.rotation.x += TOE_DROOP_ANGLE * 3.0 * this.legBendSign;
    }
    if (this.rightFoot) {
      this.rightFoot.rotation.x += TOE_DROOP_ANGLE * 1.5 * this.legBendSign;
    }
  }
}
