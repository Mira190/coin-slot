// Renderer, scene, cameras, post-processing chain and adaptive quality.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';

export const LAYER_FX = 1;      // glows, beams, particles: skipped by the AO normal pass
export const LAYER_AVATAR = 2;  // the player's body: only seen through gates

export const G = {
  renderer: null, scene: null, camera: null, vmScene: null, vmCamera: null, composer: null,
  sun: null, hemi: null, gtao: null, bloom: null, smaa: null,
  width: 1, height: 1,
  // quality knobs; `auto` lets adaptQuality move them
  q: { auto: true, level: 2, pixelRatio: 1, depth: 4, portalScale: 1, gtao: true, shadows: 2048 },
};

class HookPass extends Pass {
  constructor(fn) { super(); this.fn = fn; this.needsSwap = false; }
  render() { this.fn(); }
}

export function initGfx(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: /[?&]pdb/.test(location.search) });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping; // exposure: see RIGS
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false;
  r.localClippingEnabled = true;
  G.renderer = r;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e10);
  scene.fog = new THREE.Fog(0x0b0e10, 90, 260);
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture;
  G.scene = scene;

  const cam = new THREE.PerspectiveCamera(75, 1, 0.02, 400);
  cam.layers.enable(LAYER_FX);
  G.camera = cam;

  G.hemi = new THREE.HemisphereLight(0xe6eef2, 0x4a4640); scene.add(G.hemi); // colours and intensities: RIGS
  const sun = new THREE.DirectionalLight(0xfff4e6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(sun, sun.target); G.sun = sun;
  // a low, cool fill so walls are not left to the grazing key light alone
  G.fill = new THREE.DirectionalLight(0xdfe7f2); G.fill.position.set(-0.55, 0.35, -0.75); scene.add(G.fill);
  G.fill2 = new THREE.DirectionalLight(0xf2ece2); G.fill2.position.set(0.6, 0.25, 0.7); scene.add(G.fill2);

  // first-person gun lives in its own scene, drawn over the world with a fresh depth buffer
  G.vmScene = new THREE.Scene();
  G.vmCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  G.vmScene.environment = scene.environment; G.vmScene.environmentIntensity = 0.35;
  const vl = new THREE.DirectionalLight(0xfff6ee, 1.1); vl.position.set(1, 2, 1.5); G.vmScene.add(vl, new THREE.HemisphereLight(0xdde6ec, 0x33302c, 0.45));

  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const comp = new EffectComposer(r, rt);
  comp.addPass(new RenderPass(scene, cam));
  comp.addPass(new HookPass(() => cam.layers.disable(LAYER_FX)));
  G.gtao = new GTAOPass(scene, cam, 4, 4);
  G.gtao.output = GTAOPass.OUTPUT.Default; G.gtao.blendIntensity = 0.85;
  G.gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
  G.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
  comp.addPass(G.gtao);
  comp.addPass(new HookPass(() => cam.layers.enable(LAYER_FX)));
  const vm = new RenderPass(G.vmScene, G.vmCamera); vm.clear = false; vm.clearDepth = true; comp.addPass(vm);
  G.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.2, 1.1); // tight glow on emitters only
  comp.addPass(G.bloom);
  comp.addPass(new OutputPass());
  G.smaa = new SMAAPass(); comp.addPass(G.smaa);
  G.composer = comp;
  setOutdoor(false); // light intensities come from the lab rig
  applyQuality();
  addEventListener('resize', resize);
}

export function resize() {
  const w = innerWidth, h = innerHeight, pr = G.q.pixelRatio;
  G.width = w; G.height = h;
  G.renderer.setPixelRatio(pr); G.renderer.setSize(w, h, false);
  G.composer.setPixelRatio(pr); G.composer.setSize(w, h);
  G.bloom.resolution.set(w * pr / 2, h * pr / 2);
  G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
  G.vmCamera.aspect = w / h; G.vmCamera.updateProjectionMatrix();
}

// Size in device pixels of the main render (portal targets are scaled from this).
export function drawSize() { return { w: Math.max(1, Math.round(G.width * G.q.pixelRatio)), h: Math.max(1, Math.round(G.height * G.q.pixelRatio)) }; }

const LEVELS = [
  { pixelRatio: 0.6, depth: 2, portalScale: 0.5, gtao: false, shadows: 0 },
  { pixelRatio: 0.85, depth: 3, portalScale: 0.6, gtao: false, shadows: 1024 },
  { pixelRatio: 1.0, depth: 4, portalScale: 0.75, gtao: true, shadows: 2048 },
  { pixelRatio: 1.5, depth: 5, portalScale: 1.0, gtao: true, shadows: 2048 },
];
export function setQualityLevel(l) {
  l = Math.max(0, Math.min(3, l | 0)); G.q.level = l;
  const L = LEVELS[l], dpr = Math.min(devicePixelRatio || 1, 2);
  Object.assign(G.q, L, { pixelRatio: Math.min(L.pixelRatio, Math.max(dpr, 0.6)) });
  applyQuality();
}
function applyQuality() {
  const q = G.q;
  G.gtao.enabled = q.gtao;
  G.sun.castShadow = q.shadows > 0;
  if (q.shadows && G.sun.shadow.mapSize.x !== q.shadows) {
    G.sun.shadow.mapSize.set(q.shadows, q.shadows);
    if (G.sun.shadow.map) { G.sun.shadow.map.dispose(); G.sun.shadow.map = null; }
  }
  if (G.width > 1) resize();
}

