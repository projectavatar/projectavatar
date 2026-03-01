/**
 * ParticleAura — glowing particles orbiting the avatar.
 *
 * Uses THREE.Points with a custom ShaderMaterial for soft glow.
 * Particles orbit in a toroidal pattern around the avatar body center,
 * with gentle vertical bob and randomized phase offsets.
 */
import * as THREE from 'three';

// ─── Configuration ────────────────────────────────────────────────────────────

const PARTICLE_COUNT     = 120;
const ORBIT_RADIUS       = 0.55;
const ORBIT_RADIUS_VAR   = 0.3;
const ORBIT_SPEED        = 0.3;
const ORBIT_SPEED_VAR    = 0.15;
const VERTICAL_RANGE     = 0.8;
const VERTICAL_BOB       = 0.04;
const VERTICAL_BOB_FREQ  = 0.5;
const PARTICLE_SIZE      = 0.04;
const PARTICLE_SIZE_VAR  = 0.02;
const FADE_SPEED         = 2.0;
const PULSE_FREQ         = 0.8;
const PULSE_AMOUNT       = 0.3;

const DEFAULT_COLOR = new THREE.Color(0.3, 0.6, 1.0);

// ─── Shaders ──────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.0);
    gl_FragColor = vec4(uColor, vAlpha * glow);
  }
`;

// ─── ParticleAura ─────────────────────────────────────────────────────────────

interface ParticleData {
  radius: number;
  speed: number;
  phase: number;
  heightOffset: number;
  baseSize: number;
  bobPhase: number;
}

export class ParticleAura {
  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private particles: ParticleData[] = [];
  private positions: Float32Array;
  private sizes: Float32Array;
  private alphas: Float32Array;
  private elapsed = 0;
  private targetOpacity = 0;
  private currentOpacity = 0;
  private _enabled = false;
  private center = new THREE.Vector3(0, 0, 0);

  constructor() {
    this.positions = new Float32Array(PARTICLE_COUNT * 3);
    this.sizes     = new Float32Array(PARTICLE_COUNT);
    this.alphas    = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({
        radius:       ORBIT_RADIUS + (Math.random() - 0.5) * 2 * ORBIT_RADIUS_VAR,
        speed:        ORBIT_SPEED + (Math.random() - 0.5) * 2 * ORBIT_SPEED_VAR,
        phase:        Math.random() * Math.PI * 2,
        heightOffset: (Math.random() - 0.5) * VERTICAL_RANGE,
        baseSize:     PARTICLE_SIZE + (Math.random() - 0.5) * 2 * PARTICLE_SIZE_VAR,
        bobPhase:     Math.random() * Math.PI * 2,
      });
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize',    new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha',   new THREE.BufferAttribute(this.alphas, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: DEFAULT_COLOR.clone() } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  get object3D(): THREE.Object3D { return this.points; }

  setCenter(center: THREE.Vector3): void { this.center.copy(center); }

  setColor(color: THREE.Color): void {
    (this.material.uniforms['uColor'] as { value: THREE.Color }).value.copy(color);
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.targetOpacity = value ? 1 : 0;
    if (value) this.points.visible = true;
  }

  get enabled(): boolean { return this._enabled; }

  update(delta: number): void {
    if (!this.points.visible) return;

    this.elapsed += delta;
    const t = this.elapsed;

    this.currentOpacity = THREE.MathUtils.lerp(
      this.currentOpacity, this.targetOpacity,
      1 - Math.exp(-FADE_SPEED * delta),
    );

    if (this.currentOpacity < 0.001 && this.targetOpacity === 0) {
      this.points.visible = false;
      this.currentOpacity = 0;
      return;
    }

    const pulse = 1 - PULSE_AMOUNT + Math.sin(t * PULSE_FREQ * Math.PI * 2) * PULSE_AMOUNT;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i]!;
      const angle = t * p.speed + p.phase;

      this.positions[i * 3]     = this.center.x + Math.cos(angle) * p.radius;
      this.positions[i * 3 + 1] = this.center.y + p.heightOffset
                                + Math.sin(t * VERTICAL_BOB_FREQ * Math.PI * 2 + p.bobPhase) * VERTICAL_BOB;
      this.positions[i * 3 + 2] = this.center.z + Math.sin(angle) * p.radius;

      this.sizes[i] = p.baseSize;
      this.alphas[i] = this.currentOpacity * pulse
                     * (0.5 + 0.5 * Math.sin(t * 1.2 + p.phase));
    }

    this.geometry.attributes['position']!.needsUpdate = true;
    this.geometry.attributes['aSize']!.needsUpdate = true;
    this.geometry.attributes['aAlpha']!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
