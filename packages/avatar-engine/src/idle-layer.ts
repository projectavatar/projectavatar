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
const HOVER_AMPLITUDE   = 0.012;   // meters — primary Y bob
const HOVER_FREQUENCY   = 0.4;     // Hz — slow, dreamy
const HOVER_AMPLITUDE_2 = 0.003;   // meters — secondary bob (smaller)
const HOVER_FREQUENCY_2 = 0.67;    // Hz — slightly faster, incommensurate
const TILT_AMPLITUDE    = 0.03;    // radians (~1.7°) — gentle forward/back lean
const TILT_FREQUENCY    = 0.25;    // Hz — slower than bob for variety
const DRIFT_AMPLITUDE   = 0.02;    // radians — subtle left/right sway
const DRIFT_FREQUENCY   = 0.15;    // Hz — slowest cycle

// Head tracking
const HEAD_TRACK_INFLUENCE = 0.25;  // 0–1 — how much head biases toward camera
const HEAD_TRACK_SPEED     = 2.0;   // lerp speed — smooth follow

// Air mode — leg swap
const LEG_SWAP_MIN       = 20.0;   // seconds — min time before swap
const LEG_SWAP_MAX       = 25.0;   // seconds — max time before swap
const LEG_SWAP_DURATION  = 2.5;    // seconds — slow, natural crossfade

