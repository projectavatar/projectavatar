/**
 * Holographic — scrolling scan lines + slight transparency on the VRM model.
 *
 * Patches the VRM's existing materials by injecting a custom shader chunk
 * that adds horizontal scan lines scrolling upward. Non-destructive —
 * stores original materials for clean removal.
 *
 * The effect modifies material opacity and adds a repeating line pattern
 * using onBeforeCompile to inject into the fragment shader.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Configuration ────────────────────────────────────────────────────────────

const SCAN_LINE_COUNT    = 80;    // lines per world-space unit
const SCAN_LINE_SPEED    = 0.3;   // scroll speed (world units/sec)
const SCAN_LINE_OPACITY  = 0.08;  // how much scan lines darken (0 = invisible, 1 = full black)
const SCAN_LINE_WIDTH    = 0.4;   // line duty cycle (0–1, higher = thicker lines)
const BASE_OPACITY       = 0.92;  // slight transparency for holographic feel
const EDGE_GLOW_AMOUNT   = 0.15;  // fresnel edge glow intensity
const FADE_SPEED         = 2.0;

const DEFAULT_TINT = new THREE.Color(0.7, 0.85, 1.0); // subtle blue tint

// ─── Holographic ──────────────────────────────────────────────────────────────

interface OriginalMaterialState {
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  side: THREE.Side;
  onBeforeCompile: ((shader: THREE.WebGLProgramParametersWithUniforms) => void) | null;
}

export class Holographic {
  private vrm: VRM;
  private _enabled = false;
  private targetStrength = 0;
  private currentStrength = 0;
  private elapsed = 0;
  private patchedMaterials = new Map<THREE.Material, OriginalMaterialState>();
  private uniforms = {
    uTime:       { value: 0.0 },
    uStrength:   { value: 0.0 },
    uTint:       { value: DEFAULT_TINT.clone() },
    uLineCount:  { value: SCAN_LINE_COUNT },
    uLineSpeed:  { value: SCAN_LINE_SPEED },
    uLineOpacity:{ value: SCAN_LINE_OPACITY },
    uLineWidth:  { value: SCAN_LINE_WIDTH },
    uEdgeGlow:   { value: EDGE_GLOW_AMOUNT },
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
    if (value) this._patchMaterials();
  }

  get enabled(): boolean { return this._enabled; }

  update(delta: number): void {
    this.elapsed += delta;
    this.uniforms.uTime.value = this.elapsed;

    this.currentStrength = THREE.MathUtils.lerp(
      this.currentStrength, this.targetStrength,
      1 - Math.exp(-FADE_SPEED * delta),
    );

    this.uniforms.uStrength.value = this.currentStrength;

    // Update opacity on patched materials
    for (const [mat, original] of this.patchedMaterials) {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
        mat.opacity = THREE.MathUtils.lerp(original.opacity, BASE_OPACITY, this.currentStrength);
      }
    }

    if (this.currentStrength < 0.001 && this.targetStrength === 0) {
      this._unpatchMaterials();
    }
  }

  dispose(): void {
    this._unpatchMaterials();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private _patchMaterials(): void {
    if (this.patchedMaterials.size > 0) return; // already patched

    this.vrm.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (this.patchedMaterials.has(mat)) continue;

        // Store original state
        this.patchedMaterials.set(mat, {
          transparent: mat.transparent,
          opacity: mat instanceof THREE.MeshStandardMaterial ? mat.opacity : 1,
          depthWrite: mat.depthWrite,
          side: mat.side,
          onBeforeCompile: mat.onBeforeCompile as ((shader: THREE.WebGLProgramParametersWithUniforms) => void) | null,
        });

        // Modify material
        mat.transparent = true;
        mat.depthWrite = true; // still write depth for correct ordering

        // Inject scan line shader
        const unis = this.uniforms;
        mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
          // Add uniforms
          Object.assign(shader.uniforms, unis);

          // Inject into fragment shader — add scan lines after diffuse color
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            /* glsl */ `
            // ─── Holographic scan lines ───
            {
              float scanY = vViewPosition.y * uLineCount + uTime * uLineSpeed * uLineCount;
              float scanLine = smoothstep(uLineWidth - 0.1, uLineWidth, fract(scanY));
              gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * uTint, uStrength * 0.3);
              gl_FragColor.rgb -= scanLine * uLineOpacity * uStrength;

              // Fresnel edge glow
              vec3 viewDir = normalize(vViewPosition);
              float fresnel = 1.0 - abs(dot(viewDir, normalize(vNormal)));
              fresnel = pow(fresnel, 3.0);
              gl_FragColor.rgb += uTint * fresnel * uEdgeGlow * uStrength;
            }
            #include <dithering_fragment>
            `,
          );

          // Ensure we have vViewPosition and vNormal available
          if (!shader.fragmentShader.includes('varying vec3 vNormal;')) {
            shader.fragmentShader = 'varying vec3 vNormal;\n' + shader.fragmentShader;
          }

          shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            /* glsl */ `
            #include <begin_vertex>
            `,
          );
        };

        mat.needsUpdate = true;
      }
    });
  }

  private _unpatchMaterials(): void {
    for (const [mat, original] of this.patchedMaterials) {
      mat.transparent = original.transparent;
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
        mat.opacity = original.opacity;
      }
      mat.depthWrite = original.depthWrite;
      mat.side = original.side;
      mat.onBeforeCompile = original.onBeforeCompile ?? (() => {});
      mat.needsUpdate = true;
    }
    this.patchedMaterials.clear();
  }
}
