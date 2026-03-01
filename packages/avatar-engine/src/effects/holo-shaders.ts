/**
 * Shared holographic shader fragments.
 *
 * Inspired by Anderson Mancini's HolographicMaterial (MIT).
 * Two vertex shader variants:
 *   - holoVertexSkinned: for SkinnedMesh overlays (body)
 *   - holoVertexStatic:  for static meshes (props)
 *
 * Shared fragment with screen-space scanlines, fresnel, flicker,
 * chromatic noise, and random glitch bands.
 */

// ─── Fragment (shared) ────────────────────────────────────────────────────────

export const holoFragment = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3  uTint;
  uniform float uDensity;
  uniform float uSpeed;
  uniform float uLineAlpha;
  uniform float uLineWidth;
  uniform float uFresnelPower;
  uniform float uFresnelAlpha;
  uniform float uBrightness;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec4 vClipPos;

  // Pseudo-random hash
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float random2(float a, float b) { return fract(cos(dot(vec2(a, b), vec2(12.9898, 78.233))) * 43758.5453); }

  // Chaotic flicker — more organic than layered sines
  float flicker(float floor, float t) { return clamp(fract(cos(t) * 43758.5453), floor, 1.0); }

  void main() {
    // Screen-space UVs for scanlines (resolution-independent)
    vec2 screenUV = (vClipPos.xy / vClipPos.w) * 0.5 + 0.5;

    // ── Primary scanlines (screen-space) ──
    float scanBase = 10.0;
    scanBase += 20.0 * sin(uTime * uSpeed * 20.8 - screenUV.y * 60.0 * uDensity);
    scanBase *= smoothstep(1.3 * cos(uTime * uSpeed + screenUV.y * uDensity), 0.78, 0.9);
    scanBase *= max(0.25, sin(uTime * uSpeed) * 1.0);

    // Per-pixel chromatic noise on scanlines
    float rNoise = random2(screenUV.x, screenUV.y);
    float gNoise = random2(screenUV.y * 20.2, screenUV.y * 0.2);
    float bNoise = random2(screenUV.y * 0.9, screenUV.y * 0.2);
    vec3 scanColor = vec3(rNoise * scanBase, gNoise * scanBase, bNoise * scanBase) / 84.0;

    float scanAlpha = length(scanColor) * uLineAlpha * 3.0;

    // ── Fresnel edge glow ──
    float fresnel = 1.0 - abs(dot(normalize(vViewDir), normalize(vWorldNormal)));
    fresnel = pow(fresnel, uFresnelPower);
    float fresnelAlpha = fresnel * uFresnelAlpha;

    // ── Chaotic flicker ──
    float blinkFloor = 0.6 - uSpeed;
    float blink = flicker(max(blinkFloor, 0.3), uTime * uSpeed * 0.02);

    // ── Glitch bands — occasional horizontal distortion ──
    float glitchSeed = floor(uTime * 2.0);
    float glitchChance = hash(glitchSeed);
    float glitchBand = 0.0;
    if (glitchChance > 0.85) {
      float bandY = hash(glitchSeed + 1.0);
      float bandWidth = 0.02 + hash(glitchSeed + 2.0) * 0.05;
      float dist = abs(screenUV.y - bandY);
      glitchBand = smoothstep(bandWidth, 0.0, dist) * 0.4;
    }

    // ── Brightness gradient (bottom darker, top brighter like a projector) ──
    float heightGrad = mix(uBrightness * 0.6, uBrightness, screenUV.y);

    // ── Composite ──
    float totalAlpha = (max(scanAlpha, fresnelAlpha) + glitchBand) * blink * uOpacity;
    vec3 color = mix(uTint * 0.3, uTint * heightGrad, fresnel);
    color += scanColor * uTint * 2.0;

    // Chromatic shift on glitch
    color += vec3(glitchBand * 0.3, -glitchBand * 0.15, glitchBand * 0.2);

    gl_FragColor = vec4(color, totalAlpha);
  }
`;

// ─── Vertex: skinned (body overlay) ───────────────────────────────────────────

export const holoVertexSkinned = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>

  uniform float uNormalOffset;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec4 vClipPos;

  void main() {
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>

    vec3 skinNormal = normalize(mat3(modelMatrix) * objectNormal);
    transformed += skinNormal * uNormalOffset;

    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = skinNormal;
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    vClipPos = projectionMatrix * viewMatrix * worldPos;
    gl_Position = vClipPos;
  }
`;

// ─── Vertex: static (props) ──────────────────────────────────────────────────

export const holoVertexStatic = /* glsl */ `
  uniform float uNormalOffset;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec4 vClipPos;

  void main() {
    vec3 pos = position + normal * uNormalOffset;
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    vClipPos = projectionMatrix * viewMatrix * worldPos;
    gl_Position = vClipPos;
  }
`;