// Air mode — leg dangle
const KNEE_BEND_ANGLE   = 0.15;    // radians — base knee bend
const TOE_DROOP_ANGLE   = 0.14;    // radians — toes pointing slightly down

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
  private head: THREE.Object3D | null = null;

  private initialized = false;

  /** Leg swap blend: 0 = left straight/right tucked, 1 = swapped */
  private legSwapBlend = 0;
  private legSwapTarget = 0;
  private legSwapTimer = 0;

  /** Rest pose rotations — captured once so we can reset before applying. */
  private restRotations = new Map<THREE.Object3D, THREE.Euler>();
  private restPositions = new Map<THREE.Object3D, THREE.Vector3>();

  /** Base Y position for the VRM scene (set by VrmManager). */
  private baseY = -0.4;

  /** Camera reference for subtle head tracking. */
  private camera: THREE.Camera | null = null;

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

  /** Set camera reference for subtle head tracking. */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /**
   * Update procedural idle animation. Call every frame AFTER mixer update.
   *
   * @param delta — frame delta time in seconds
   * @param loaded — whether animation clips have finished loading
   */
  update(delta: number, loaded: boolean, mixerActive: boolean = true): void {
    if (!this.enabled || !this.initialized || !loaded) return;

    // When mixer isn't running, bones don't get reset each frame.
    // We must reset to rest pose before applying additive offsets.
    if (!mixerActive) {
      this._resetToRest();
    }

    this.elapsed += delta;
    const t = this.elapsed;

    if (this.mode === 'air') {
      this._updateAir(t, delta);
    } else {
      this._updateGround(t, delta);
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
    this.head          = get('head');

    this.initialized = !!(this.hips || this.spine || this.chest);

    // Capture rest pose for all bones we modify
    this._captureRestPose();

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

  /** Capture rest pose rotations/positions for bones we modify. */
  private _captureRestPose(): void {
    const bones = [
      this.hips, this.spine, this.chest,
      this.leftUpperLeg, this.rightUpperLeg,
      this.leftLowerLeg, this.rightLowerLeg,
      this.leftFoot, this.rightFoot,
      this.head,
    ];
    for (const bone of bones) {
      if (bone) {
        this.restRotations.set(bone, bone.rotation.clone());
        this.restPositions.set(bone, bone.position.clone());
      }
    }
  }

  /**
   * Reset bones to rest pose before applying idle layer.
   * Only needed when mixer is NOT running (fbxClips off),
   * because the mixer normally overwrites bone transforms each frame.
   */
  private _resetToRest(): void {
    for (const [bone, rot] of this.restRotations) {
      bone.rotation.copy(rot);
    }
    for (const [bone, pos] of this.restPositions) {
      bone.position.copy(pos);
    }
  }

  // ─── Private: air mode ────────────────────────────────────────────────

  private _updateAir(t: number, delta: number): void {
    // 1. Vertical hover bob — applied to VRM scene root (moves entire model)
    if (this.vrm.scene) {
      const bobOffset = Math.sin(t * HOVER_FREQUENCY * Math.PI * 2) * HOVER_AMPLITUDE
                       + Math.sin(t * HOVER_FREQUENCY_2 * Math.PI * 2) * HOVER_AMPLITUDE_2;
      this.vrm.scene.position.y = this.baseY + bobOffset;
    }

    // 2. Smooth hips Y lock — prevent clips from moving the model up/down.
    //    Instead of hard-snapping, lerp toward rest Y to avoid jags
    //    when clips with different hips positions crossfade.
    if (this.hips) {
      if (this.hipsRestY === null) {
        this.hipsRestY = this.hips.position.y;
      }
      // Exponential decay toward rest Y — framerate-independent,
      // no end-of-transition snap like raw lerp.
      const hipsLerpSpeed = 4.0; // higher = faster convergence
      this.hips.position.y = THREE.MathUtils.lerp(
        this.hips.position.y,
        this.hipsRestY,
        1 - Math.exp(-hipsLerpSpeed * delta),
      );
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

    // 5. Leg swap — periodically switch which leg is tucked
    this.legSwapTimer += delta;
    // Random interval between swaps so it feels natural
    const swapInterval = LEG_SWAP_MIN + (LEG_SWAP_MAX - LEG_SWAP_MIN) * 0.5;
    if (this.legSwapTimer >= swapInterval) {
      this.legSwapTimer = Math.random() * (LEG_SWAP_MAX - LEG_SWAP_MIN) * -1; // negative offset for randomness
      this.legSwapTarget = this.legSwapTarget === 0 ? 1 : 0;
    }
    // Smooth blend toward target
    const swapSpeed = 1.0 / LEG_SWAP_DURATION;
    if (this.legSwapBlend < this.legSwapTarget) {
      this.legSwapBlend = Math.min(this.legSwapBlend + swapSpeed * delta, 1);
    } else if (this.legSwapBlend > this.legSwapTarget) {
      this.legSwapBlend = Math.max(this.legSwapBlend - swapSpeed * delta, 0);
    }

    // 6. Leg dangle — relaxed hanging pose
    this._applyLegDangle();

    // 7. Subtle head tracking toward camera
    this._applyHeadTracking(delta);
  }

  // ─── Private: ground mode ─────────────────────────────────────────────

  private _updateGround(t: number, delta: number): void {
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

    // 4. Subtle head tracking toward camera
    this._applyHeadTracking(delta);
  }

  // ─── Private: leg dangle (air mode) ───────────────────────────────────

  // ─── Private: head tracking ──────────────────────────────────────────

  /** Reusable vectors for head tracking math. */
  private _headTargetDir = new THREE.Vector3();
  private _headWorldPos = new THREE.Vector3();
  private _headCurrentYaw = 0;
  private _headCurrentPitch = 0;

  /**
   * Subtle additive head rotation biased toward camera.
   * Blends at HEAD_TRACK_INFLUENCE so clips still dominate.
   */
  private _applyHeadTracking(delta: number): void {
    if (!this.camera || !this.head) return;

    // Get direction from head to camera in world space
    this.head.getWorldPosition(this._headWorldPos);
    this._headTargetDir.copy(this.camera.position).sub(this._headWorldPos).normalize();

    // VRM 0.x (legBendSign === -1): the normalized skeleton faces the opposite
    // direction. Mirror the target direction so the head turns toward camera.
    if (this.legBendSign === -1) {
      this._headTargetDir.negate();
    }

    // Convert world direction to head's parent local space
    const parent = this.head.parent;
    if (!parent) return;

    parent.updateWorldMatrix(true, false);
    const parentInverse = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    this._headTargetDir.transformDirection(parentInverse);

    // Extract yaw (Y) and pitch (X) from the direction
    const targetYaw = Math.atan2(this._headTargetDir.x, this._headTargetDir.z);
    const targetPitch = -Math.asin(
      Math.max(-1, Math.min(1, this._headTargetDir.y))
    );

    // Smooth lerp toward target
    const lerpFactor = 1 - Math.exp(-HEAD_TRACK_SPEED * delta);
    this._headCurrentYaw += (targetYaw - this._headCurrentYaw) * lerpFactor;
    this._headCurrentPitch += (targetPitch - this._headCurrentPitch) * lerpFactor;

    // Apply as additive rotation scaled by influence
    this.head.rotation.y += this._headCurrentYaw * HEAD_TRACK_INFLUENCE;
    this.head.rotation.x += this._headCurrentPitch * HEAD_TRACK_INFLUENCE;
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
      this.leftUpperLeg.rotation.x += KNEE_BEND_ANGLE * 1.1 * this.legBendSign;
    }
    if (this.leftLowerLeg) {
      this.leftLowerLeg.rotation.x += KNEE_BEND_ANGLE * 1.2 * this.legBendSign;
    }

    // Right leg: visibly tucked up — the "casual" leg
    if (this.rightUpperLeg) {
      this.rightUpperLeg.rotation.x += KNEE_BEND_ANGLE * 2.0 * this.legBendSign;
    }
    if (this.rightLowerLeg) {
      this.rightLowerLeg.rotation.x += KNEE_BEND_ANGLE * 1.5 * this.legBendSign;
    }

    // Toes droop — more on the tucked leg
    if (this.leftFoot) {
      this.leftFoot.rotation.x += TOE_DROOP_ANGLE * 2.5 * this.legBendSign;
    }
    if (this.rightFoot) {
      this.rightFoot.rotation.x += TOE_DROOP_ANGLE * 1.5 * this.legBendSign;
    }
  }
}
