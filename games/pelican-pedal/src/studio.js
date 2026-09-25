// Model studio (index.html?studio): the pelican and bike on a turntable under a Sky environment.
// Used to iterate on the model; also a handy close look at the rig.
import { THREE, renderer, scene, camera, V3 } from './core.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Pelican } from './pelican.js';
import { Bike, G } from './bike.js';

export function studio() {
  const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
  const U = sky.material.uniforms; U.turbidity.value = 4; U.rayleigh.value = 1.6; U.mieCoefficient.value = 0.004; U.mieDirectionalG.value = 0.85; U.cloudCoverage.value = 0.25;
  const sunDir = new V3();
  const setSun = (el, az) => { sunDir.setFromSphericalCoords(1, Math.PI / 2 - el, az); U.sunPosition.value.copy(sunDir).multiplyScalar(1000); };
  setSun(0.35, 2.4);
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); envScene.add(sky2);
  const bake = () => { Object.assign(sky2.material.uniforms.sunPosition.value, U.sunPosition.value); for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = U[k].value; sky2.material.uniforms.showSunDisc.value = 0; scene.environment = pm.fromScene(envScene, 0, 0.1, 2000).texture; };
  bake();
  scene.fog = null;
  const sun = new THREE.DirectionalLight(0xffe2c0, 3.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 20 }); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a7d6e, roughness: 0.9 }));
  ground.receiveShadow = true; scene.add(ground);
  const bike = new Bike(); scene.add(bike.group);
  const pel = new Pelican(); pel.root.position.copy(G.saddle); bike.frame.add(pel.root);
  const S = { az: 0.9, el: 0.2, dist: 2.6, target: new V3(0, 0.85, 0.1), speed: 5, t: 0, pedaling: true, trick: 0, scoop: 0, fov: 35 };
  const pedals = [{ p: new V3(), q: new THREE.Quaternion() }, { p: new V3(), q: new THREE.Quaternion() }], grips = [new V3(), new V3()];
  const vel = new V3();
  function step(dt) {
    S.t += dt;
    bike.update(dt, { speed: S.speed, pedaling: S.pedaling, steer: Math.sin(S.t * 0.7) * 0.05 });
    scene.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) { bike.pedalIn(pel.root, i, pedals[i].p, pedals[i].q); bike.gripIn(pel.root, i, grips[i]); }
    pel.update({ dt, crank: bike.crank, effort: S.pedaling ? 0.6 : 0, speed: S.speed, steer: 0, lean: 0, trick: S.trick, scoop: S.scoop, pedals, grips, vel: vel.set(0, 0, S.speed), look: S.look || null, lookW: S.look ? 1 : 0, eyeLook: S.look || null });
  }
  function render() {
    camera.fov = S.fov; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    camera.position.setFromSphericalCoords(S.dist, Math.PI / 2 - S.el, S.az).add(S.target); camera.lookAt(S.target);
    sun.position.copy(sunDir).multiplyScalar(8).add(S.target); sun.target.position.copy(S.target);
    renderer.render(scene, camera);
  }
  window.__debug = { S, step: (n = 1) => { for (let i = 0; i < n; i++) step(1 / 60); render(); }, pel, bike, setSun: (e, a) => { setSun(e, a); bake(); }, render };
  addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
  let last = performance.now();
  (function loop(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!window.__hold) { step(dt); S.az += dt * 0.15; } render(); requestAnimationFrame(loop); })(last);
}
