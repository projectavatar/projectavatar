/**
 * EffectsManager — orchestrates all visual effects.
 *
 * Owns the lifecycle of: ParticleAura, EnergyTrails, BloomEffect,
 * Holographic, and EyeGlow. Provides a unified API for enabling/disabling
 * effects and integrates with the render loop.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { EnergyTrails } from './energy-trails.ts';
import { BloomEffect } from './bloom-effect.ts';
import type { ScissorRect } from './bloom-effect.ts';
import { Holographic } from './holographic.ts';

// ─── Effect state ─────────────────────────────────────────────────────────────

export interface EffectsState {
  energyTrails: boolean;
  bloom: boolean;
  holographic: boolean;
}

export const DEFAULT_EFFECTS_STATE: EffectsState = {
  energyTrails: false,
  bloom: false,
  holographic: false,
};

export const EFFECT_LABELS: Record<keyof EffectsState, string> = {
  energyTrails: 'Energy Trails',
  bloom: 'Bloom',
  holographic: 'Holographic',
};

export const EFFECT_DESCRIPTIONS: Record<keyof EffectsState, string> = {
  energyTrails: 'Energy ribbons trailing from hands',
  bloom: 'Post-processing glow on emissive surfaces',
  holographic: 'Scan lines and edge glow on the model',
};

// ─── EffectsManager ───────────────────────────────────────────────────────────

export class EffectsManager {
  private energyTrails: EnergyTrails;
  private bloomEffect: BloomEffect;
  private holographic: Holographic;

  private scene: THREE.Scene;
  private state: EffectsState = { ...DEFAULT_EFFECTS_STATE };
  private modelReady = false;

  constructor(
    vrm: VRM,
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
  ) {
    this.scene = scene;

    // Initialize all effects
    this.energyTrails = new EnergyTrails(vrm);
    this.bloomEffect  = new BloomEffect(renderer, scene, camera);
    this.holographic  = new Holographic(vrm);

    // Add energy trail meshes to scene
    for (const obj of this.energyTrails.objects) {
      scene.add(obj);
    }

    // Set camera for energy trails
    this.energyTrails.setCamera(camera);

  }

  /** Get current effects state. */
  get effectsState(): Readonly<EffectsState> {
    return this.state;
  }

  /** Whether bloom is active (needs composer.render instead of renderer.render). */
  get isBloomActive(): boolean {
    return this.bloomEffect.isActive;
  }

  /** Signal that the model is visible and effects can render. */
  setModelReady(ready: boolean): void {
    this.modelReady = ready;
    if (ready) {
      // Reset trails to current hand positions — clears stale history from load
      this.energyTrails.reset();
    }
  }


  /** Update a single effect toggle. */
  setEffect(effect: keyof EffectsState, enabled: boolean): void {
    this.state[effect] = enabled;

    switch (effect) {
      case 'energyTrails':
        this.energyTrails.enabled = enabled;
        if (enabled) this.energyTrails.reset();
        break;
      case 'bloom':
        this.bloomEffect.enabled = enabled;
        break;
      case 'holographic':
        this.holographic.enabled = enabled;
        break;
    }
  }

  /** Apply a full effects state (e.g. from persisted settings). */
  applyState(state: Partial<EffectsState>): void {
    for (const [key, value] of Object.entries(state)) {
      if (key in this.state && typeof value === 'boolean') {
        this.setEffect(key as keyof EffectsState, value);
      }
    }
  }

  /** Update all effects. Call every frame. */
  update(delta: number): void {
    // Don't update visual effects until model is visible
    if (!this.modelReady) return;
    this.energyTrails.update(delta);
    this.bloomEffect.update(delta);
    this.holographic.update(delta);
  }

  /** Render through bloom composer if active, otherwise return false. */
  renderBloom(scissorRect?: ScissorRect | null): boolean {
    if (this.bloomEffect.isActive) {
      this.bloomEffect.setScissorRect(scissorRect ?? null);
      this.bloomEffect.render();
      return true;
    }
    return false;
  }

  /** Handle resize for bloom composer. */
  setSize(width: number, height: number): void {
    this.bloomEffect.setSize(width, height);
  }

  /** Handle pixel ratio changes. */
  setPixelRatio(ratio: number): void {
    this.bloomEffect.setPixelRatio(ratio);
  }

  /** Clean up all effects. */
  dispose(): void {
    for (const obj of this.energyTrails.objects) {
      this.scene.remove(obj);
    }

    this.energyTrails.dispose();
    this.bloomEffect.dispose();
    this.holographic.dispose();
  }
}
