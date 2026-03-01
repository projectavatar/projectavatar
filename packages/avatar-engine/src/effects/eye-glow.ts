/**
 * EyeGlow — emissive glow on avatar eye materials.
 *
 * Detects eye meshes/materials on the VRM model and adds emissive color
 * with a subtle pulsing effect. The glow color can react to emotion.
 * Non-destructive — stores original emissive values for clean removal.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Emotion } from '@project-avatar/shared';

// ─── Configuration ────────────────────────────────────────────────────────────

const GLOW_INTENSITY     = 1.5;    // emissive intensity multiplier
const PULSE_FREQ         = 1.2;    // Hz
const PULSE_AMOUNT       = 0.25;   // 0–1 variation
const FADE_SPEED         = 2.5;
const IDLE_INTENSITY     = 0.6;    // dimmer when idle

// Emotion → glow color
const EMOTION_COLORS: Partial<Record<Emotion, THREE.Color>> = {
  idle:      new THREE.Color(0.2, 0.5, 1.0),   // calm blue
  happy:     new THREE.Color(0.2, 0.8, 0.4),   // green
  excited:   new THREE.Color(1.0, 0.6, 0.1),   // orange-gold
  angry:     new THREE.Color(1.0, 0.15, 0.1),  // red
  sad:       new THREE.Color(0.3, 0.3, 0.8),   // deep blue
  thinking:  new THREE.Color(0.5, 0.3, 1.0),   // purple
  confused:  new THREE.Color(0.8, 0.5, 0.2),   // amber
  surprised: new THREE.Color(0.9, 0.9, 0.3),   // yellow
  bashful:   new THREE.Color(0.9, 0.4, 0.6),   // pink
  nervous:   new THREE.Color(0.7, 0.5, 0.2),   // amber-orange
};

const DEFAULT_COLOR = new THREE.Color(0.2, 0.5, 1.0);

// ─── EyeGlow ──────────────────────────────────────────────────────────────────

interface OriginalEmissive {
  emissive: THREE.Color;
  emissiveIntensity: number;
}

export class EyeGlow {
  private vrm: VRM;
  private _enabled = false;
  private targetStrength = 0;
  private currentStrength = 0;
  private elapsed = 0;
  private eyeMaterials: THREE.MeshStandardMaterial[] = [];
  private originals = new Map<THREE.MeshStandardMaterial, OriginalEmissive>();
  private currentColor = DEFAULT_COLOR.clone();
  private targetColor = DEFAULT_COLOR.clone();
  private currentEmotion: Emotion = 'idle';

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this._findEyeMaterials();
  }

  /** React to emotion changes — shift glow color. */
  setEmotion(emotion: Emotion): void {
    this.currentEmotion = emotion;
    this.targetColor.copy(EMOTION_COLORS[emotion] ?? DEFAULT_COLOR);
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.targetStrength = value ? 1 : 0;
  }

  get enabled(): boolean { return this._enabled; }

  update(delta: number): void {
    this.elapsed += delta;

    this.currentStrength = THREE.MathUtils.lerp(
      this.currentStrength, this.targetStrength,
      1 - Math.exp(-FADE_SPEED * delta),
    );

    // Lerp color toward target
    this.currentColor.lerp(this.targetColor, 1 - Math.exp(-3.0 * delta));

    if (this.currentStrength < 0.001 && this.targetStrength === 0) {
      // Restore originals
      for (const [mat, orig] of this.originals) {
        mat.emissive.copy(orig.emissive);
        mat.emissiveIntensity = orig.emissiveIntensity;
      }
      return;
    }

    // Pulse
    const pulse = 1 - PULSE_AMOUNT + Math.sin(this.elapsed * PULSE_FREQ * Math.PI * 2) * PULSE_AMOUNT;
    const emotionScale = this.currentEmotion === 'idle' ? IDLE_INTENSITY : 1.0;
    const intensity = GLOW_INTENSITY * this.currentStrength * pulse * emotionScale;

    for (const mat of this.eyeMaterials) {
      mat.emissive.copy(this.currentColor);
      mat.emissiveIntensity = intensity;
    }
  }

  dispose(): void {
    for (const [mat, orig] of this.originals) {
      mat.emissive.copy(orig.emissive);
      mat.emissiveIntensity = orig.emissiveIntensity;
    }
    this.originals.clear();
    this.eyeMaterials = [];
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /**
   * Find eye materials on the VRM model.
   * Searches mesh names and material names for common eye-related keywords.
   */
  private _findEyeMaterials(): void {
    const eyeKeywords = [
      'eye', 'iris', 'pupil', 'cornea',
      'Eye', 'Iris', 'Pupil',
      'F00_000_00_EyeIris',     // VRoid standard
      'F00_000_00_Eye',         // VRoid standard
      'F00_000_EyeIris',
      'F00_000_Eye',
    ];

    // Also try VRM-specific eye material detection via mesh morphs
    const eyeMeshNames = new Set<string>();

    this.vrm.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      const meshName = child.name.toLowerCase();
      const isEyeMesh = eyeKeywords.some(kw => meshName.includes(kw.toLowerCase()));

      if (!isEyeMesh) {
        // Check material name
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          const matName = (mat.name || '').toLowerCase();
          if (eyeKeywords.some(kw => matName.includes(kw.toLowerCase()))) {
            eyeMeshNames.add(child.name);
          }
        }
        if (!eyeMeshNames.has(child.name)) return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        if (this.originals.has(mat)) continue;

        // Filter out materials that are likely eye whites (high lightness, low saturation)
        // We only want iris/pupil materials for the glow
        const matName = (mat.name || '').toLowerCase();
        if (matName.includes('white') || matName.includes('highlight')) continue;

        this.originals.set(mat, {
          emissive: mat.emissive.clone(),
          emissiveIntensity: mat.emissiveIntensity,
        });
        this.eyeMaterials.push(mat);
      }
    });

    if (this.eyeMaterials.length === 0) {
      console.info('[EyeGlow] No eye materials found — effect will be inactive');
    } else {
      console.info(`[EyeGlow] Found ${this.eyeMaterials.length} eye material(s)`);
    }
  }
}
