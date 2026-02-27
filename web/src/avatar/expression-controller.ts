import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Emotion, Intensity } from '@project-avatar/shared';

interface ExpressionTarget {
  name: string;
  weight: number;
}

interface HeadTarget {
  x: number; // pitch (nod)
  y: number; // yaw (turn)
  z: number; // roll (tilt)
}

/**
 * Emotion → VRM expression mapping with smooth interpolation.
 *
 * Uses frame-rate independent exponential decay lerp for smooth,
 * natural transitions regardless of framerate.
 *
 * Two subsystems:
 * 1. Blend shapes — VRM expressionManager values (happy, sad, etc.)
 * 2. Head bone rotation — small euler offsets per emotion for readability
 */

const EMOTION_MAP: Record<Emotion, ExpressionTarget[]> = {
  idle:      [{ name: 'neutral', weight: 1.0 }],
  thinking:  [{ name: 'neutral', weight: 0.4 }, { name: 'lookUp', weight: 0.45 }],
  focused:   [{ name: 'neutral', weight: 1.0 }],
  excited:   [{ name: 'happy', weight: 1.0 }, { name: 'surprised', weight: 0.35 }],
  confused:  [{ name: 'surprised', weight: 0.65 }, { name: 'neutral', weight: 0.2 }],
  satisfied: [{ name: 'happy', weight: 0.75 }, { name: 'relaxed', weight: 0.5 }],
  concerned: [{ name: 'sad', weight: 0.65 }, { name: 'neutral', weight: 0.15 }],
};

/**
 * Head bone euler offsets per emotion (radians, small values).
 * x = pitch (positive = nod down), y = yaw (positive = turn left), z = roll (positive = tilt right)
 *
 * These are subtle — the goal is readable, not theatrical.
 */
const HEAD_TILT: Record<Emotion, HeadTarget> = {
  idle:      { x:  0.00,  y:  0.00,  z:  0.00 },
  thinking:  { x: -0.06,  y:  0.04,  z:  0.04 }, // head up + slight tilt = looking-up-thinking
  focused:   { x:  0.04,  y:  0.00,  z:  0.00 }, // very slight forward lean
  excited:   { x: -0.05,  y:  0.00,  z: -0.03 }, // head up, slight right tilt = upbeat
  confused:  { x:  0.02,  y:  0.00,  z:  0.07 }, // side tilt = classic confused
  satisfied: { x:  0.02,  y:  0.00,  z: -0.02 }, // slight nod
  concerned: { x:  0.05,  y: -0.03,  z: -0.04 }, // head down + slight turn
};

const INTENSITY_SCALE: Record<Intensity, number> = {
  low: 0.55,
  medium: 1.0,
  high: 1.2,
};

// Breathing micro-animation — slow sine wave on pitch
const BREATHE_AMPLITUDE = 0.008; // radians
const BREATHE_FREQUENCY = 0.18;  // cycles per second (~11 breaths/min)

export class ExpressionController {
  private vrm: VRM;
  private targetWeights = new Map<string, number>();
  private currentWeights = new Map<string, number>();
  private blendSpeed = 3.0; // exponential decay rate for blend shapes

  private headBone: THREE.Object3D | null = null;
  private headBaseRotation = new THREE.Euler();
  private headTargetOffset: HeadTarget = { x: 0, y: 0, z: 0 };
  private headCurrentOffset: HeadTarget = { x: 0, y: 0, z: 0 };
  private headBlendSpeed = 2.5; // slightly slower than blend shapes — feels more natural

  private elapsed = 0;
  private breatheEnabled = true;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this._initHeadBone();
  }

  private _initHeadBone(): void {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;

    const bone = humanoid.getNormalizedBoneNode('head');
    if (!bone) return;

    this.headBone = bone;
    // Capture the rest-pose rotation as our base
    this.headBaseRotation.copy(bone.rotation);
  }

  /** Set the target emotion with optional intensity scaling. */
  setEmotion(emotion: Emotion, intensity: Intensity = 'medium'): void {
    const scale = INTENSITY_SCALE[intensity];
    const targets = EMOTION_MAP[emotion] ?? EMOTION_MAP.idle;

    this.targetWeights.clear();
    for (const target of targets) {
      this.targetWeights.set(target.name, Math.min(target.weight * scale, 1.0));
    }

    // Scale head tilt by intensity too — high intensity = more expressive movement
    const tilt = HEAD_TILT[emotion] ?? HEAD_TILT.idle;
    this.headTargetOffset = {
      x: tilt.x * scale,
      y: tilt.y * scale,
      z: tilt.z * scale,
    };
  }

  /** Enable or disable the idle breathing micro-animation. */
  setBreathing(enabled: boolean): void {
    this.breatheEnabled = enabled;
  }

  /** Smoothly interpolate expression weights and head rotation toward targets. Call every frame. */
  update(delta: number): void {
    this.elapsed += delta;

    this._updateBlendShapes(delta);
    this._updateHeadBone(delta);
  }

  private _updateBlendShapes(delta: number): void {
    if (!this.vrm.expressionManager) return;

    const allNames = new Set([...this.currentWeights.keys(), ...this.targetWeights.keys()]);

    for (const name of allNames) {
      const current = this.currentWeights.get(name) ?? 0;
      const target = this.targetWeights.get(name) ?? 0;

      // Frame-rate independent exponential decay
      const next = THREE.MathUtils.lerp(current, target, 1 - Math.exp(-this.blendSpeed * delta));

      if (Math.abs(next) < 0.001 && Math.abs(target) < 0.001) {
        this.currentWeights.delete(name);
        this.vrm.expressionManager.setValue(name, 0);
      } else {
        this.currentWeights.set(name, next);
        this.vrm.expressionManager.setValue(name, next);
      }
    }
  }

  private _updateHeadBone(delta: number): void {
    if (!this.headBone) return;

    const decay = 1 - Math.exp(-this.headBlendSpeed * delta);

    // Lerp current offset toward target
    this.headCurrentOffset.x += (this.headTargetOffset.x - this.headCurrentOffset.x) * decay;
    this.headCurrentOffset.y += (this.headTargetOffset.y - this.headCurrentOffset.y) * decay;
    this.headCurrentOffset.z += (this.headTargetOffset.z - this.headCurrentOffset.z) * decay;

    // Breathing: slow sine on pitch (x)
    const breathe = this.breatheEnabled
      ? Math.sin(this.elapsed * Math.PI * 2 * BREATHE_FREQUENCY) * BREATHE_AMPLITUDE
      : 0;

    // Apply: base rotation + emotion offset + breathing
    this.headBone.rotation.set(
      this.headBaseRotation.x + this.headCurrentOffset.x + breathe,
      this.headBaseRotation.y + this.headCurrentOffset.y,
      this.headBaseRotation.z + this.headCurrentOffset.z,
    );
  }

  /** Reset all expressions and head rotation to zero immediately. */
  reset(): void {
    if (this.vrm.expressionManager) {
      for (const name of this.currentWeights.keys()) {
        this.vrm.expressionManager.setValue(name, 0);
      }
    }
    this.currentWeights.clear();
    this.targetWeights.clear();

    this.headTargetOffset = { x: 0, y: 0, z: 0 };
    this.headCurrentOffset = { x: 0, y: 0, z: 0 };

    if (this.headBone) {
      this.headBone.rotation.copy(this.headBaseRotation);
    }
  }
}
