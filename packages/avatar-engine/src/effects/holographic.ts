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

const SCAN_LINE_DENSITY  = 120;
const SCAN_LINE_SPEED    = 0.25;
const SCAN_LINE_ALPHA    = 0.06;
const SCAN_LINE_WIDTH    = 0.45;
const FRESNEL_POWER      = 3.0;
const FRESNEL_ALPHA      = 0.12;
const FADE_SPEED         = 2.0;

const DEFAULT_TINT = new THREE.Color(0.5, 0.8, 1.0);

// ─── Shaders ──────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
  #include <skinning_pars_vertex>

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>

    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPos.xyz;

    vec3 objectNormal = normal;
    #ifdef USE_SKINNING
      mat4 skinMatrix = bindMatrix * (
        skinWeight.x * boneMatrices[int(skinIndex.x)] +
        skinWeight.y * boneMatrices[int(skinIndex.y)] +
        skinWeight.z * boneMatrices[int(skinIndex.z)] +
        skinWeight.w * boneMatrices[int(skinIndex.w)]
      ) * bindMatrixInverse;
      objectNormal = (skinMatrix * vec4(objectNormal, 0.0)).xyz;
    #endif

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
  private material: THREE.ShaderMaterial;
  private overlayMeshes: THREE.Mesh[] = [];
  private built = false;

  constructor(vrm: VRM) {
    this.vrm = vrm;

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

  setTint(color: THREE.Color): void {
    (this.material.uniforms['uTint'] as { value: THREE.Color }).value.copy(color);
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
    this.material.uniforms['uTime']!.value = this.elapsed;

    this.currentStrength = THREE.MathUtils.lerp(
      this.currentStrength, this.targetStrength,
      1 - Math.exp(-FADE_SPEED * delta),
    );
    this.material.uniforms['uStrength']!.value = this.currentStrength;

    if (this.currentStrength < 0.001 && this.targetStrength === 0) {
      for (const m of this.overlayMeshes) m.visible = false;
    }
  }

  dispose(): void {
    for (const mesh of this.overlayMeshes) {
      mesh.parent?.remove(mesh);
    }
    this.material.dispose();
    this.overlayMeshes = [];
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /**
   * Build overlay meshes as siblings of original VRM meshes.
   * Shares geometry + skeleton so bone transforms drive them identically.
   */
  private _buildOverlay(): void {
    const meshesToClone: { source: THREE.Mesh; parent: THREE.Object3D }[] = [];

    this.vrm.scene.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh || child instanceof THREE.Mesh) {
        if (child.parent) {
          meshesToClone.push({ source: child, parent: child.parent });
        }
      }
    });

    for (const { source, parent } of meshesToClone) {
      let overlay: THREE.Mesh;

      if (source instanceof THREE.SkinnedMesh) {
        const skinned = new THREE.SkinnedMesh(source.geometry, this.material);
        skinned.skeleton = source.skeleton;
        skinned.bindMatrix.copy(source.bindMatrix);
        skinned.bindMatrixInverse.copy(source.bindMatrixInverse);
        // Bind must be called to set up the uniform properly
        skinned.bind(source.skeleton, source.bindMatrix);
        overlay = skinned;
      } else {
        overlay = new THREE.Mesh(source.geometry, this.material);
      }

      overlay.name = source.name + '_holo';
      overlay.frustumCulled = false;
      overlay.renderOrder = source.renderOrder + 1;
      // Copy local transform so overlay sits exactly on top
      overlay.position.copy(source.position);
      overlay.rotation.copy(source.rotation);
      overlay.scale.copy(source.scale);
      overlay.visible = true;

      parent.add(overlay);
      this.overlayMeshes.push(overlay);
    }

    this.built = true;
  }
}