// Adaptive quality: recursion depth is the first knob, then the whole preset.
const perf = { acc: 0, n: 0, calm: 0, cool: 0 };
export function adaptQuality(frameMs) {
  if (!G.q.auto) return;
  perf.acc += Math.min(frameMs, 100); perf.n++;
  if (perf.acc < 1500) return;
  const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
  if (perf.cool > 0) { perf.cool--; return; }
  if (avg > 19) {
    perf.calm = 0; perf.cool = 1;
    if (G.q.depth > 3) G.q.depth--;
    else if (G.q.level > 0) setQualityLevel(G.q.level - 1);
    else if (G.q.depth > 1) G.q.depth--;
  } else if (avg < 12.5) {
    if (++perf.calm >= 3) {
      perf.calm = 0; perf.cool = 2;
      const max = LEVELS[G.q.level].depth;
      if (G.q.depth < max) G.q.depth++;
      else if (G.q.level < 3) setQualityLevel(G.q.level + 1);
      else if (G.q.depth < 6) G.q.depth++;
    }
  } else perf.calm = 0;
}

// Light rigs. Exposure is balanced so diffuse surfaces stay below the bloom threshold under any light:
// only emissive things (lamps, rims, beams) glow. Ambient (hemi + environment) is kept low against the key light so
// white panels keep their shading, tile detail and contact shadows instead of washing into a flat haze.
const RIGS = {
  lab: { dir: [0.3, 1, 0.2], sun: [0xfff4e6, 2.2], hemi: [0xe6eef2, 0.38], env: 0.32, fill: 0.5, fill2: 0.28, exposure: 0.95, bloom: 1.1, fog: [0x0b0e10, 90, 260] },
  // outdoors the sky is the brightest non-emissive thing in view, so the bloom threshold sits above its horizon
  roof: { dir: [-0.35, 1, 0.22], sun: [0xffe2b8, 2.6], hemi: [0xa9c7f0, 0.3], env: 0.25, fill: 0.2, fill2: 0.1, exposure: 0.9, bloom: 2.4, fog: [0xa3b8c8, 220, 900] },
};
let sky = null;
export const SUN_DIR = new THREE.Vector3(...RIGS.lab.dir).normalize();
export function setOutdoor(on) {
  if (on && !sky) {
    sky = new Sky(); sky.scale.setScalar(360); G.scene.add(sky);
    // the physical sky is authored for exposure ~0.3: scaled so even the horizon stays under the bloom threshold, and
    // capped so the sun disc (thousands of times brighter) only glows a little instead of fogging the whole frame
    sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor * 0.16, vec3( 3.0 ) ), 1.0 );');
    const u = sky.material.uniforms; u.turbidity.value = 1.6; u.rayleigh.value = 1.3; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.8;
  }
  if (sky) sky.visible = on;
  const R = on ? RIGS.roof : RIGS.lab;
  SUN_DIR.set(...R.dir).normalize();
  if (on) sky.material.uniforms.sunPosition.value.copy(SUN_DIR).multiplyScalar(100);
  G.sun.color.set(R.sun[0]); G.sun.intensity = R.sun[1]; G.hemi.color.set(R.hemi[0]); G.hemi.intensity = R.hemi[1];
  G.scene.environmentIntensity = R.env; G.fill.intensity = R.fill; G.fill2.intensity = R.fill2; G.renderer.toneMappingExposure = R.exposure; G.bloom.threshold = R.bloom;
  G.scene.background = on ? null : new THREE.Color(R.fog[0]); G.scene.fog.color.set(R.fog[0]); G.scene.fog.near = R.fog[1]; G.scene.fog.far = R.fog[2];
}

// Fit the shadow camera around the current chamber.
export function fitSun(min, max) {
  const c = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  const size = new THREE.Vector3().subVectors(max, min);
  const r = Math.max(size.x, size.y, size.z) * 0.62 + 2;
  G.sun.position.copy(c).add(SUN_DIR.clone().multiplyScalar(r * 1.6));
  G.sun.target.position.copy(c);
  const s = G.sun.shadow.camera; s.left = -r; s.right = r; s.top = r; s.bottom = -r; s.near = 0.5; s.far = r * 3.4; s.updateProjectionMatrix();
  G.sun.target.updateMatrixWorld();
}
