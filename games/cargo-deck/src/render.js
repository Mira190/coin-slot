// Renderer + post: scene pass with the first-person viewmodel drawn on top (own camera, depth cleared),
// optional GTAO, bloom, neutral tone mapping via OutputPass, SMAA. Quality tiers + adaptive resolution.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { makeSkyDome, makeEnvironment, FOG_COLOR, SUN_DIR } from './sky.js';
import { setAniso } from './textures.js';

// world pass, then (after AO so the gun isn't darkened by walls behind it) the viewmodel on top
class ScenePass extends Pass {
  constructor(r) { super(); this.r = r; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();
    renderer.render(this.r.scene, this.r.camera);
  }
}
class VMPass extends Pass {
  constructor(r) { super(); this.r = r; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.r.showVM) return;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.r.vmScene, this.r.vmCamera);
    renderer.autoClear = ac;
  }
}

export const QUALITY = {
  low: { ratio: 0.75, shadow: 1024, bloom: false, smaa: false, ao: false, points: false, sea: 1 },
  medium: { ratio: 1.0, shadow: 2048, bloom: true, smaa: true, ao: false, points: true, sea: 1 },
  high: { ratio: 1.5, shadow: 4096, bloom: true, smaa: true, ao: true, points: true, sea: 2 },
};

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  // Khronos PBR Neutral: colours stay true up to the highlights, which then roll off smoothly instead of bleaching
  // (ACES turned the golden-hour sky near the sun, lamps and sunlit paint to flat white)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setSize(innerWidth, innerHeight);
  container.prepend(renderer.domElement);
  setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_COLOR, 90, 1400);
  const sky = makeSkyDome();
  scene.add(sky);
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = 0.85;

  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 3000);
  camera.rotation.order = 'YXZ';
  const vmScene = new THREE.Scene();
  vmScene.environment = scene.environment;
  vmScene.environmentIntensity = 0.8;
  const vmCamera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);
  const vmSun = new THREE.DirectionalLight(0xffe2c4, 2.2);
  vmSun.position.copy(SUN_DIR);
  const vmHemi = new THREE.HemisphereLight(0xb8cce8, 0x6b5a48, 0.6);
  vmScene.add(vmSun, vmHemi, vmCamera);

  const R = {
    renderer, scene, camera, vmScene, vmCamera, vmSun, vmHemi, sky, showVM: true,
    quality: 'medium', composer: null, passes: {}, scale: 1, world: null,
  };
  const composer = new EffectComposer(renderer);
  R.composer = composer;
  const main = new ScenePass(R);
  composer.addPass(main);
  const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.output = GTAOPass.OUTPUT.Default;
  ao.blendIntensity = 0.85;
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1 });
  composer.addPass(ao);
  const vm = new VMPass(R);
  composer.addPass(vm);
  // threshold above sunlit paint (a white wall in full sun is ~1.0 linear): only emitters, the sun and sharp
  // specular glints bloom, with a tight halo. (0.92 bloomed every sunlit surface into a haze.)
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.25, 1.3);
  composer.addPass(bloom);
  const out = new OutputPass();
  composer.addPass(out);
  const smaa = new SMAAPass(innerWidth, innerHeight);
  composer.addPass(smaa);
  R.passes = { main, ao, vm, bloom, out, smaa };

  R.applyQuality = (q) => {
    R.quality = q;
    const Q = QUALITY[q] || QUALITY.medium;
    ao.enabled = Q.ao; bloom.enabled = Q.bloom; smaa.enabled = Q.smaa;
    R.baseRatio = Math.min(devicePixelRatio || 1, 2) * Q.ratio;
    R.scale = 1;
    if (R.world) {
      R.world.setShadowSize(Q.shadow);
      for (const l of R.world.points) l.visible = Q.points;
    }
    renderer.shadowMap.needsUpdate = true;
    // shader programs depend on light counts / shadow types: force recompiles
    scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    R.resize();
  };
  R.resize = () => {
    const w = innerWidth, h = innerHeight, pr = Math.max(0.4, R.baseRatio * R.scale);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    vmCamera.aspect = w / h; vmCamera.updateProjectionMatrix();
  };
  addEventListener('resize', () => R.resize());
  // adaptive resolution: nudge the render scale to hold ~55-60 fps
  let acc = 0, frames = 0, cool = 0;
  R.adapt = (dt, enabled) => {
    if (!enabled) return;
    acc += dt; frames++;
    if (acc < 1.0) return;
    const fps = frames / acc; acc = 0; frames = 0;
    if (cool > 0) { cool--; return; }
    if (fps < 48 && R.scale > 0.55) { R.scale = Math.max(0.55, R.scale - 0.12); R.resize(); cool = 2; }
    else if (fps > 58 && R.scale < 1) { R.scale = Math.min(1, R.scale + 0.06); R.resize(); cool = 3; }
  };
  R.render = () => composer.render();
  return R;
}
