/**
 * PremultiplyAlphaPass — final shader pass that multiplies RGB by Alpha.
 *
 * WebView2 (and most OS compositors) expect premultiplied alpha for
 * transparent window compositing. Three.js renders straight alpha,
 * causing dark fringe artifacts on light backgrounds.
 *
 * This pass converts straight alpha → premultiplied alpha:
 *   outRGB = inRGB * inAlpha
 *   outAlpha = inAlpha
 */
import { ShaderMaterial, UniformsUtils } from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const PremultiplyAlphaShader = {
  uniforms: {
    tDiffuse: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // Premultiply: RGB *= Alpha
      gl_FragColor = vec4(color.rgb * color.a, color.a);
    }
  `,
};

export class PremultiplyAlphaPass extends Pass {
  private fsQuad: FullScreenQuad;
  uniforms: Record<string, { value: unknown }>;

  constructor() {
    super();
    const shader = PremultiplyAlphaShader;
    this.uniforms = UniformsUtils.clone(shader.uniforms);
    this.fsQuad = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader,
      }),
    );
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
    }

    this.fsQuad.render(renderer);
  }

  dispose(): void {
    (this.fsQuad.material as ShaderMaterial).dispose();
  }
}
