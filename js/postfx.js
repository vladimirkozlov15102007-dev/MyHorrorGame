// Cinematic post-processing in a single shader pass.
//
// Pipeline per frame:
//   1) Render main scene into a WebGLRenderTarget (HDR-ish with float if supported).
//   2) Derive a small "bloom" texture from the scene using:
//        - a bright-pass (threshold) downsample
//        - a single cheap separable blur (horizontal + vertical in one pass)
//   3) Fullscreen pass composites: base + bloom + chromatic aberration + vignette
//      + subtle scanlines + film grain + a slight color grade.
//   4) Renderer is configured with ACESFilmicToneMapping for filmic range.
//
// Use:
//   const postfx = new PostFX(renderer);
//   postfx.setSize(w, h);          // call on resize
//   postfx.render(scene, camera);  // replaces renderer.render(scene, camera)
//   postfx.uniforms.vignette.value = 1.1;   // optional runtime tweaks
//   postfx.uniforms.damageFlash.value = 0.4; // red pulse on hit
//
// Notes:
//   Pipeline is intentionally lightweight for browser perf.  EffectComposer
//   is NOT used — we stay on a small, dependency-free implementation that
//   works with vanilla `three` module imports.

import * as THREE from "three";

const FSQUAD_GEO = new THREE.PlaneGeometry(2, 2);

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const dpr = Math.min(window.devicePixelRatio, 2);
    this._dpr = dpr;

    // ==== Render targets ====
    const mkRT = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      depthBuffer: true, stencilBuffer: false,
      ...opts,
    });

    // Full resolution
    this.rtMain = mkRT(2, 2);
    this.rtBright = mkRT(2, 2, { depthBuffer: false });
    this.rtBlurH  = mkRT(2, 2, { depthBuffer: false });
    this.rtBlur   = mkRT(2, 2, { depthBuffer: false });

    // ==== Scene for each pass (fullscreen quad) ====
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Bright-pass material
    this._brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        threshold: { value: 0.72 },
        intensity: { value: 1.2 },
      },
      vertexShader: quadVS,
      fragmentShader: brightFS,
      depthWrite: false, depthTest: false,
    });
    this._brightScene = new THREE.Scene();
    this._brightQuad = new THREE.Mesh(FSQUAD_GEO, this._brightMat);
    this._brightScene.add(this._brightQuad);

    // Blur material (directional)
    this._blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        direction: { value: new THREE.Vector2(1, 0) },
        texSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: quadVS,
      fragmentShader: blurFS,
      depthWrite: false, depthTest: false,
    });
    this._blurScene = new THREE.Scene();
    this._blurQuad = new THREE.Mesh(FSQUAD_GEO, this._blurMat);
    this._blurScene.add(this._blurQuad);

    // Composite material
    this.uniforms = {
      tDiffuse: { value: null },
      tBloom: { value: null },
      time: { value: 0 },
      bloomStrength: { value: 0.85 },
      vignette: { value: 1.1 },
      chroma: { value: 0.0015 },
      grain: { value: 0.06 },
      scanlines: { value: 0.07 },
      saturation: { value: 1.08 },
      contrast: { value: 1.06 },
      coolTint: { value: new THREE.Vector3(-0.02, 0.0, 0.04) },
      damageFlash: { value: 0.0 },
      hurtTint: { value: new THREE.Vector3(0.75, 0.02, 0.02) },
    };
    this._compMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: quadVS,
      fragmentShader: compositeFS,
      depthWrite: false, depthTest: false,
    });
    this._compScene = new THREE.Scene();
    this._compQuad = new THREE.Mesh(FSQUAD_GEO, this._compMat);
    this._compScene.add(this._compQuad);
  }

  setSize(w, h) {
    const dpr = this._dpr;
    const W = Math.max(2, Math.floor(w * dpr));
    const H = Math.max(2, Math.floor(h * dpr));
    this.rtMain.setSize(W, H);
    const bw = Math.max(2, W >> 2);
    const bh = Math.max(2, H >> 2);
    this.rtBright.setSize(bw, bh);
    this.rtBlurH.setSize(bw, bh);
    this.rtBlur.setSize(bw, bh);
    this._blurMat.uniforms.texSize.value.set(bw, bh);
  }

  setExposure(v) { this.renderer.toneMappingExposure = v; }

  // Render one frame end-to-end.
  render(scene, camera) {
    const rndr = this.renderer;
    this.uniforms.time.value = performance.now() / 1000;

    // 1) Main scene → rtMain
    rndr.setRenderTarget(this.rtMain);
    rndr.clear(true, true, true);
    rndr.render(scene, camera);

    // 2) Bright pass (downsample) → rtBright
    this._brightMat.uniforms.tDiffuse.value = this.rtMain.texture;
    rndr.setRenderTarget(this.rtBright);
    rndr.clear(true, false, false);
    rndr.render(this._brightScene, this.orthoCam);

    // 3a) Blur horizontal → rtBlurH
    this._blurMat.uniforms.tDiffuse.value = this.rtBright.texture;
    this._blurMat.uniforms.direction.value.set(1, 0);
    rndr.setRenderTarget(this.rtBlurH);
    rndr.clear(true, false, false);
    rndr.render(this._blurScene, this.orthoCam);

    // 3b) Blur vertical → rtBlur
    this._blurMat.uniforms.tDiffuse.value = this.rtBlurH.texture;
    this._blurMat.uniforms.direction.value.set(0, 1);
    rndr.setRenderTarget(this.rtBlur);
    rndr.clear(true, false, false);
    rndr.render(this._blurScene, this.orthoCam);

    // 4) Composite → screen
    this.uniforms.tDiffuse.value = this.rtMain.texture;
    this.uniforms.tBloom.value = this.rtBlur.texture;
    rndr.setRenderTarget(null);
    rndr.clear(true, false, false);
    rndr.render(this._compScene, this.orthoCam);
  }
}

