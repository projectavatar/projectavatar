/**
 * Holographic — scrolling scan lines + fresnel edge glow overlay.
 *
 * Creates overlay SkinnedMesh clones as siblings of the original VRM meshes
 * in the same scene graph. They share geometry and skeleton references, so
 * bone transforms drive them identically. Uses a custom ShaderMaterial with
 * additive blending — zero modification to original materials.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Configuration ────────────────────────────────────────────────────────────

export const HOLO_CONFIG = {
  density:      30,
  speed:        0.05,
  lineAlpha:    0.35,
  lineWidth:    0.45,
  fresnelPower: 2.0,
  fresnelAlpha: 0.5,
  tint:         [0.5, 0.8, 1.0] as const,
};

const FADE_SPEED = 2.0;
const DEFAULT_TINT = new THREE.Color(...HOLO_CONFIG.tint);

// ─── Shaders ──────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>

    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform vec3  uTint;
  uniform float uLineDensity;
  uniform float uLineSpeed;
  uniform float uLineAlpha;
  uniform float uLineWidth;
  uniform float uFresnelPower;
  uniform float uFresnelAlpha;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    float scanY = vWorldPosition.y * uLineDensity + uTime * uLineSpeed * uLineDensity;
    float scanLine = smoothstep(uLineWidth - 0.1, uLineWidth, fract(scanY));
    float scanAlpha = scanLine * uLineAlpha * uStrength;

    float fresnel = 1.0 - abs(dot(normalize(vViewDir), normalize(vWorldNormal)));
    fresnel = pow(fresnel, uFresnelPower);
    float fresnelAlpha = fresnel * uFresnelAlpha * uStrength;

    float totalAlpha = max(scanAlpha, fresnelAlpha);
    vec3 color = mix(vec3(0.0), uTint, fresnel);

    gl_FragColor = vec4(color, totalAlpha);
  }
`;

// ─── Holographic ──────────────────────────────────────────────────────────────

export class Holographic {
  private vrm: VRM;
  private _enabled = false;
  private targetStrength = 0;
  private currentStrength = 0;
  private elapsed = 0;
  private overlayMeshes: THREE.Mesh[] = [];
  private built = false;

  /** Shared uniforms — all overlay materials reference the same uniform objects. */
  private uniforms = {
    uTime:         { value: 0 },
    uStrength:     { value: 0 },
    uTint:         { value: DEFAULT_TINT.clone() },
    uLineDensity:  { value: HOLO_CONFIG.density },
    uLineSpeed:    { value: HOLO_CONFIG.speed },
    uLineAlpha:    { value: HOLO_CONFIG.lineAlpha },
    uLineWidth:    { value: HOLO_CONFIG.lineWidth },
    uFresnelPower: { value: HOLO_CONFIG.fresnelPower },
    uFresnelAlpha: { value: HOLO_CONFIG.fresnelAlpha },
  };

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  setTint(color: THREE.Color): void {
    this.uniforms.uTint.value.copy(color);
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.targetStrength = value ? 1 : 0;
    if (value) {
      if (!this.built) this._buildOverlay();
      for (const m of this.overlayMeshes) m.visible = true;
    }
  }

  get enabled(): boolean { return this._enabled; }

  update(delta: number): void {
    if (this.overlayMeshes.length === 0) return;
    if (!this.overlayMeshes[0]!.visible && this.targetStrength === 0) return;

    this.elapsed += delta;
    this.uniforms.uTime.value = this.elapsed;

    this.currentStrength = THREE.MathUtils.lerp(
      this.currentStrength, this.targetStrength,
      1 - Math.exp(-FADE_SPEED * delta),
    );
    this.uniforms.uStrength.value = this.currentStrength;

    if (this.currentStrength < 0.001 && this.targetStrength === 0) {
      for (const m of this.overlayMeshes) m.visible = false;
    }
  }

  dispose(): void {
    for (const mesh of this.overlayMeshes) {
      mesh.parent?.remove(mesh);
      if (mesh.material instanceof THREE.ShaderMaterial) {
        mesh.material.dispose();
      }
    }
    this.overlayMeshes = [];
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /**
   * Create a ShaderMaterial for the holographic overlay.
   * Skinning is handled by the #include <skinning_pars_vertex> chunks
   * in the vertex shader — no `skinning` flag needed (removed in r155+).
   */
  private _createMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
    });
  }

  /**
   * Build overlay meshes as siblings of original VRM meshes.
   * Shares geometry + skeleton so bone transforms drive them identically.
   */
  private _buildOverlay(): void {
    const meshesToClone: { source: THREE.SkinnedMesh; parent: THREE.Object3D }[] = [];

    this.vrm.scene.traverse((child) => {
      // Only clone SkinnedMeshes — regular meshes (eye highlights, hair planes,
      // accessories) don't follow bone transforms and would drift from the model.
      if (child instanceof THREE.SkinnedMesh && child.parent) {
        meshesToClone.push({ source: child, parent: child.parent });
      }
    });

    for (const { source, parent } of meshesToClone) {
      const material = this._createMaterial();
      const overlay = new THREE.SkinnedMesh(source.geometry, material);
      overlay.bind(source.skeleton, source.bindMatrix);

      overlay.name = source.name + '_holo';
      overlay.frustumCulled = false;
      overlay.renderOrder = source.renderOrder + 1;
      overlay.position.copy(source.position);
      overlay.rotation.copy(source.rotation);
      overlay.scale.copy(source.scale).multiplyScalar(1.05);
      overlay.visible = true;

      parent.add(overlay);
      this.overlayMeshes.push(overlay);
    }

    this.built = true;
  }
}
