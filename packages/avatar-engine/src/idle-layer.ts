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
const BACKWARD_LEAN     = 0.15;    // radians (~8.6°) — static backward lean to balance tucked legs
const DRIFT_FREQUENCY   = 0.15;    // Hz — slowest cycle

// Head tracking
const HEAD_TRACK_INFLUENCE = 0.35;  // 0–1 — how much head biases toward camera
const HEAD_TRACK_SPEED     = 2.0;   // lerp speed — smooth follow

// Air mode — leg swap
// Relaxed finger curl — natural resting hand pose
// Finger wave — subtle sine oscillation on curl
const FINGER_WAVE_FREQ     = 0.12;   // Hz — slow, dreamy
const FINGER_WAVE_AMOUNT   = 0.08;   // radians — subtle variation
// Phase offset per finger (cascade wave from index → pinky)
const FINGER_PHASE_INDEX   = 0;
const FINGER_PHASE_MIDDLE  = 0.4;
const FINGER_PHASE_RING    = 0.8;
const FINGER_PHASE_LITTLE  = 1.2;
const FINGER_PHASE_THUMB   = 0.6;

// ─── Hand Gesture Presets ──────────────────────────────────────────────
// Each gesture defines curl multipliers per finger segment.
// Values are multiplied with the base curl constants.
export type HandGesture = 'relaxed' | 'fist' | 'pointing' | 'none';

interface GesturePreset {
  index: number;   // multiplier for index finger
  middle: number;
  ring: number;
  little: number;
  thumb: number;
}

const GESTURE_PRESETS: Record<HandGesture, GesturePreset> = {
  none:     { index: 0,   middle: 0,   ring: 0,   little: 0,   thumb: 0   },
  relaxed:  { index: 0.6, middle: 1, ring: 1.4, little: 1.8, thumb: 1.0 },
  fist:     { index: 4, middle: 4.2, ring: 4.7, little: 5, thumb: 1.5 },
  pointing: { index: 0.4, middle: 4.2, ring: 4.7, little: 5, thumb: 1.5 },
};

// Per-finger curl multipliers (index=lightest → pinky=most curled)
const FINGER_CURL_PROXIMAL    = 0.25;  // radians — base curl (first knuckle)
const FINGER_CURL_INTERMEDIATE = 0.35; // radians — second knuckle
const FINGER_CURL_DISTAL      = 0.20;  // radians — fingertip
const THUMB_CURL_META         = 0.22;  // radians — thumb base
const THUMB_CURL_PROXIMAL     = 0.27;  // radians — thumb middle
const THUMB_CURL_DISTAL       = 0.15;  // radians — thumb tip

// Air mode — leg sway (sine variation on dangle)
const LEG_SWAY_FREQ_1   = 0.08;   // Hz — primary slow cycle
const LEG_SWAY_FREQ_2   = 0.13;   // Hz — secondary, incommensurate
const LEG_SWAY_AMOUNT_1 = 0.05;    // primary variation
const LEG_SWAY_AMOUNT_2 = 0.025;   // secondary (subtler)

