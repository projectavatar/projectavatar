/**
 * Emotion VFX — lightweight particle effects tied to emotions/actions.
 *
 * Each VFX type is a self-contained particle system with its own
 * shaders, geometry, and update logic. VFX are spawned/despawned
 * by the VfxManager based on clips.json bindings.
 */
import * as THREE from 'three';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VfxType =
  | 'thought-bubbles'
  | 'sparkles'
  | 'hearts'
  | 'rain'
  | 'embers'
  | 'confetti'
  | 'particle-aura';

export interface VfxBinding {
  type: VfxType;
  /** Override default color (hex string, e.g. "#ff9900") */
  color?: string;
  /** Intensity multiplier (default 1.0) */
  intensity?: number;
  /** Vertical offset from avatar center (default 0) */
  offsetY?: number;
}

export interface VfxInstance {
  type: VfxType;
  object: THREE.Object3D;
  update: (time: number, delta: number) => void;
  dispose: () => void;
  /** Current opacity for fade in/out (0–1) */
  opacity: number;
  targetOpacity: number;
  setOpacity: (o: number) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────


// ─── Shared shaders ───────────────────────────────────────────────────────────

const particleVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = vAlpha * smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(vColor, alpha);
  }
`;

// ─── Factory functions ────────────────────────────────────────────────────────

export function createVfx(type: VfxType, binding: VfxBinding): VfxInstance {
  switch (type) {
    case 'thought-bubbles': return createThoughtBubbles(binding);
    case 'sparkles':        return createSparkles(binding);
    case 'hearts':          return createHearts(binding);
    case 'rain':            return createRain(binding);
    case 'embers':          return createEmbers(binding);
    case 'confetti':        return createConfetti(binding);
    case 'particle-aura': return createParticleAuraVfx(binding);
    default:
      console.warn(`[VFX] Unknown type: ${type}`);
      return createSparkles(binding); // fallback
  }
}

// ─── Thought Bubbles ──────────────────────────────────────────────────────────

function createThoughtBubbles(binding: VfxBinding): VfxInstance {
  const count = 12;
  const color = new THREE.Color(binding.color ?? '#88ccff');
  const intensity = binding.intensity ?? 1.0;
  const offsetY = binding.offsetY ?? 0.75;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  // Per-particle state
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const radii = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    phases[i] = Math.random() * Math.PI * 2;
    speeds[i] = 0.3 + Math.random() * 0.4;
    radii[i] = 0.15 + Math.random() * 0.2;
    sizes[i] = (0.08 + Math.random() * 0.06) * intensity;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = offsetY;
  points.frustumCulled = false;

  let currentOpacity = 0;

  return {
    type: 'thought-bubbles',
    object: points,
    opacity: 0,
    targetOpacity: 1,
    setOpacity(o: number) {
      currentOpacity = o;
      this.opacity = o;
    },
    update(time: number, _delta: number) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;

      for (let i = 0; i < count; i++) {
        const t = time * speeds[i]! + phases[i]!;
        const r = radii[i]!;
        // Orbit around head area
        pos.array[i * 3] = Math.cos(t) * r;
        pos.array[i * 3 + 1] = Math.sin(t * 0.7) * 0.1 + Math.sin(t * 1.3) * 0.05;
        pos.array[i * 3 + 2] = Math.sin(t) * r * 0.6;

        // Pulsing alpha
        alpha.array[i] = currentOpacity * (0.4 + 0.6 * Math.sin(t * 2 + phases[i]!) * 0.5 + 0.5);
      }
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ─── Sparkles ─────────────────────────────────────────────────────────────────

function createSparkles(binding: VfxBinding): VfxInstance {
  const count = 30;
  const color = new THREE.Color(binding.color ?? '#ffdd44');
  const intensity = binding.intensity ?? 1.0;
  const offsetY = binding.offsetY ?? 0.4;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const phases = new Float32Array(count);
  const velocities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    phases[i] = Math.random() * Math.PI * 2;
    velocities[i] = 0.2 + Math.random() * 0.4;
    sizes[i] = (0.04 + Math.random() * 0.04) * intensity;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = offsetY;
  points.frustumCulled = false;

  let currentOpacity = 0;

  return {
    type: 'sparkles',
    object: points,
    opacity: 0,
    targetOpacity: 1,
    setOpacity(o: number) { currentOpacity = o; this.opacity = o; },
    update(time: number, _delta: number) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;

      for (let i = 0; i < count; i++) {
        const t = time * velocities[i]! + phases[i]!;
        const life = (t % 3) / 3; // 0–1 lifecycle, repeats every 3s

        // Rise upward, spread outward
        const angle = phases[i]! + time * 0.3;
        const spread = 0.3 + life * 0.3;
        pos.array[i * 3] = Math.cos(angle) * spread;
        pos.array[i * 3 + 1] = life * 0.6;
        pos.array[i * 3 + 2] = Math.sin(angle) * spread;

        // Fade in, hold, fade out
        const fadeIn = Math.min(life * 5, 1);
        const fadeOut = Math.max(1 - (life - 0.7) * 3.3, 0);
        alpha.array[i] = currentOpacity * fadeIn * fadeOut * (0.6 + 0.4 * Math.sin(t * 8));
      }
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ─── Soft Glow ────────────────────────────────────────────────────────────────

// ─── Hearts ───────────────────────────────────────────────────────────────────

/** Heart shape fragment shader — SDF-based heart rendered per point. */
const heartFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    uv.y = -uv.y * 1.2;
    uv.y -= 0.1;

    float x = uv.x;
    float y = uv.y;
    float a = x * x + y * y - 0.12;
    float heart = a * a * a - x * x * y * y * y;

    if (heart > 0.0) discard;

    float alpha = vAlpha * smoothstep(0.005, -0.01, heart);
    gl_FragColor = vec4(vColor, alpha);
  }
`;

