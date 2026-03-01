/**
 * BloomEffect — post-processing bloom using UnrealBloomPass.
 *
 * Wraps Three.js EffectComposer with RenderPass + UnrealBloomPass + OutputPass.
 * GPU resources are deferred until first enable to avoid allocating 4 passes
 * for an opt-in feature.
 *
 * Integrates with AvatarScene by replacing its direct renderer.render() call
 * with composer.render().
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { PremultiplyAlphaPass } from './premultiply-alpha-pass.ts';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_BLOOM_STRENGTH  = 0.4;
const DEFAULT_BLOOM_RADIUS    = 0.4;
const DEFAULT_BLOOM_THRESHOLD = 0.7;
const FADE_SPEED = 2.0;

// ─── BloomEffect ──────────────────────────────────────────────────────────────

export class BloomEffect {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private _enabled = false;
  private targetStrength = 0;
  private currentStrength = 0;
  private baseStrength: number;

  // Stored for deferred construction
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private options: { strength?: number; radius?: number; threshold?: number };

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
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.options = options ?? {};
    this.baseStrength = options?.strength ?? DEFAULT_BLOOM_STRENGTH;
  }

  /** Build the EffectComposer pipeline on first use. */
  private _ensureComposer(): void {
    if (this.composer) return;

    // Create render target with alpha for transparent backgrounds (desktop overlay)
    const size = this.renderer.getSize(new THREE.Vector2());
    const pixelRatio = this.renderer.getPixelRatio();
    const renderTarget = new THREE.WebGLRenderTarget(
      size.x * pixelRatio,
      size.y * pixelRatio,
      {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace,
      },
    );

    this.composer = new EffectComposer(this.renderer, renderTarget);

    const renderPass = new RenderPass(this.scene, this.camera);
    renderPass.clearAlpha = 0; // Preserve transparency
    this.composer.addPass(renderPass);

    const resolution = new THREE.Vector2(
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
    );

    this.bloomPass = new UnrealBloomPass(
      resolution,
      0,
      this.options.radius ?? DEFAULT_BLOOM_RADIUS,
      this.options.threshold ?? DEFAULT_BLOOM_THRESHOLD,
    );
    this.composer.addPass(this.bloomPass);

    // SMAA anti-aliasing — WebGL MSAA doesn't work with postprocessing FBOs
    const smaaPass = new SMAAPass(resolution.x, resolution.y);
    this.composer.addPass(smaaPass);

    // Patch bloom blend material: use custom blending to preserve alpha.
    // Default AdditiveBlending adds to ALL channels including alpha,
    // making transparent areas opaque. Custom blending adds RGB only.
    // Patch blend material for alpha preservation.
    // blendMaterial is an internal of UnrealBloomPass — if three.js
    // removes it, bloom will still work but with opaque backgrounds.
    const blendMat = (this.bloomPass as any).blendMaterial as THREE.ShaderMaterial | undefined;
    if (blendMat) {
      blendMat.blending = THREE.CustomBlending;
      blendMat.blendSrc = THREE.OneFactor;
      blendMat.blendDst = THREE.OneFactor;
      blendMat.blendSrcAlpha = THREE.ZeroFactor;
      blendMat.blendDstAlpha = THREE.OneFactor;
    } else {
      console.warn('[BloomEffect] blendMaterial not found on UnrealBloomPass — alpha transparency may not work');
    }

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    // Premultiply alpha for correct OS compositor blending.
    // Without this, semi-transparent edges show dark fringe on light backgrounds.
    const premultiplyPass = new PremultiplyAlphaPass();
    this.composer.addPass(premultiplyPass);
  }

  /** Whether bloom is currently active (even during fade). */
  get isActive(): boolean {
    return this.currentStrength > 0.001 || this.targetStrength > 0;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.targetStrength = value ? 1 : 0;
    if (value) this._ensureComposer();
  }

  get enabled(): boolean { return this._enabled; }

  /** Adjust bloom parameters at runtime. */
  setParams(params: { strength?: number; radius?: number; threshold?: number }): void {
    if (params.strength !== undefined) this.baseStrength = params.strength;
    if (this.bloomPass) {
      if (params.radius !== undefined) this.bloomPass.radius = params.radius;
      if (params.threshold !== undefined) this.bloomPass.threshold = params.threshold;
    }
  }

  /** Call every frame to update fade. */
  update(delta: number): void {
    if (!this.bloomPass) return;
    this.currentStrength = THREE.MathUtils.lerp(
      this.currentStrength, this.targetStrength,
      1 - Math.exp(-FADE_SPEED * delta),
    );
    this.bloomPass.strength = this.baseStrength * this.currentStrength;
  }

  /** Render the scene through the bloom pipeline. */
  render(): void {
    this.composer?.render();
  }

  /** Update composer size on window resize. */
  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
  }

  /** Update pixel ratio. */
  setPixelRatio(ratio: number): void {
    this.composer?.setPixelRatio(ratio);
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
  }
}
