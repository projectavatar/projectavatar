/**
 * Shared holographic shader fragments.
 *
 * Two vertex shader variants:
 *   - holoVertexSkinned: for SkinnedMesh overlays (body)
 *   - holoVertexStatic:  for static meshes (props)
 *
 * One shared fragment shader with scanlines, fresnel, flicker, and glitch.
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

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  // Pseudo-random hash
  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    // Scan lines with randomized density/speed drift
    float densityDrift = uDensity * (0.9 + 0.2 * sin(uTime * 0.3 + 2.7));
    float speedDrift = uSpeed * (0.6 + 0.8 * sin(uTime * 0.17 + 1.3));
    float scanY = vWorldPosition.y * densityDrift + uTime * speedDrift * densityDrift;
    float scanLine = smoothstep(uLineWidth - 0.1, uLineWidth, fract(scanY));
    float scanAlpha = scanLine * uLineAlpha;

    // Secondary scan lines — finer, faster, perpendicular feel
    float scan2 = fract(vWorldPosition.y * densityDrift * 3.0 + uTime * speedDrift * 0.7);
    float scanLine2 = smoothstep(0.85, 0.9, scan2);
    scanAlpha = max(scanAlpha, scanLine2 * uLineAlpha * 0.3);

    // Fresnel edge glow
    float fresnel = 1.0 - abs(dot(normalize(vViewDir), normalize(vWorldNormal)));
    fresnel = pow(fresnel, uFresnelPower);
    float fresnelAlpha = fresnel * uFresnelAlpha;

    // Flicker — irregular brightness pulses
    float flicker = 0.85
      + 0.08 * sin(uTime * 3.7)
      + 0.05 * sin(uTime * 7.3 + 1.2)
      + 0.02 * sin(uTime * 23.1 + 3.5);

    // Glitch bands — occasional horizontal distortion
    float glitchSeed = floor(uTime * 2.0);
    float glitchChance = hash(glitchSeed);
    float glitchBand = 0.0;
    if (glitchChance > 0.85) {
      float bandY = hash(glitchSeed + 1.0);
      float bandWidth = 0.02 + hash(glitchSeed + 2.0) * 0.05;
      float dist = abs(fract(vWorldPosition.y * 0.5) - bandY);
      glitchBand = smoothstep(bandWidth, 0.0, dist) * 0.3;
    }

    float totalAlpha = (max(scanAlpha, fresnelAlpha) + glitchBand) * flicker * uOpacity;
    vec3 color = mix(uTint * 0.3, uTint, fresnel);

    // Slight color shift on glitch
    color += vec3(glitchBand * 0.2, -glitchBand * 0.1, glitchBand * 0.15);

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

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// ─── Vertex: static (props) ──────────────────────────────────────────────────

export const holoVertexStatic = /* glsl */ `
  uniform float uNormalOffset;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vec3 pos = position + normal * uNormalOffset;
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;