function createHearts(binding: VfxBinding): VfxInstance {
  const count = 15;
  const color = new THREE.Color(binding.color ?? '#ff6688');
  const intensity = binding.intensity ?? 1.0;
  const offsetY = binding.offsetY ?? 0.0;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const phases = new Float32Array(count);
  const startX = new Float32Array(count);
  const startZ = new Float32Array(count);
  const riseSpeed = new Float32Array(count);
  const swaySpeed = new Float32Array(count);
  const swayAmp = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    phases[i] = Math.random() * 4;
    startX[i] = (Math.random() - 0.5) * 0.6;
    startZ[i] = (Math.random() - 0.5) * 0.4;
    riseSpeed[i] = 0.15 + Math.random() * 0.15;
    swaySpeed[i] = 0.5 + Math.random() * 1.0;
    swayAmp[i] = 0.05 + Math.random() * 0.1;
    sizes[i] = (0.12 + Math.random() * 0.08) * intensity;
    const warmth = 0.7 + Math.random() * 0.3;
    colors[i * 3] = color.r * warmth;
    colors[i * 3 + 1] = color.g * warmth;
    colors[i * 3 + 2] = color.b * warmth;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: heartFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = offsetY;
  points.frustumCulled = false;

  let currentOpacity = 0;

  return {
    type: 'hearts',
    object: points,
    opacity: 0,
    targetOpacity: 1,
    setOpacity(o: number) { currentOpacity = o; this.opacity = o; },
    update(time: number, _delta: number) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;

      for (let i = 0; i < count; i++) {
        const life = ((time * riseSpeed[i]! + phases[i]!) % 4) / 4;
        const sway = Math.sin(time * swaySpeed[i]! + phases[i]! * 3) * swayAmp[i]!;

        pos.array[i * 3] = startX[i]! + sway;
        pos.array[i * 3 + 1] = life * 1.5;
        pos.array[i * 3 + 2] = startZ[i]!;

        const fadeIn = Math.min(life * 4, 1);
        const fadeOut = Math.max(1 - (life - 0.6) * 2.5, 0);
        alpha.array[i] = currentOpacity * fadeIn * fadeOut * 0.8;
      }
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ─── Rain ─────────────────────────────────────────────────────────────────────

function createRain(binding: VfxBinding): VfxInstance {
  const count = 25;
  const color = new THREE.Color(binding.color ?? '#6699cc');
  const intensity = binding.intensity ?? 1.0;
  const offsetY = binding.offsetY ?? 0.8;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const phases = new Float32Array(count);
  const startX = new Float32Array(count);
  const startZ = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    phases[i] = Math.random();
    startX[i] = (Math.random() - 0.5) * 0.8;
    startZ[i] = (Math.random() - 0.5) * 0.5;
    sizes[i] = (0.02 + Math.random() * 0.015) * intensity;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = offsetY;
  points.frustumCulled = false;

  let currentOpacity = 0;

  return {
    type: 'rain',
    object: points,
    opacity: 0,
    targetOpacity: 1,
    setOpacity(o: number) { currentOpacity = o; this.opacity = o; },
    update(time: number, _delta: number) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;

      for (let i = 0; i < count; i++) {
        const life = ((time * 0.8 + phases[i]!) % 1); // 0–1, loops
        pos.array[i * 3] = startX[i]!;
        pos.array[i * 3 + 1] = -life * 1.2; // fall downward
        pos.array[i * 3 + 2] = startZ[i]!;

        // Fade in at top, fade out at bottom
        const fadeIn = Math.min(life * 4, 1);
        const fadeOut = 1 - life;
        alpha.array[i] = currentOpacity * fadeIn * fadeOut * 0.7;
      }
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ─── Embers ───────────────────────────────────────────────────────────────────

function createEmbers(binding: VfxBinding): VfxInstance {
  const count = 20;
  const color = new THREE.Color(binding.color ?? '#ff6622');
  const intensity = binding.intensity ?? 1.0;
  const offsetY = binding.offsetY ?? 0;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const phases = new Float32Array(count);
  const driftX = new Float32Array(count);
  const driftZ = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    phases[i] = Math.random();
    driftX[i] = (Math.random() - 0.5) * 0.6;
    driftZ[i] = (Math.random() - 0.5) * 0.4;
    sizes[i] = (0.03 + Math.random() * 0.03) * intensity;
    // Warm gradient: orange to red
    const warmth = Math.random();
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g * (0.5 + warmth * 0.5);
    colors[i * 3 + 2] = color.b * warmth;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = offsetY;
  points.frustumCulled = false;

  let currentOpacity = 0;

  return {
    type: 'embers',
    object: points,
    opacity: 0,
    targetOpacity: 1,
    setOpacity(o: number) { currentOpacity = o; this.opacity = o; },
    update(time: number, _delta: number) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;

      for (let i = 0; i < count; i++) {
        const life = ((time * 0.3 + phases[i]!) % 2) / 2; // 0–1 over 2s
        const wobble = Math.sin(time * 3 + phases[i]! * 10) * 0.05;

        pos.array[i * 3] = driftX[i]! + wobble;
        pos.array[i * 3 + 1] = life * 1.0; // rise upward
        pos.array[i * 3 + 2] = driftZ[i]!;

        // Flicker + lifecycle fade
        const flicker = 0.6 + 0.4 * Math.sin(time * 12 + phases[i]! * 20);
        const fadeOut = 1 - life * life; // quadratic fade
        alpha.array[i] = currentOpacity * flicker * fadeOut * 0.8;
      }
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

function createConfetti(binding: VfxBinding): VfxInstance {
  const count = 40;
  const intensity = binding.intensity ?? 1.0;
  const offsetY = binding.offsetY ?? 1.2;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const phases = new Float32Array(count);
  const driftX = new Float32Array(count);
  const driftZ = new Float32Array(count);
  const swaySpeed = new Float32Array(count);

  const confettiColors = [
    new THREE.Color('#ff4466'),
    new THREE.Color('#44aaff'),
    new THREE.Color('#ffdd44'),
    new THREE.Color('#44ff88'),
    new THREE.Color('#ff88ff'),
    new THREE.Color('#ffaa22'),
  ];

  for (let i = 0; i < count; i++) {
    phases[i] = Math.random();
    driftX[i] = (Math.random() - 0.5) * 1.2;
    driftZ[i] = (Math.random() - 0.5) * 0.8;
    swaySpeed[i] = 2 + Math.random() * 3;
    sizes[i] = (0.04 + Math.random() * 0.03) * intensity;
    const c = confettiColors[Math.floor(Math.random() * confettiColors.length)]!;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = offsetY;
  points.frustumCulled = false;

  let currentOpacity = 0;

  return {
    type: 'confetti',
    object: points,
    opacity: 0,
    targetOpacity: 1,
    setOpacity(o: number) { currentOpacity = o; this.opacity = o; },
    update(time: number, _delta: number) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;

      for (let i = 0; i < count; i++) {
        const life = ((time * 0.4 + phases[i]!) % 2.5) / 2.5;
        const sway = Math.sin(time * swaySpeed[i]! + phases[i]! * 5) * 0.15;

        pos.array[i * 3] = driftX[i]! + sway;
        pos.array[i * 3 + 1] = -life * 1.5; // fall downward
        pos.array[i * 3 + 2] = driftZ[i]!;

        // Tumbling alpha
        const tumble = 0.5 + 0.5 * Math.sin(time * 6 + phases[i]! * 10);
        const fadeOut = Math.max(1 - (life - 0.6) * 2.5, 0);
        alpha.array[i] = currentOpacity * tumble * fadeOut;
      }
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ─── Particle Aura ─────────────────────────────────────────────────────────

function createParticleAuraVfx(binding: VfxBinding): VfxInstance {
  const count = 80;
  const color = new THREE.Color(binding.color ?? '#4d99ff');
  const intensity = binding.intensity ?? 1.0;
  const offsetY = binding.offsetY ?? 0.2;

  // Dreamy, full-body aura — slow drifting, varied radii
  const ORBIT_RADIUS = 0.7;       // wider base orbit
  const ORBIT_RADIUS_VAR = 0.5;   // lots of variation (0.2 – 1.2)
  const ORBIT_SPEED = 0.025;       // much slower (was 0.3)
  const ORBIT_SPEED_VAR = 0.02;   // some faster, some glacial
  const VERTICAL_RANGE = 1.4;     // full body height coverage
  const VERTICAL_BOB = 0.08;      // gentle drift up/down
  const VERTICAL_BOB_FREQ = 0.05; // very slow bob
  const PULSE_FREQ = 0.13;         // slow global pulse
  const PULSE_AMOUNT = 0.2;       // subtle

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  // Per-particle state — each on its own lazy trajectory
  const orbitR = new Float32Array(count);
  const orbitSpeed = new Float32Array(count);
  const orbitPhase = new Float32Array(count);
  const verticalOffset = new Float32Array(count);
  // Secondary motion — each particle has its own wobble
  const wobbleFreq = new Float32Array(count);
  const wobbleAmp = new Float32Array(count);
  const wobblePhase = new Float32Array(count);
  // Vertical drift speed (each particle drifts at its own pace)
  const vertDriftFreq = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    orbitR[i] = ORBIT_RADIUS + (Math.random() - 0.5) * ORBIT_RADIUS_VAR;
    orbitSpeed[i] = ORBIT_SPEED + (Math.random() - 0.5) * ORBIT_SPEED_VAR;
    orbitPhase[i] = Math.random() * Math.PI * 2;
    verticalOffset[i] = (Math.random() - 0.5) * VERTICAL_RANGE;
    // Wobble — small random drift perpendicular to orbit
    wobbleFreq[i] = 0.03 + Math.random() * 0.1;
    wobbleAmp[i] = 0.05 + Math.random() * 0.15;
    wobblePhase[i] = Math.random() * Math.PI * 2;
    // Each particle bobs at its own frequency
    vertDriftFreq[i] = VERTICAL_BOB_FREQ * (0.5 + Math.random());
    sizes[i] = (0.05 + Math.random() * 0.05) * intensity;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = offsetY;
  points.frustumCulled = false;

  let currentOpacity = 0;

  return {
    type: 'particle-aura',
    object: points,
    opacity: 0,
    targetOpacity: 1,
    setOpacity(o: number) { currentOpacity = o; this.opacity = o; },
    update(time: number, _delta: number) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;

      const pulse = 1.0 + Math.sin(time * PULSE_FREQ * Math.PI * 2) * PULSE_AMOUNT;

      for (let i = 0; i < count; i++) {
        const angle = time * orbitSpeed[i]! * Math.PI * 2 + orbitPhase[i]!;
        const r = orbitR[i]!;
        const bob = Math.sin(time * vertDriftFreq[i]! * Math.PI * 2 + orbitPhase[i]!) * VERTICAL_BOB;
        // Wobble — perpendicular drift for organic, non-circular motion
        const wob = Math.sin(time * wobbleFreq[i]! * Math.PI * 2 + wobblePhase[i]!) * wobbleAmp[i]!;

        pos.array[i * 3] = Math.cos(angle) * r + wob * Math.sin(angle);
        pos.array[i * 3 + 1] = verticalOffset[i]! + bob;
        pos.array[i * 3 + 2] = Math.sin(angle) * r + wob * Math.cos(angle);

        // Pulsing alpha — layered sine waves for organic randomness
        const p1 = Math.sin(time * 0.4 + orbitPhase[i]! * 5);
        const p2 = Math.sin(time * 0.17 + wobblePhase[i]! * 3);
        const p3 = Math.sin(time * 0.9 + orbitPhase[i]! * 7 + wobblePhase[i]!);
        const particlePulse = 0.15 + 0.85 * Math.max(0, (p1 * 0.5 + p2 * 0.3 + p3 * 0.2));
        alpha.array[i] = currentOpacity * particlePulse * pulse;
      }
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
