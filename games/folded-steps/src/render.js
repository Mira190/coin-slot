// Folded Steps: renderer, isometric camera, lights, PMREM environment, post chain, adaptive quality.
//
// Illusions only survive if nothing reveals depth, so the usual depth cues are replaced by screen-space
// ones: mist and colour grading are functions of the projected height (identical for two points that differ
// by k(1,1,1)), never of camera distance. The sun sits close to the view axis so shadows fall behind things.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const VIEW = new THREE.Vector3(1, 1, 1).normalize(); // from target toward the eye
export const RIGHT = new THREE.Vector3(1, 0, -1).normalize();
export const UP = new THREE.Vector3(-1, 2, -1).normalize();
export const SUN = new THREE.Vector3(0.42, 0.88, 0.22).normalize();

// uniforms shared by every patched material (one object, many materials)
export const FXU = {
  uMist: { value: new THREE.Color('#ffffff') },
  uMistTop: { value: -2 },
  uMistBot: { value: -6 },
  uMistAmt: { value: 0.85 },
  uTime: { value: 0 },
};
// screen-space mist: fades anything toward the mist colour as its projected height drops
export function patch(mat, extra = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FXU, extra.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFsW;\nuniform float uTime;' + (extra.vDecl || ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 fsW = modelMatrix * vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n fsW = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );\n#endif\n vFsW = fsW.xyz; }' + (extra.vMain || ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFsW;\nuniform vec3 uMist; uniform float uMistTop, uMistBot, uMistAmt, uTime;' + (extra.fDecl || ''))
      .replace('#include <dithering_fragment>', (extra.fMain || '') + '\n{ float sv = dot( vFsW, vec3( -0.40824829, 0.81649658, -0.40824829 ) );\n float mist = smoothstep( uMistTop, uMistBot, sv );\n gl_FragColor.rgb = mix( gl_FragColor.rgb, uMist, mist * uMistAmt ); }\n#include <dithering_fragment>');
  };
  mat.customProgramCacheKey = () => 'fs' + (extra.key || '');
  return mat;
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.28 }, uTint: { value: new THREE.Color(1, 0.98, 0.96) }, uGrain: { value: 0.025 }, uFade: { value: 0 }, uFadeCol: { value: new THREE.Color('#fff8f0') } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uFade; uniform vec3 uTint, uFadeCol; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(q * vec2(1.0, 0.85)));
      c.rgb *= mix(1.0 - uVig, 1.0, v);
      c.rgb *= uTint;
      c.rgb += (h(vUv * 800.0 + fract(uTime)) - 0.5) * uGrain;
      c.rgb = mix(c.rgb, uFadeCol, uFade);
      gl_FragColor = c;
    }`,
};

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 600);
    this.cam = { target: new THREE.Vector3(), half: 8, shake: 0, sway: 0 };
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.16;
    pm.dispose();
    this.hemi = new THREE.HemisphereLight('#ffffff', '#b0a0c0', 0.66);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight('#fff4e6', 2.7));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = 4; this.bgCanvas.height = 256;
    this.bg = new THREE.CanvasTexture(this.bgCanvas);
    this.bg.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.bg;
    this.quality = 3; this.fpsT = 0; this.fpsN = 0; this.fpsAcc = 0; this.qCool = 0;
    this.buildComposer();
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  buildComposer() {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true }); // stencil: the pilgrim's silhouette
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.55, 1.25);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }
  setPalette(P) {
    const c = this.bgCanvas.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, P.sky[0]); g.addColorStop(0.62, P.sky[1]); g.addColorStop(1, P.mist);
    c.fillStyle = g; c.fillRect(0, 0, 4, 256);
    this.bg.needsUpdate = true;
    FXU.uMist.value.set(P.mist);
    this.hemi.color.set(P.sky[1]);
    this.hemi.groundColor.set(P.col).lerp(new THREE.Color(P.water[0]), 0.4);
    this.sun.color.set(P.sun);
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.w = w; this.h = h;
    const pr = Math.min(devicePixelRatio || 1, [1, 1.25, 1.5, 2][this.quality]);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.placeCamera();
  }
  // frame a screen-space box {u0,u1,v0,v1} (world units in the view plane), leaving room for the HUD
  fit(b, pad = 1.2) {
    const aspect = this.w / this.h;
    const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2;
    const hu = (b.u1 - b.u0) / 2 + pad, hv = (b.v1 - b.v0) / 2 + pad;
    const half = Math.max(hv * 1.2, (hu * 1.06) / aspect);
    return { center: RIGHT.clone().multiplyScalar(cu).addScaledVector(UP, cv), half };
  }
  placeCamera() {
    const cam = this.camera, s = this.cam;
    const aspect = this.w / this.h, half = s.half;
    cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half;
    const t = s.target.clone();
    if (s.shake) t.addScaledVector(RIGHT, (Math.random() - 0.5) * s.shake).addScaledVector(UP, (Math.random() - 0.5) * s.shake);
    if (s.sway) t.addScaledVector(UP, s.sway);
    cam.position.copy(t).addScaledVector(VIEW, 200);
    cam.up.set(0, 1, 0);
    cam.lookAt(t);
    cam.updateProjectionMatrix();
    // shadow frustum follows the framed area
    const sun = this.sun;
    sun.target.position.copy(s.target);
    sun.position.copy(s.target).addScaledVector(SUN, 60);
    const sc = sun.shadow.camera, e = half * Math.max(aspect, 1) * 1.6 + 4;
    sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 1; sc.far = 160;
    sc.updateProjectionMatrix();
  }
  // screen position (css px) of a world point
  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.w, y: (-p.y * 0.5 + 0.5) * this.h };
  }
  render(dt) {
    FXU.uTime.value += dt;
    this.grade.uniforms.uTime.value += dt;
    this.placeCamera();
    this.composer.render(dt);
    this.adapt(dt);
  }
  // adaptive quality: step pixel ratio, bloom and shadow resolution to hold ~60 fps
  adapt(dt) {
    this.fpsAcc += dt; this.fpsN++; this.qCool -= dt;
    if (this.fpsAcc < 2) return;
    const ms = (this.fpsAcc / this.fpsN) * 1000;
    this.fpsAcc = 0; this.fpsN = 0;
    if (this.qCool > 0 || document.hidden) return;
    if (ms > 24 && this.quality > 0) this.setQuality(this.quality - 1);
    else if (ms < 13 && this.quality < 3 && this.qUpOk !== false) this.setQuality(this.quality + 1);
  }
  setQuality(q) {
    if (q < this.quality) this.qUpOk = q >= 2; // once we have had to drop hard, stop climbing back
    this.quality = q; this.qCool = 6;
    this.bloom.enabled = q >= 1;
    const sm = q >= 2 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== sm) { this.sun.shadow.mapSize.set(sm, sm); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.resize();
  }
}
