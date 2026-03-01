/**
 * BloomEffect — post-processing bloom using UnrealBloomPass.
 *
 * Wraps Three.js EffectComposer with RenderPass + UnrealBloomPass + OutputPass.
 * Designed to make emissive materials (eye glow, particle aura) pop with
 * that sci-fi glow without affecting the entire scene too heavily.
 *
 * Integrates with AvatarScene by replacing its direct renderer.render() call
 * with composer.render().
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_BLOOM_STRENGTH  = 0.8;
const DEFAULT_BLOOM_RADIUS    = 0.4;
const DEFAULT_BLOOM_THRESHOLD = 0.7;
const FADE_SPEED = 2.0;

// ─── BloomEffect ──────────────────────────────────────────────────────────────

export class BloomEffect {
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private _enabled = false;
  private targetStrength = 0;
  private currentStrength = 0;
  private baseStrength: number;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    options?: {
      strength?: number;
      radius?: number;
      threshold?: number;
    },
  ) {
    this.baseStrength = options?.strength ?? DEFAULT_BLOOM_STRENGTH;

    this.composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    const resolution = new THREE.Vector2(
      renderer.domElement.clientWidth,
      renderer.domElement.clientHeight,
    );

    this.bloomPass = new UnrealBloomPass(
      resolution,
      0, // start at 0 strength, fade in
      options?.radius ?? DEFAULT_BLOOM_RADIUS,
      options?.threshold ?? DEFAULT_BLOOM_THRESHOLD,
    );
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  /** The EffectComposer — use composer.render() instead of renderer.render(). */
  get effectComposer(): EffectComposer { return this.composer; }

  /** Whether bloom is currently active (even during fade). */
  get isActive(): boolean {
    return this.currentStrength > 0.001 || this.targetStrength > 0;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.targetStrength = value ? 1 : 0;
  }

  get enabled(): boolean { return this._enabled; }

  /** Adjust bloom parameters at runtime. */
  setParams(params: { strength?: number; radius?: number; threshold?: number }): void {
    if (params.strength !== undefined) this.baseStrength = params.strength;
    if (params.radius !== undefined) this.bloomPass.radius = params.radius;
    if (params.threshold !== undefined) this.bloomPass.threshold = params.threshold;
  }

  /** Call every frame to update fade and render. */
  update(delta: number): void {
    this.currentStrength = THREE.MathUtils.lerp(
      this.currentStrength, this.targetStrength,
      1 - Math.exp(-FADE_SPEED * delta),
    );
    this.bloomPass.strength = this.baseStrength * this.currentStrength;
  }

  /** Render the scene through the bloom pipeline. */
  render(): void {
    this.composer.render();
  }

  /** Update composer size on window resize. */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  /** Update pixel ratio. */
  setPixelRatio(ratio: number): void {
    this.composer.setPixelRatio(ratio);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