// Air mode — leg dangle
const KNEE_BEND_ANGLE   = 0.15;    // radians — base knee bend
const TOE_DROOP_ANGLE   = 0.349;    // radians — toes pointing slightly down

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

  // Finger + wrist bones
  private fingerBones: { bone: THREE.Object3D; curl: number; restVal: number; sign: number; axis: 'x' | 'y' | 'z'; phase: number; finger: keyof GesturePreset }[] = [];
  private bypassHeadTracking = false;

  /** Whether head tracking is currently bypassed. */
  get isHeadTrackingBypassed(): boolean {
    return this.bypassHeadTracking;
  }

  // Cursor tracking — head follows a target point instead of camera
  private cursorTarget: THREE.Vector3 | null = null;
  private cursorLastMoveTime = 0;
  private cursorIdleTimeout = 5000; // ms before returning to camera
  private cursorBlend = 0; // 0 = camera, 1 = cursor
  private clipHasFingers = false;
  private currentGesture: HandGesture = 'relaxed';


  /** Rest pose rotations — captured once so we can reset before applying. */
  private restRotations = new Map<THREE.Object3D, THREE.Euler>();
  private restPositions = new Map<THREE.Object3D, THREE.Vector3>();

  /** Base Y position for the VRM scene (set by VrmManager). */
  private baseY = 0;

  /** Camera reference for subtle head tracking. */
  private camera: THREE.Camera | null = null;

  /** Hips rest Y position — captured once after first mixer update. */
  private hipsRestY: number | null = null;

  /** Current bob offset in meters (exposed for PropManager to sync prop Y). */
  private _currentBobOffset = 0;

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

  /** Current bob offset in meters — PropManager uses this to sync prop Y. */
  getBobOffset(): number {
    return this._currentBobOffset;
  }

  setPropActive(_active: boolean): void {
    // Kept for API compatibility — prop sync now uses getBobOffset() directly
  }

  /** Enable/disable the idle layer. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Set the current hand gesture. */
  setHandGesture(gesture: HandGesture): void {
    this.currentGesture = gesture;
  }

  /**
   * Set cursor world-space position for head tracking.
   * Pass null to clear (head returns to camera).
   */
  setCursorTarget(worldPos: THREE.Vector3 | null): void {
    if (worldPos) {
      if (!this.cursorTarget) this.cursorTarget = new THREE.Vector3();
      this.cursorTarget.copy(worldPos);
      this.cursorLastMoveTime = performance.now();
    } else {
      this.cursorTarget = null;
    }
  }

  /** Enable/disable head tracking bypass (e.g. when typing, avatar looks at hands). */
  setBypassHeadTracking(bypass: boolean): void {
    this.bypassHeadTracking = bypass;
  }

  /** Tell idle layer whether active clips have finger tracks. */
  setClipHasFingers(hasFingers: boolean): void {
    this.clipHasFingers = hasFingers;
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
    // Reset cursor tracking state
    this.cursorTarget = null;
    this.cursorBlend = 0;
    this.cursorLastMoveTime = 0;
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

    // Resolve finger bones for relaxed curl
    const fingerNames: [string, number, keyof GesturePreset][] = [
      // Left hand
      ['leftIndexProximal', FINGER_CURL_PROXIMAL, 'index'],
      ['leftIndexIntermediate', FINGER_CURL_INTERMEDIATE, 'index'],
      ['leftIndexDistal', FINGER_CURL_DISTAL, 'index'],
      ['leftMiddleProximal', FINGER_CURL_PROXIMAL, 'middle'],
      ['leftMiddleIntermediate', FINGER_CURL_INTERMEDIATE, 'middle'],
      ['leftMiddleDistal', FINGER_CURL_DISTAL, 'middle'],
      ['leftRingProximal', FINGER_CURL_PROXIMAL, 'ring'],
      ['leftRingIntermediate', FINGER_CURL_INTERMEDIATE, 'ring'],
      ['leftRingDistal', FINGER_CURL_DISTAL, 'ring'],
      ['leftLittleProximal', FINGER_CURL_PROXIMAL, 'little'],
      ['leftLittleIntermediate', FINGER_CURL_INTERMEDIATE, 'little'],
      ['leftLittleDistal', FINGER_CURL_DISTAL, 'little'],
      ['leftThumbMetacarpal', THUMB_CURL_META, 'thumb'],
      ['leftThumbProximal', THUMB_CURL_PROXIMAL, 'thumb'],
      ['leftThumbDistal', THUMB_CURL_DISTAL, 'thumb'],
      // Right hand
      ['rightIndexProximal', FINGER_CURL_PROXIMAL, 'index'],
      ['rightIndexIntermediate', FINGER_CURL_INTERMEDIATE, 'index'],
      ['rightIndexDistal', FINGER_CURL_DISTAL, 'index'],
      ['rightMiddleProximal', FINGER_CURL_PROXIMAL, 'middle'],
      ['rightMiddleIntermediate', FINGER_CURL_INTERMEDIATE, 'middle'],
      ['rightMiddleDistal', FINGER_CURL_DISTAL, 'middle'],
      ['rightRingProximal', FINGER_CURL_PROXIMAL, 'ring'],
      ['rightRingIntermediate', FINGER_CURL_INTERMEDIATE, 'ring'],
      ['rightRingDistal', FINGER_CURL_DISTAL, 'ring'],
      ['rightLittleProximal', FINGER_CURL_PROXIMAL, 'little'],
      ['rightLittleIntermediate', FINGER_CURL_INTERMEDIATE, 'little'],
      ['rightLittleDistal', FINGER_CURL_DISTAL, 'little'],
      ['rightThumbMetacarpal', THUMB_CURL_META, 'thumb'],
      ['rightThumbProximal', THUMB_CURL_PROXIMAL, 'thumb'],
      ['rightThumbDistal', THUMB_CURL_DISTAL, 'thumb'],
    ];
    for (const [name, curl, finger] of fingerNames) {
      const bone = h.getNormalizedBoneNode(name as any);
      const isThumb = name.toLowerCase().includes('thumb');
      let sign = name.startsWith('left') ? -1 : 1;
      if (isThumb) sign = -sign;
      const axis = isThumb ? 'y' as const : 'z' as const;
      // Phase offset for wave cascade
      let phase = 0;
      const lowerName = name.toLowerCase();
      if (lowerName.includes('index')) phase = FINGER_PHASE_INDEX;
      else if (lowerName.includes('middle')) phase = FINGER_PHASE_MIDDLE;
      else if (lowerName.includes('ring')) phase = FINGER_PHASE_RING;
      else if (lowerName.includes('little')) phase = FINGER_PHASE_LITTLE;
      else if (lowerName.includes('thumb')) phase = FINGER_PHASE_THUMB;
      // Offset left vs right so hands aren't synchronized
      if (name.startsWith('right')) phase += Math.PI * 0.5;
      if (bone) this.fingerBones.push({ bone, curl, restVal: bone.rotation[axis], sign, axis, phase, finger });
    }

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

      // Store current bob offset so PropManager can sync prop Y position
      this._currentBobOffset = bobOffset;
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

    // 3. Backward lean on hips — counterbalances tucked legs
    if (this.hips) {
      // VRM 0.x has inverted axes — legBendSign handles this
      this.hips.rotation.x += -BACKWARD_LEAN * this.legBendSign;
    }

    // 4. Gentle body tilt — spine leans forward/back
    if (this.spine) {
      const tiltX = Math.sin(t * TILT_FREQUENCY * Math.PI * 2) * TILT_AMPLITUDE;
      this.spine.rotation.x += tiltX;
    }

    // 4. Slow left/right drift — hips sway
    if (this.hips) {
      const driftZ = Math.sin(t * DRIFT_FREQUENCY * Math.PI * 2) * DRIFT_AMPLITUDE;
      this.hips.rotation.z += driftZ;
    }

    // 6. Leg dangle — relaxed hanging pose
    this._applyLegDangle(t);

    // 7. Relaxed finger curl + wave (skip if clip has its own finger animation)
    if (!this.clipHasFingers) {
      this._applyFingerCurl(t);
    }

    // 8. Subtle head tracking toward camera
    if (!this.bypassHeadTracking) {
      this._applyHeadTracking(delta);
    }
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

    // 4. Relaxed finger curl + wave (skip if clip has its own finger animation)
    if (!this.clipHasFingers) {
      this._applyFingerCurl(t);
    }

    // 5. Subtle head tracking toward camera
    if (!this.bypassHeadTracking) {
      this._applyHeadTracking(delta);
    }
  }

  // ─── Private: head tracking ──────────────────────────────────────────

  /** Reusable vectors for head tracking math. */
  private _headTargetDir = new THREE.Vector3();
  private _headWorldPos = new THREE.Vector3();
  private _headCursorDir = new THREE.Vector3();
  private _parentInverse = new THREE.Matrix4();
  private _headCurrentYaw = 0;
  private _headCurrentPitch = 0;

  /**
   * Subtle additive head rotation biased toward camera.
   * Blends at HEAD_TRACK_INFLUENCE so clips still dominate.
   */
  private _applyHeadTracking(delta: number): void {
    if (!this.camera || !this.head) return;

    this.head.getWorldPosition(this._headWorldPos);

    // Blend between cursor target and camera based on idle time
    const now = performance.now();
    const cursorActive = this.cursorTarget && (now - this.cursorLastMoveTime < this.cursorIdleTimeout);
    const targetBlend = cursorActive ? 1 : 0;
    const blendSpeed = cursorActive ? 2.0 : 1.5; // gentle transition both ways
    this.cursorBlend += (targetBlend - this.cursorBlend) * (1 - Math.exp(-blendSpeed * delta));

    // Compute camera direction
    const cameraDir = this._headTargetDir.copy(this.camera.position).sub(this._headWorldPos).normalize();

    if (this.cursorBlend > 0.001 && this.cursorTarget) {
      // Dead zone: ignore cursor if it's too close to the head (prevents jitter at center)
      const distToHead = this.cursorTarget.distanceTo(this._headWorldPos);
      if (distToHead > 0.3) {
        const cursorDir = this._headCursorDir.copy(this.cursorTarget).sub(this._headWorldPos).normalize();
        this._headTargetDir.lerpVectors(cameraDir, cursorDir, this.cursorBlend);
        this._headTargetDir.normalize();
      }
    }

    // VRM 0.x (legBendSign === -1): the normalized skeleton faces the opposite
    // direction. Mirror the target direction so the head turns toward camera.
    if (this.legBendSign === -1) {
      this._headTargetDir.negate();
    }

    // Convert world direction to head's parent local space
    const parent = this.head.parent;
    if (!parent) return;

    parent.updateWorldMatrix(true, false);
    const parentInverse = this._parentInverse.copy(parent.matrixWorld).invert();
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

    const influence = HEAD_TRACK_INFLUENCE; // flat 0.25 — subtle, never jarring
    this.head.rotation.y += this._headCurrentYaw * influence;
    this.head.rotation.x += this._headCurrentPitch * influence;
  }


  // ─── Private: finger curl ──────────────────────────────────────────

  /** Apply a relaxed finger curl — natural resting hand pose. */
  private _applyFingerCurl(t: number): void {
    const preset = GESTURE_PRESETS[this.currentGesture];
    for (const { bone, curl, restVal, sign, axis, phase, finger } of this.fingerBones) {
      const gestureMultiplier = preset[finger];
      const wave = Math.sin(t * FINGER_WAVE_FREQ * Math.PI * 2 + phase) * FINGER_WAVE_AMOUNT;
      bone.rotation[axis] = restVal + (curl * gestureMultiplier + wave) * sign * this.legBendSign;
    }
  }

  // ─── Private: leg dangle (air mode) ───────────────────────────────────

  /**
   * Sine-driven leg dangle — tuck/droop varies continuously.
   * Each leg on a different phase for natural asymmetry.
   */
  private _applyLegDangle(t: number): void {
    const s = this.legBendSign;

    // Sine-driven variation — each leg on a different phase
    const leftSway  = Math.sin(t * LEG_SWAY_FREQ_1 * Math.PI * 2) * LEG_SWAY_AMOUNT_1
                    + Math.sin(t * LEG_SWAY_FREQ_2 * Math.PI * 2 + 0.9) * LEG_SWAY_AMOUNT_2;
    const rightSway = Math.sin(t * LEG_SWAY_FREQ_1 * Math.PI * 2 + Math.PI * 0.7) * LEG_SWAY_AMOUNT_1
                    + Math.sin(t * LEG_SWAY_FREQ_2 * Math.PI * 2 + 2.3) * LEG_SWAY_AMOUNT_2;

    // Base multipliers: left = straighter (1.1), right = more tucked (2.0)
    // Sway adds/subtracts from these
    if (this.leftUpperLeg) {
      this.leftUpperLeg.rotation.x += KNEE_BEND_ANGLE * (1.1 + leftSway) * s;
    }
    if (this.rightUpperLeg) {
      this.rightUpperLeg.rotation.x += KNEE_BEND_ANGLE * (2.0 + rightSway) * s;
    }

    if (this.leftLowerLeg) {
      this.leftLowerLeg.rotation.x += KNEE_BEND_ANGLE * (1.2 + leftSway * 0.8) * s;
    }
    if (this.rightLowerLeg) {
      this.rightLowerLeg.rotation.x += KNEE_BEND_ANGLE * (1.5 + rightSway * 0.8) * s;
    }

    if (this.leftFoot) {
      this.leftFoot.rotation.x += TOE_DROOP_ANGLE * (2.5 + leftSway * 0.5) * s;
    }
    if (this.rightFoot) {
      this.rightFoot.rotation.x += TOE_DROOP_ANGLE * (1.5 + rightSway * 0.5) * s;
    }
  }
}
