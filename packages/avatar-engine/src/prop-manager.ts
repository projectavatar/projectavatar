import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ClipPropBinding } from './clip-registry.ts';
import { HOLO_CONFIG } from './effects/holographic.ts';

/**
 * PropManager — world-space prop spawning with fade and material styles.
 *
 * Props are GLB models loaded from /props/<id>.glb. They are placed in
 * world space using the transform from ClipPropBinding (set in clips.json).
 *
 * Material styles:
 *   - solid:       Original materials from the GLB
 *   - holographic: Custom scanline + fresnel shader (transparent, glowing)
 *   - ghostly:     Simple transparency with emissive glow
 *
 * Props fade in/out over a configurable duration when actions change.
 * Only one prop is active at a time.
 */

const FADE_DURATION = 0.35; // seconds
const PROP_BASE_PATH = '/props/';

// ─── Holographic shader (simplified from effects/holographic.ts) ──────────────

const holoVertexShader = /* glsl */ `
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

const holoFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3  uTint;
  uniform float uDensity;
  uniform float uSpeed;
  uniform float uLineAlpha;
  uniform float uLineWidth;
  uniform float uFresnelPower;
  uniform float uFresnelAlpha;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    float scanY = vWorldPosition.y * uDensity + uTime * uSpeed * uDensity;
    float scanLine = smoothstep(uLineWidth - 0.1, uLineWidth, fract(scanY));
    float scanAlpha = scanLine * uLineAlpha;

    float fresnel = 1.0 - abs(dot(normalize(vViewDir), normalize(vWorldNormal)));
    fresnel = pow(fresnel, uFresnelPower);
    float fresnelAlpha = fresnel * uFresnelAlpha;

    float totalAlpha = max(scanAlpha, fresnelAlpha) * uOpacity;
    vec3 color = mix(uTint * 0.3, uTint, fresnel);

    gl_FragColor = vec4(color, totalAlpha);
  }
`;

// ─── Ghostly shader ───────────────────────────────────────────────────────────

const ghostlyVertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ghostlyFragmentShader = /* glsl */ `
  uniform float uOpacity;
  uniform vec3  uTint;

  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    float fresnel = 1.0 - abs(dot(normalize(vViewDir), normalize(vWorldNormal)));
    fresnel = pow(fresnel, 1.5);
    float alpha = mix(0.15, 0.6, fresnel) * uOpacity;
    gl_FragColor = vec4(uTint, alpha);
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

type PropMaterialStyle = 'solid' | 'holographic' | 'ghostly';

interface ActiveProp {
  /** The root Object3D added to the scene. */
  root: THREE.Object3D;
  /** Current opacity (0–1), animated during fade. */
  opacity: number;
  /** Target opacity (0 = fading out, 1 = fading in). */
  targetOpacity: number;
  /** Material style for updating opacity uniforms. */
  materialStyle: PropMaterialStyle;
  /** References to materials for opacity updates. */
  materials: THREE.Material[];
  /** The prop binding that spawned this. */
  binding: ClipPropBinding;
}

// ─── PropManager ──────────────────────────────────────────────────────────────

export class PropManager {
  private scene: THREE.Scene;
  private loader = new GLTFLoader();
  private modelCache = new Map<string, THREE.Object3D>();
  private activeProp: ActiveProp | null = null;
  /** Props currently fading out (being removed). */
  private fadingOut: ActiveProp[] = [];
  private elapsed = 0;

  /** Shared holo uniforms — uTime ticks globally. */
  private holoUniforms = {
    uTime: { value: 0 },
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set the active prop from a clip's prop binding.
   * Pass undefined to remove the current prop (fade out).
   */
  async setPropBinding(binding: ClipPropBinding | undefined): Promise<void> {
    // Same prop already active — no-op
    if (this.activeProp && binding && this._isSameBinding(this.activeProp.binding, binding)) {
      return;
    }

    // Fade out current prop
    if (this.activeProp) {
      this.activeProp.targetOpacity = 0;
      this.fadingOut.push(this.activeProp);
      this.activeProp = null;
    }

    if (!binding) return;

    try {
      let model = this.modelCache.get(binding.prop);

      if (!model) {
        const url = PROP_BASE_PATH + binding.prop + '.glb';
        const gltf = await this.loader.loadAsync(url);
        model = gltf.scene;
        this.modelCache.set(binding.prop, model);
      }

      const instance = model.clone(true);
      const materialStyle = binding.material ?? 'holographic';
      const materials = this._applyMaterial(instance, materialStyle);

      // Apply transform from binding
      const [px, py, pz] = binding.transform.position;
      const [rx, ry, rz] = binding.transform.rotation;
      const [sx, sy, sz] = binding.transform.scale;
      instance.position.set(px, py, pz);
      instance.rotation.set(rx, ry, rz);
      instance.scale.set(sx, sy, sz);

      // Start invisible, fade in
      this._setMaterialOpacity(materials, materialStyle, 0);

      this.scene.add(instance);

      this.activeProp = {
        root: instance,
        opacity: 0,
        targetOpacity: 1,
        materialStyle,
        materials,
        binding,
      };
    } catch (err) {
      console.warn(`[PropManager] Failed to load prop "${binding.prop}":`, err);
    }
  }

  /**
   * Update fade animations. Call every frame.
   */
  update(delta: number, bobOffset = 0): void {
    this.elapsed += delta;
    this.holoUniforms.uTime.value = this.elapsed;

    // Sync active prop Y position to match idle layer bob
    if (this.activeProp && bobOffset !== 0) {
      this.activeProp.root.position.y = this.activeProp.binding.transform.position[1] + bobOffset;
    }

    // Update active prop fade-in
    if (this.activeProp) {
      this._updateFade(this.activeProp, delta);
    }

    // Update fading-out props
    for (let i = this.fadingOut.length - 1; i >= 0; i--) {
      const prop = this.fadingOut[i]!;
      this._updateFade(prop, delta);

      // Fully faded out — remove from scene
      if (prop.opacity <= 0.001) {
        this.scene.remove(prop.root);
        this._disposePropMaterials(prop);
        this.fadingOut.splice(i, 1);
      }
    }
  }

  /**
   * Remove all props immediately.
   */
  clear(): void {
    if (this.activeProp) {
      this.scene.remove(this.activeProp.root);
      this._disposePropMaterials(this.activeProp);
      this.activeProp = null;
    }
    for (const prop of this.fadingOut) {
      this.scene.remove(prop.root);
      this._disposePropMaterials(prop);
    }
    this.fadingOut.length = 0;
  }

  dispose(): void {
    this.clear();
    this.modelCache.clear();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private _updateFade(prop: ActiveProp, delta: number): void {
    const speed = 1 / FADE_DURATION;
    if (prop.opacity < prop.targetOpacity) {
      prop.opacity = Math.min(prop.opacity + speed * delta, prop.targetOpacity);
    } else if (prop.opacity > prop.targetOpacity) {
      prop.opacity = Math.max(prop.opacity - speed * delta, prop.targetOpacity);
    }
    this._setMaterialOpacity(prop.materials, prop.materialStyle, prop.opacity);
  }

  private _applyMaterial(obj: THREE.Object3D, style: PropMaterialStyle): THREE.Material[] {
    const materials: THREE.Material[] = [];

    if (style === 'solid') {
      // Keep original materials but make them support transparency for fade
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.transparent = true;
          materials.push(mat);
        }
      });
    } else if (style === 'holographic') {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = new THREE.ShaderMaterial({
            uniforms: {
              uTime: this.holoUniforms.uTime,
              uOpacity: { value: 0 },
              uTint: { value: new THREE.Color(...HOLO_CONFIG.tint) },
              uDensity: { value: HOLO_CONFIG.density },
              uSpeed: { value: HOLO_CONFIG.speed },
              uLineAlpha: { value: HOLO_CONFIG.lineAlpha },
              uLineWidth: { value: HOLO_CONFIG.lineWidth },
              uFresnelPower: { value: HOLO_CONFIG.fresnelPower },
              uFresnelAlpha: { value: HOLO_CONFIG.fresnelAlpha },
            },
            vertexShader: holoVertexShader,
            fragmentShader: holoFragmentShader,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          });
          child.material = mat;
          materials.push(mat);
        }
      });
    } else if (style === 'ghostly') {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = new THREE.ShaderMaterial({
            uniforms: {
              uOpacity: { value: 0 },
              uTint: { value: new THREE.Color(0.7, 0.85, 1.0) },
            },
            vertexShader: ghostlyVertexShader,
            fragmentShader: ghostlyFragmentShader,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          });
          child.material = mat;
          materials.push(mat);
        }
      });
    }

    return materials;
  }

  private _setMaterialOpacity(materials: THREE.Material[], style: PropMaterialStyle, opacity: number): void {
    for (const mat of materials) {
      if (style === 'solid') {
        (mat as THREE.MeshStandardMaterial).opacity = opacity;
      } else {
        // Shader materials use uOpacity uniform
        (mat as THREE.ShaderMaterial).uniforms.uOpacity!.value = opacity;
      }
    }
  }

  private _disposePropMaterials(prop: ActiveProp): void {
    for (const mat of prop.materials) {
      mat.dispose();
    }
  }

  private _isSameBinding(a: ClipPropBinding, b: ClipPropBinding): boolean {
    return (
      a.prop === b.prop &&
      a.material === b.material &&
      a.transform.position[0] === b.transform.position[0] &&
      a.transform.position[1] === b.transform.position[1] &&
      a.transform.position[2] === b.transform.position[2] &&
      a.transform.rotation[0] === b.transform.rotation[0] &&
      a.transform.rotation[1] === b.transform.rotation[1] &&
      a.transform.rotation[2] === b.transform.rotation[2] &&
      a.transform.scale[0] === b.transform.scale[0] &&
      a.transform.scale[1] === b.transform.scale[1] &&
      a.transform.scale[2] === b.transform.scale[2]
    );
  }
}
