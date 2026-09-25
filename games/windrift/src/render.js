// Renderer, post-processing chain (render → bloom → speed FX → SMAA → output), skies, environment maps and
// adaptive quality (pixel ratio, shadows, passes) to hold frame rate.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';

const SpeedShader = {
  uniforms: { tDiffuse: { value: null }, uSpeed: { value: 0 }, uBoost: { value: 0 }, uTime: { value: 0 }, uLock: { value: 0 }, uAspect: { value: 1 }, uHit: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSpeed, uBoost, uTime, uLock, uAspect, uHit; varying vec2 vUv;
    float hash(float n){ return fract(sin(n) * 43758.5453123); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; c.x *= uAspect; float r = length(c);
      vec4 col = texture2D(tDiffuse, uv);
      if (uSpeed > 0.02) {
        vec2 dir = (uv - 0.5) * uSpeed * 0.032 * smoothstep(0.3, 0.85, r);
        vec4 acc = col;
        for (int i = 1; i < 7; i++) acc += texture2D(tDiffuse, uv - dir * float(i) / 6.0);
        col = acc / 7.0;
        float N = 120.0;
        float a = atan(c.y, c.x);
        float ang = (a / 6.2831853 + 0.5) * N;
        float id = floor(ang), fa = fract(ang);
        float sd = hash(id * 13.71);
        float sp = 1.1 + sd * 1.7;
        float cyc = uTime * sp + sd * 5.0;
        float ph = fract(cyc);
        float r0 = mix(0.22, 1.05, ph);
        float len = 0.1 + sd * 0.22;
        float radial = smoothstep(r0 - len, r0, r) * (1.0 - smoothstep(r0, r0 + 0.015, r));
        float thin = 1.0 - smoothstep(0.0, 0.16, abs(fa - 0.5));
        float on = step(0.62, hash(id * 3.17 + floor(cyc)));
        float lines = radial * thin * on * smoothstep(0.35, 0.7, r);
        col.rgb += mix(vec3(0.85, 0.95, 1.0), vec3(0.45, 0.75, 1.0), uBoost) * lines * uSpeed * 0.55;
      }
      col.rgb += vec3(0.08, 0.35, 1.0) * smoothstep(0.55, 1.15, r) * uBoost * 0.4;
      col.rgb *= 1.0 - smoothstep(0.6, 1.15, r) * 0.32;
      col.rgb = mix(col.rgb, vec3(1.0, 0.08, 0.1) * 0.8, smoothstep(0.45, 1.05, r) * uLock * 0.55);
      col.rgb = mix(col.rgb, vec3(1.0, 0.95, 0.9), uHit * 0.35);
      gl_FragColor = col;
    }`
};

const SkyShader = {
  uniforms: {
    top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
    stars: { value: 1 }, aurora: { value: 0 }, time: { value: 0 }, moonI: { value: 1.35 }, moonDir: { value: new THREE.Vector3(0, 1, 0) }
  },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
  fragmentShader: `
    uniform vec3 top, mid, horizon, bottom, moonDir; uniform float stars, aurora, time, moonI; varying vec3 vDir;
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1,0), vec2(127.1, 311.7))) * 43758.5);
      float c = fract(sin(dot(i + vec2(0,1), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1,1), vec2(127.1, 311.7))) * 43758.5);
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
    void main(){
      vec3 d = normalize(vDir); float y = d.y;
      vec3 col = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, y)) : mix(horizon, bottom, smoothstep(0.0, 0.25, -y));
      col = mix(horizon, col, smoothstep(0.0, 0.16, abs(y)));
      if (stars > 0.0 && y > 0.02) {
        vec3 p = floor(d * 420.0); float s = hash(p);
        float tw = 0.6 + 0.4 * sin(time * 2.0 + s * 60.0);
        col += vec3(0.9, 0.95, 1.0) * step(0.9975, s) * tw * stars * smoothstep(0.02, 0.3, y) * 1.4;
      }
      float m = dot(d, normalize(moonDir));
      // moon: a small disc just over the bloom threshold with a faint halo (it used to flood the sky)
      col += vec3(1.0, 0.97, 0.9) * (smoothstep(0.99955, 0.9998, m) * moonI + pow(max(m, 0.0), 600.0) * 0.18 + pow(max(m, 0.0), 16.0) * 0.03);
      if (aurora > 0.0 && y > 0.03) {
        vec2 q = d.xz / (y + 0.35) * 1.6;
        float band = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float w = sin(q.x * (0.9 + fi * 0.35) + time * (0.12 + fi * 0.05) + n2(q * 0.8 + fi) * 3.0) * 0.5 + 0.5;
          float center = 1.4 + fi * 0.55 + 0.35 * sin(q.x * 0.7 + time * 0.1 + fi);
          band += smoothstep(0.5, 0.0, abs(q.y - center)) * (0.4 + 0.6 * w) * (0.7 + 0.3 * n2(vec2(q.x * 6.0, time * 0.5 + fi)));
        }
        vec3 ac = mix(vec3(0.1, 1.0, 0.55), vec3(0.55, 0.3, 1.0), smoothstep(0.1, 0.6, y));
        col += ac * band * aurora * 0.55 * smoothstep(0.03, 0.2, y);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
};

