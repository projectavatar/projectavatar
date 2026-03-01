/**
 * EnergyTrails — ribbon-like energy trails following avatar hands.
 *
 * Each trail is a ribbon mesh that records bone positions over time
 * and renders them as a fading trail with additive blending.
 * The trail width and opacity decay over the trail length.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ─── Configuration ────────────────────────────────────────────────────────────

const TRAIL_LENGTH   = 20;     // number of trail segments
const TRAIL_WIDTH    = 0.015;  // ribbon half-width
const SAMPLE_RATE    = 1 / 30; // sample bone position every ~33ms
const FADE_SPEED     = 2.0;
const MIN_MOVE_DIST  = 0.001;  // minimum movement to record a sample

const DEFAULT_COLOR = new THREE.Color(1.0, 1.0, 1.0);

// ─── Trail vertex/fragment shaders ────────────────────────────────────────────

const vertexShader = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  }
`;

// ─── Single trail ─────────────────────────────────────────────────────────────

class Trail {
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private positions: Float32Array;
  private alphas: Float32Array;
  private history: THREE.Vector3[] = [];
  private camera: THREE.Camera | null = null;

  constructor(color: THREE.Color) {
    // 2 vertices per segment (left/right of ribbon)
    const vertCount = TRAIL_LENGTH * 2;
    this.positions = new Float32Array(vertCount * 3);
    this.alphas    = new Float32Array(vertCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aAlpha',   new THREE.BufferAttribute(this.alphas, 1));

    // Build triangle strip indices
    const indices: number[] = [];
    for (let i = 0; i < TRAIL_LENGTH - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    this.geometry.setIndex(indices);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor:   { value: color.clone() },
        uOpacity: { value: 0.0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    // Initialize history
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      this.history.push(new THREE.Vector3());
    }
  }

  get object3D(): THREE.Object3D { return this.mesh; }

  setCamera(camera: THREE.Camera): void { this.camera = camera; }

  setColor(color: THREE.Color): void {
    (this.material.uniforms['uColor'] as { value: THREE.Color }).value.copy(color);
  }

  setOpacity(opacity: number): void {
    (this.material.uniforms['uOpacity'] as { value: number }).value = opacity;
  }

  /** Add a new position sample to the trail head. */
  addSample(pos: THREE.Vector3): void {
    // Check minimum movement
    const head = this.history[0]!;
    if (head.distanceTo(pos) < MIN_MOVE_DIST) return;

    // Shift history down
    for (let i = this.history.length - 1; i > 0; i--) {
      this.history[i]!.copy(this.history[i - 1]!);
    }
    this.history[0]!.copy(pos);
  }

  /** Rebuild the ribbon geometry from history. */
  updateGeometry(): void {
    if (!this.camera) return;

    const cameraPos = this.camera.position;
    const up = new THREE.Vector3();
    const tangent = new THREE.Vector3();

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const point = this.history[i]!;
      const alpha = 1 - i / (TRAIL_LENGTH - 1); // 1 at head, 0 at tail
      const width = TRAIL_WIDTH * alpha; // thinner at tail

      // Compute tangent from adjacent points
      if (i < TRAIL_LENGTH - 1) {
        tangent.subVectors(this.history[i]!, this.history[i + 1]!).normalize();
      }

      // Billboard direction: perpendicular to tangent and view direction
      up.subVectors(cameraPos, point).cross(tangent).normalize().multiplyScalar(width);

      const idx = i * 2;
      // Left vertex
      this.positions[idx * 3]     = point.x + up.x;
      this.positions[idx * 3 + 1] = point.y + up.y;
      this.positions[idx * 3 + 2] = point.z + up.z;
      // Right vertex
      this.positions[(idx + 1) * 3]     = point.x - up.x;
      this.positions[(idx + 1) * 3 + 1] = point.y - up.y;
      this.positions[(idx + 1) * 3 + 2] = point.z - up.z;

      this.alphas[idx]     = alpha * alpha; // quadratic falloff
      this.alphas[idx + 1] = alpha * alpha;
    }

    this.geometry.attributes['position']!.needsUpdate = true;
    this.geometry.attributes['aAlpha']!.needsUpdate = true;
  }

  /** Reset the trail (teleport all points to a position). */
  reset(pos: THREE.Vector3): void {
    for (const p of this.history) p.copy(pos);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ─── EnergyTrails ─────────────────────────────────────────────────────────────

export class EnergyTrails {
  private _vrm: VRM;
  private leftTrail: Trail;
  private rightTrail: Trail;
  private leftHand: THREE.Object3D | null = null;
  private rightHand: THREE.Object3D | null = null;
  private _enabled = false;
  private targetOpacity = 0;
  private currentOpacity = 0;
  private sampleAccum = 0;
  private initialized = false;
  private _worldPos = new THREE.Vector3();

  constructor(vrm: VRM) {
    this._vrm = vrm; void this._vrm;

    this.leftTrail  = new Trail(DEFAULT_COLOR);
    this.rightTrail = new Trail(DEFAULT_COLOR);

    const h = vrm.humanoid;
    if (h) {
      this.leftHand  = h.getNormalizedBoneNode('leftHand');
      this.rightHand = h.getNormalizedBoneNode('rightHand');
      this.initialized = !!(this.leftHand || this.rightHand);
    }
  }

  get objects(): THREE.Object3D[] {
    return [this.leftTrail.object3D, this.rightTrail.object3D];
  }

  setCamera(camera: THREE.Camera): void {
    this.leftTrail.setCamera(camera);
    this.rightTrail.setCamera(camera);
  }

  setColor(color: THREE.Color): void {
    this.leftTrail.setColor(color);
    this.rightTrail.setColor(color);
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.targetOpacity = value ? 1 : 0;
  }

  get enabled(): boolean { return this._enabled; }

  update(delta: number): void {
    if (!this.initialized) return;

    // Fade
    this.currentOpacity = THREE.MathUtils.lerp(
      this.currentOpacity, this.targetOpacity,
      1 - Math.exp(-FADE_SPEED * delta),
    );

    this.leftTrail.setOpacity(this.currentOpacity);
    this.rightTrail.setOpacity(this.currentOpacity);

    if (this.currentOpacity < 0.001 && this.targetOpacity === 0) return;

    // Sample positions at fixed rate
    this.sampleAccum += delta;
    if (this.sampleAccum >= SAMPLE_RATE) {
      this.sampleAccum = 0;

      if (this.leftHand) {
        this.leftHand.getWorldPosition(this._worldPos);
        this.leftTrail.addSample(this._worldPos);
      }
      if (this.rightHand) {
        this.rightHand.getWorldPosition(this._worldPos);
        this.rightTrail.addSample(this._worldPos);
      }
    }

    this.leftTrail.updateGeometry();
    this.rightTrail.updateGeometry();
  }

  /** Reset trails to current hand positions. */
  reset(): void {
    if (this.leftHand) {
      this.leftHand.getWorldPosition(this._worldPos);
      this.leftTrail.reset(this._worldPos);
    }
    if (this.rightHand) {
      this.rightHand.getWorldPosition(this._worldPos);
      this.rightTrail.reset(this._worldPos);
    }
  }

  dispose(): void {
    this.leftTrail.dispose();
    this.rightTrail.dispose();
  }
}
