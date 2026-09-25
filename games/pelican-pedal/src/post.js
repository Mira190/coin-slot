// Post-processing: GTAO -> bokeh DOF (reusing GTAO's depth) -> bloom -> ACES output -> SMAA -> grade.
// Plus adaptive quality (pixel ratio, passes, shadow and cloud detail) driven by measured frame time.
import { THREE, renderer, scene, camera, clamp, DPR } from './core.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// single-pass scatter-as-gather bokeh on a golden-angle spiral (after Dennis Gustafsson)
const DofShader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 20000 }, uFocus: { value: 4 }, uAperture: { value: 0.06 }, uMaxCoc: { value: 12 }, uPx: { value: new THREE.Vector2() }, uOn: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    #include <packing>
    uniform sampler2D tDiffuse, tDepth; uniform float uNear, uFar, uFocus, uAperture, uMaxCoc, uOn; uniform vec2 uPx;
    varying vec2 vUv;
    const float GOLDEN = 2.39996323;
    float dist(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
    // thin-lens circle of confusion in pixels
    float coc(float z) { return clamp(uAperture * abs(z - uFocus) / max(z, 0.001) * uMaxCoc * 10.0, 0.0, uMaxCoc); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uOn < 0.5) { gl_FragColor = base; return; }
      float cd = dist(vUv), cs = coc(cd);
      vec3 col = base.rgb; float tot = 1.0;
      float r = 1.0;
      for (int i = 0; i < 72; i++) {
        if (r > uMaxCoc) break;
        float a = float(i) * GOLDEN;
        vec2 tc = vUv + vec2(cos(a), sin(a)) * uPx * r;
        vec3 sc = texture2D(tDiffuse, tc).rgb;
        float sd = dist(tc), ss = coc(sd);
        if (sd > cd) ss = clamp(ss, 0.0, cs * 2.0);   // in-focus foreground is not smeared by the background
        float m = smoothstep(r - 0.5, r + 0.5, ss);
        col += mix(col / tot, sc, m); tot += 1.0;
        r += 1.35 / r + 0.18;
      }
      gl_FragColor = vec4(col / tot, base.a);
    }`,
};

// final grade: filters for photo mode, vignette and film grain (runs in display space)
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uFilter: { value: 0 }, uVig: { value: 0.28 }, uGrain: { value: 0.025 }, uT: { value: 0 }, uFade: { value: 0 }, uWarm: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform int uFilter; uniform float uVig, uGrain, uT, uFade, uWarm;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uT) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // golden hour: a gentle warm lift in the highlights, cool shadows
      if (uFilter == 0 && uWarm > 0.0) {
        c = mix(c, c * vec3(1.07, 1.0, 0.86), uWarm * smoothstep(0.25, 0.9, l));
        c = mix(c, c * vec3(0.94, 0.98, 1.06), uWarm * (1.0 - smoothstep(0.0, 0.35, l)));
      }
      if (uFilter == 1) { // golden film: warm highlights, teal shadows
        c = mix(c, c * vec3(1.08, 1.0, 0.86), smoothstep(0.3, 0.9, l));
        c = mix(c, c * vec3(0.88, 1.0, 1.08), 1.0 - smoothstep(0.0, 0.45, l));
        c = pow(c, vec3(0.95)) * 1.03;
      } else if (uFilter == 2) { // noir
        float g = smoothstep(0.03, 0.95, l); c = vec3(g * g * (3.0 - 2.0 * g));
      } else if (uFilter == 3) { // vintage print
        c = mix(vec3(l), c, 0.6) * vec3(1.06, 0.98, 0.84) * 0.92 + vec3(0.06, 0.05, 0.03);
      } else if (uFilter == 4) { // pastel
        c = mix(c, vec3(1.0), 0.12) * vec3(1.02, 0.99, 1.04);
        c = mix(vec3(l), c, 1.15);
      }
      vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * uVig * (uFilter == 3 ? 3.2 : 2.2);
      c *= clamp(v, 0.0, 1.0);
      c += (h(vUv * 931.0) - 0.5) * uGrain * (uFilter == 3 || uFilter == 2 ? 2.0 : 1.0);
      c = mix(c, vec3(0.0), uFade);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  constructor() {
    this.noAO = [];
    const w = innerWidth, h = innerHeight;
    this.composer = new EffectComposer(renderer);
    this.render = new RenderPass(scene, camera);
    this.gtao = new GTAOPass(scene, camera, w, h);
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.9;
    // keep sky, clouds and the sea out of the G-buffer
    const ov = this.gtao._overrideVisibility.bind(this.gtao);
    this.gtao._overrideVisibility = () => { ov(); for (const o of this.noAO) if (o.visible) { o.visible = false; this.gtao._visibilityCache.push(o); } };
    this.dof = new ShaderPass(DofShader);
    // only genuinely hot pixels bloom (sun, lamps, glints); sunlit white feathers stay crisp
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.35, 3.2);
    // clamp what feeds the blur so a hot sky can't flood the frame, and measure over a 4x4 pixel box: a glint a
    // pixel or two wide (the sun on a spinning crank, the sea's glitter) stays a crisp sparkle instead of blooming
    // into a flash each time it catches the light, while the sun, the moon and lamp heads still glow
    const hp = this.bloom.materialHighPassFilter;
    hp.uniforms.uMaxBloom = { value: 12 }; hp.uniforms.uTexel = { value: new THREE.Vector2(1 / w, 1 / h) };
    hp.fragmentShader = hp.fragmentShader.replace('void main() {', 'uniform float uMaxBloom; uniform vec2 uTexel;\nvoid main() {')
      .replace(/vec4 texel = texture2D\( tDiffuse, vUv \);/, 'vec4 texel = 0.25 * ( texture2D( tDiffuse, vUv - uTexel ) + texture2D( tDiffuse, vUv + uTexel ) + texture2D( tDiffuse, vUv + vec2( uTexel.x, -uTexel.y ) ) + texture2D( tDiffuse, vUv - vec2( uTexel.x, -uTexel.y ) ) );')
      .replace(/gl_FragColor\s*=\s*mix\(\s*outputColor,\s*texel,\s*alpha\s*\);/, 'vec4 cl = texel; float lm = max(max(cl.r, cl.g), cl.b); if (lm > uMaxBloom) cl.rgb *= uMaxBloom / lm; gl_FragColor = mix( outputColor, cl, alpha );');
    hp.needsUpdate = true;
    this.output = new OutputPass();
    this.smaa = new SMAAPass(w, h);
    this.grade = new ShaderPass(GradeShader);
    for (const p of [this.render, this.gtao, this.dof, this.bloom, this.output, this.smaa, this.grade]) this.composer.addPass(p);
    this.level = -1; this.auto = true; this.focus = 4; this.aperture = 0.05; this.dofOn = true;
    this.samples = []; this.lastChange = 0; this.changes = 0;
    addEventListener('resize', () => this.resize());
  }
  setLevel(L) {
    L = clamp(L, 0, 3); if (L === this.level) return; this.level = L;
    const pr = [0.75, 1, Math.min(DPR, 1.5), Math.min(DPR, 2)][L];
    renderer.setPixelRatio(pr);
    this.gtao.enabled = L >= 2; this.dof.enabled = L >= 2 && this.dofOn; this.bloom.enabled = L >= 1;
    this.aoHalf = L === 2;
    this.resize();
    this.onLevel && this.onLevel(L);
  }
  resize() {
    const w = innerWidth, h = innerHeight, pr = renderer.getPixelRatio();
    renderer.setSize(w, h); this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    if (this.aoHalf) this.gtao.setSize(Math.round(w * pr / 2), Math.round(h * pr / 2));
    this.dof.uniforms.uPx.value.set(1 / (w * pr), 1 / (h * pr));
    this.bloom.materialHighPassFilter.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
    this.dof.uniforms.uMaxCoc.value = Math.round(clamp(h * pr / 90, 6, 16));
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  // frame-time driven quality; ms is the smoothed frame time
  adapt(ms, now) {
    if (!this.auto) return;
    this.samples.push(ms); if (this.samples.length < 90) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length; this.samples.length = 0;
    if (now - this.lastChange < 2500) return;
    if (avg > 24 && this.level > 0) { this.setLevel(this.level - 1); this.lastChange = now; this.changes++; }
    else if (avg < 12.5 && this.level < 3 && this.changes < 4) { this.setLevel(this.level + 1); this.lastChange = now; this.changes++; }
  }
  frame(t) {
    const u = this.dof.uniforms;
    u.uNear.value = camera.near; u.uFar.value = camera.far; u.uFocus.value = this.focus; u.uAperture.value = this.aperture;
    u.tDepth.value = this.gtao.depthTexture; u.uOn.value = this.gtao.enabled && this.dofOn ? 1 : 0;
    this.dof.enabled = this.gtao.enabled && this.dofOn;
    this.grade.uniforms.uT.value = t % 10;
    this.composer.render();
  }
}
