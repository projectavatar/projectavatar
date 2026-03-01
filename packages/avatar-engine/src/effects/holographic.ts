/**
 * Holographic — scrolling scan lines + subtle tint on the VRM model.
 *
 * Instead of injecting into material shaders (fragile with MToon/custom materials),
 * this uses a screen-space fullscreen pass rendered on top of the model.
 *
 * Actually, the simplest robust approach: overlay a second copy of the mesh
 * with a custom ShaderMaterial that reads world position for scan lines
 * and view direction for fresnel. But that's expensive.
 *
 * Simplest robust approach: modify material color/emissive each frame
 * to simulate scan lines by cycling which "bands" of the model are
 * slightly darker. This doesn't require shader injection at all.
 *
 * ACTUALLY simplest: use onBeforeRender on each mesh to set a uniform,
 * and patch materials with a safe injection strategy that works for both
 * MeshStandardMaterial AND MToonMaterial.
 *
 * Final approach: custom overlay mesh with ShaderMaterial that reads
 * depth and renders scan lines as a post-effect on the model only.
 *
 * ──────────────────────────────────────────────────────────────────
 * REVISED APPROACH: Clone meshes with a custom holographic ShaderMaterial.
 * The clone sits on top of the original and renders additive scan lines +
 * fresnel glow. Zero modification to original materials.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Configuration ────────────────────────────────────────────────────────────

const SCAN_LINE_DENSITY  = 120;   // lines per world unit
const SCAN_LINE_SPEED    = 0.25;  // world units/sec scroll speed
const SCAN_LINE_ALPHA    = 0.06;  // scan line max opacity
const SCAN_LINE_WIDTH    = 0.45;  // duty cycle
const FRESNEL_POWER      = 3.0;
const FRESNEL_ALPHA      = 0.12;  // edge glow max opacity
const FADE_SPEED         = 2.0;

const DEFAULT_TINT = new THREE.Color(0.5, 0.8, 1.0);

// ─── Shaders ──────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
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
    // Scan lines based on world Y position
    float scanY = vWorldPosition.y * uLineDensity + uTime * uLineSpeed * uLineDensity;
    float scanLine = smoothstep(uLineWidth - 0.1, uLineWidth, fract(scanY));
    float scanAlpha = scanLine * uLineAlpha * uStrength;

    // Fresnel edge glow
    float fresnel = 1.0 - abs(dot(normalize(vViewDir), normalize(vWorldNormal)));
    fresnel = pow(fresnel, uFresnelPower);
    float fresnelAlpha = fresnel * uFresnelAlpha * uStrength;

    // Combine: scan line darkening + edge glow
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
  private overlayGroup: THREE.Group;
  private material: THREE.ShaderMaterial;
  private overlayMeshes: THREE.Mesh[] = [];
  private built = false;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.overlayGroup = new THREE.Group();
    this.overlayGroup.visible = false;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime:         { value: 0 },
        uStrength:     { value: 0 },
        uTint:         { value: DEFAULT_TINT.clone() },
        uLineDensity:  { value: SCAN_LINE_DENSITY },
        uLineSpeed:    { value: SCAN_LINE_SPEED },
        uLineAlpha:    { value: SCAN_LINE_ALPHA },
        uLineWidth:    { value: SCAN_LINE_WIDTH },
        uFresnelPower: { value: FRESNEL_POWER },
        uFresnelAlpha: { value: FRESNEL_ALPHA },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
    });
  }

  /** Add this to the scene. */
  get object3D(): THREE.Object3D { return this.overlayGroup; }

  setTint(color: THREE.Color): void {
    (this.material.uniforms['uTint'] as { value: THREE.Color }).value.copy(color);
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.targetStrength = value ? 1 : 0;
    if (value) {
      if (!this.built) this._buildOverlay();
      this.overlayGroup.visible = true;
    }
  }

  get enabled(): boolean { return this._enabled; }

  update(delta: number): void {
    if (!this.overlayGroup.visible) return;

    this.elapsed += delta;
    this.material.uniforms['uTime']!.value = this.elapsed;

    this.currentStrength = THREE.MathUtils.lerp(
      this.currentStrength, this.targetStrength,
      1 - Math.exp(-FADE_SPEED * delta),
    );
    this.material.uniforms['uStrength']!.value = this.currentStrength;

    // Sync overlay transforms with VRM skeleton
    this._syncTransforms();

    if (this.currentStrength < 0.001 && this.targetStrength === 0) {
      this.overlayGroup.visible = false;
    }
  }

  dispose(): void {
    // Don't dispose geometry — it's shared with the original mesh
    this.material.dispose();
    this.overlayMeshes = [];
    if (this.overlayGroup.parent) {
      this.overlayGroup.parent.remove(this.overlayGroup);
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /**
   * Build overlay meshes that share geometry with the VRM's meshes
   * but use our holographic ShaderMaterial.
   */
  private _buildOverlay(): void {
    this.vrm.scene.traverse((child) => {
      if (!(child instanceof THREE.SkinnedMesh) && !(child instanceof THREE.Mesh)) return;

      let overlay: THREE.Mesh;

      if (child instanceof THREE.SkinnedMesh) {
        const skinned = new THREE.SkinnedMesh(child.geometry, this.material);
        skinned.skeleton = child.skeleton;
        skinned.bindMatrix.copy(child.bindMatrix);
        skinned.bindMatrixInverse.copy(child.bindMatrixInverse);
        overlay = skinned;
      } else {
        overlay = new THREE.Mesh(child.geometry, this.material);
      }

      // Copy transform — for SkinnedMesh the skeleton binding handles it,
      // but we still need parent-relative transform
      overlay.matrixAutoUpdate = false;
      overlay.frustumCulled = false;

      // Store reference to source for transform sync
      overlay.userData._holoSource = child;

      this.overlayGroup.add(overlay);
      this.overlayMeshes.push(overlay);
    });

    this.built = true;
  }

  /**
   * Sync overlay mesh world matrices with their source meshes.
   * For SkinnedMeshes, the skeleton handles bone transforms automatically
   * since we share the same skeleton reference.
   */
  private _syncTransforms(): void {
    for (const overlay of this.overlayMeshes) {
      const source = overlay.userData._holoSource as THREE.Object3D | undefined;
      if (source) {
        overlay.matrixWorld.copy(source.matrixWorld);
      }
    }
  }
}
