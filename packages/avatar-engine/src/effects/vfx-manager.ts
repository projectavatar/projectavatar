/**
 * VfxManager — manages emotion/action-driven VFX.
 *
 * v2: Blend-aware. Receives ResolvedBlend from the state machine,
 * uses dominant emotion for VFX selection and blend color/intensity
 * for VFX appearance.
 */
import * as THREE from 'three';
import type { VfxBinding, VfxInstance } from './emotion-vfx.ts';
import { createVfx } from './emotion-vfx.ts';
import type { ResolvedBlend } from '../emotion-blend.ts';

/** JSON-level binding (type is a string, not the enum). */
interface VfxBindingLoose {
  type: string;
  color?: string;
  intensity?: number;
  offsetY?: number;
}

const FADE_SPEED = 0.5; // opacity units per second

export class VfxManager {
  private scene: THREE.Scene;
  private activeVfx: VfxInstance[] = [];
  private fadingOut: VfxInstance[] = [];
  private elapsed = 0;

  /** VFX bindings — keyed by emotion or action name. */
  private bindings = new Map<string, VfxBindingLoose[]>();

  private currentKey: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Load VFX bindings from clips.json data.
   * Call once after loading clips.json.
   */
  loadBindings(emotionVfx: Record<string, VfxBindingLoose[]>, actionVfx: Record<string, VfxBindingLoose[]>): void {
    this.bindings.clear();
    for (const [key, vfx] of Object.entries(emotionVfx)) {
      this.bindings.set(`emotion:${key}`, vfx);
    }
    for (const [key, vfx] of Object.entries(actionVfx)) {
      this.bindings.set(`action:${key}`, vfx);
    }
  }

  /**
   * Set state from a resolved emotion blend.
   * Uses dominant emotion for VFX selection.
   * Applies blend color to active VFX instances.
   */
  setBlendState(blend: ResolvedBlend, action?: string): void {
    const emotionKey = blend.dominant ? `emotion:${blend.dominant}` : null;
    const actionKey = action ? `action:${action}` : null;

    // Prefer emotion VFX, fall back to action VFX (e.g. idle aura)
    if (emotionKey && this.bindings.has(emotionKey)) {
      this._transitionTo(emotionKey);
    } else if (actionKey && this.bindings.has(actionKey)) {
      this._transitionTo(actionKey);
    } else {
      this._transitionTo(null);
    }
    // (future: also modulate intensity/behavior based on energy)
  }


  private _transitionTo(key: string | null): void {
    if (key === this.currentKey) return;

    // Fade out current VFX
    for (const vfx of this.activeVfx) {
      vfx.targetOpacity = 0;
      this.fadingOut.push(vfx);
    }
    this.activeVfx = [];

    // Spawn new VFX
    if (key) {
      const bindings = this.bindings.get(key);
      if (bindings) {
        for (const binding of bindings) {
          const vfx = createVfx(binding.type as VfxBinding['type'], binding as VfxBinding);
          vfx.targetOpacity = 1;
          this.scene.add(vfx.object);
          this.activeVfx.push(vfx);
        }
      }
    }

    this.currentKey = key;
  }

  /**
   * Update all VFX. Call every frame.
   */
  update(delta: number): void {
    this.elapsed += delta;

    // Update active VFX
    for (const vfx of this.activeVfx) {
      if (vfx.opacity < vfx.targetOpacity) {
        vfx.setOpacity(Math.min(vfx.opacity + delta * FADE_SPEED, vfx.targetOpacity));
      }
      vfx.update(this.elapsed, delta);
    }

    // Update fading-out VFX
    for (let i = this.fadingOut.length - 1; i >= 0; i--) {
      const vfx = this.fadingOut[i]!;
      vfx.setOpacity(Math.max(vfx.opacity - delta * FADE_SPEED, 0));
      vfx.update(this.elapsed, delta);

      if (vfx.opacity <= 0.001) {
        this.scene.remove(vfx.object);
        vfx.dispose();
        this.fadingOut.splice(i, 1);
      }
    }
  }

  /**
   * Remove all VFX immediately.
   */
  clear(): void {
    for (const vfx of this.activeVfx) {
      this.scene.remove(vfx.object);
      vfx.dispose();
    }
    for (const vfx of this.fadingOut) {
      this.scene.remove(vfx.object);
      vfx.dispose();
    }
    this.activeVfx = [];
    this.fadingOut = [];
    this.currentKey = null;
  }
}