// ==== Shaders ====

const quadVS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const brightFS = /* glsl */`
uniform sampler2D tDiffuse;
uniform float threshold;
uniform float intensity;
varying vec2 vUv;
void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float contrib = max(l - threshold, 0.0);
  vec3 bright = col * contrib * intensity;
  gl_FragColor = vec4(bright, 1.0);
}
`;

const blurFS = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 direction;
uniform vec2 texSize;
varying vec2 vUv;
// 9-tap gaussian, equivalent sigma ~3 px
void main() {
  vec2 tx = direction / texSize;
  vec3 c = vec3(0.0);
  float w[5];
  w[0] = 0.227027;
  w[1] = 0.1945946;
  w[2] = 0.1216216;
  w[3] = 0.054054;
  w[4] = 0.016216;
  c += texture2D(tDiffuse, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    float fi = float(i);
    c += texture2D(tDiffuse, vUv + tx * fi).rgb * w[i];
    c += texture2D(tDiffuse, vUv - tx * fi).rgb * w[i];
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const compositeFS = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float time;
uniform float bloomStrength;
uniform float vignette;
uniform float chroma;
uniform float grain;
uniform float scanlines;
uniform float saturation;
uniform float contrast;
uniform vec3  coolTint;
uniform float damageFlash;
uniform vec3  hurtTint;
varying vec2 vUv;

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // Chromatic aberration: offset channels radially from center
  vec2 center = vec2(0.5);
  vec2 offset = (vUv - center) * chroma;
  float r = texture2D(tDiffuse, vUv + offset).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - offset).b;
  vec3 col = vec3(r, g, b);

  // Bloom add
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  col += bloom * bloomStrength;

  // Contrast & saturation
  col = (col - 0.5) * contrast + 0.5;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, saturation);

  // Cool-tint shadow grade
  col += coolTint * (1.0 - luma);

  // Vignette
  float d = distance(vUv, center);
  float v = smoothstep(0.85, 0.28, 1.0 - d);   // soft radial
  col *= mix(1.0, v, vignette * 0.5);

  // Scanlines (faint)
  float sl = sin(vUv.y * 900.0 + time * 3.0);
  col *= 1.0 - scanlines * 0.5 * (0.5 + 0.5 * sl);

  // Grain
  float n = rand(vUv + vec2(time * 0.7, time * 1.3)) - 0.5;
  col += n * grain;

  // Damage flash (red pulse screen)
  col = mix(col, hurtTint, damageFlash);

  // Clamp gently
  col = clamp(col, 0.0, 1.2);
  gl_FragColor = vec4(col, 1.0);
}
`;