export function makeSky(theme) {
  if (!theme.night) {
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms, s = theme.skyDay;
    u.turbidity.value = s.turbidity; u.rayleigh.value = s.rayleigh; u.mieCoefficient.value = s.mie; u.mieDirectionalG.value = s.g;
    const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - s.elev), THREE.MathUtils.degToRad(s.azim));
    u.sunPosition.value.copy(sun);
    sky.userData.sunDir = sun;
    return sky;
  }
  const m = new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false });
  const s = theme.sky, u = m.uniforms;
  u.top.value.set(s.top); u.mid.value.set(s.mid); u.horizon.value.set(s.horizon); u.bottom.value.set(s.bottom);
  u.stars.value = s.stars; u.aurora.value = s.aurora; u.moonDir.value.set(...s.moon).normalize();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), m);
  mesh.userData.sunDir = u.moonDir.value.clone();
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

export class Renderer {
  constructor(canvas) {
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral: base colours stay true and vivid, only highlights roll off (ACES pushed neon/lamps to
    // harsh white and bleached the day skies)
    r.toneMapping = THREE.NeutralToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(r);
    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.8);
    this.speed = new ShaderPass(SpeedShader);
    this.smaa = new SMAAPass();
    this.output = new OutputPass();
    for (const p of [this.renderPass, this.bloom, this.speed, this.smaa, this.output]) this.composer.addPass(p);
    const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    this.level = mobile ? 1 : 2; this.auto = true;
    this.frameMs = 16; this.slowT = 0; this.fastT = 0; this.cooldown = 3;
    this.applyQuality();
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.r.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.speed.uniforms.uAspect.value = w / h;
    this.w = w; this.h = h;
  }
  applyQuality() {
    const L = this.level, dpr = devicePixelRatio || 1;
    const pr = [Math.min(dpr, 0.8), Math.min(dpr, 1), Math.min(dpr, 1.5), Math.min(dpr, 2)][L];
    this.r.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.r.shadowMap.enabled = L >= 1;
    this.shadowSize = L >= 2 ? 2048 : 1024;
    this.bloom.enabled = L >= 1;
    this.smaa.enabled = L >= 2;
    this.speed.enabled = true;
    this.resize?.call(this);
    this.onQuality?.(L);
  }
  setLevel(L, manual) {
    L = Math.max(0, Math.min(3, L));
    if (manual !== undefined) this.auto = manual === 'auto';
    if (L !== this.level) { this.level = L; this.applyQuality(); }
  }
  // call each frame with the real frame time; steps quality down if slow, up if comfortably fast
  adapt(ms) {
    this.frameMs += (ms - this.frameMs) * 0.05;
    if (!this.auto) return;
    this.cooldown -= ms / 1000;
    if (this.cooldown > 0) return;
    if (this.frameMs > 24) { this.slowT += ms; this.fastT = 0; } else if (this.frameMs < 13) { this.fastT += ms; this.slowT = 0; } else { this.slowT = this.fastT = 0; }
    if (this.slowT > 1500 && this.level > 0) { this.setLevel(this.level - 1); this.slowT = 0; this.cooldown = 3; }
    if (this.fastT > 6000 && this.level < 3) { this.setLevel(this.level + 1); this.fastT = 0; this.cooldown = 4; }
  }
  envFrom(skyMesh, extras) {
    const sc = new THREE.Scene();
    const s = skyMesh.clone(); s.material = skyMesh.material.clone ? skyMesh.material : skyMesh.material;
    sc.add(s);
    if (extras) extras.forEach((e) => sc.add(e));
    const rt = this.pmrem.fromScene(sc, 0.02, 1, 3000);
    return rt.texture;
  }
  // per-scene look: bloom, exposure and tone mapping (PBR Neutral, or ACES where a theme asks for it)
  look(o) { this.setBloom(o.bloom); this.r.toneMappingExposure = o.exposure; this.r.toneMapping = o.aces ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping; }
  setBloom([strength, radius, threshold]) { this.bloom.strength = strength; this.bloom.radius = radius; this.bloom.threshold = threshold; this.bloom.enabled = strength > 0 && this.level >= 1; }
  render(scene, camera) {
    this.renderPass.scene = scene; this.renderPass.camera = camera;
    this.composer.render();
  }
}
