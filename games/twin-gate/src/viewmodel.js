// The Twin Gate Device held in first person: twin barrels ringed jade and vermilion, a glass core that shows the
// last gate fired. Sway, bob, recoil, hold pulse and a "no" shake. Drawn in its own scene over the world.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { G } from './gfx.js';
import { COLORS } from './portals.js';

const vm = { root: null, rig: null, rings: [], ringM: [], coreM: null, light: null, recoil: 0, recoilV: 0, shake: 0, swayX: 0, swayY: 0, hold: 0, last: 0, flash: [0, 0], show: 1, mode: 2 };

// The device's meshes, shared by the first-person view and the player's avatar. Returns the rig group plus the
// materials that animate (ring glow per barrel, glass core).
export function buildDevice() {
  const shell = new THREE.MeshStandardMaterial({ color: 0xc9ccc8, roughness: 0.38, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.4, metalness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xdff4f0, roughness: 0.02, metalness: 0.0, transparent: true, opacity: 0.35 });
  const coreM = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: COLORS[0].clone(), emissiveIntensity: 0.8 });
  const rig = new THREE.Group(), rings = [], ringM = [];
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.15, 0.44, 4, 0.045), shell); rig.add(body);
  const belly = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.08, 0.3, 3, 0.03), dark); belly.position.set(0, -0.09, 0.03); rig.add(belly);
  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.16, 0.08, 3, 0.02), dark); grip.position.set(0, -0.16, 0.12); grip.rotation.x = 0.35; rig.add(grip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.06, 20), dark); cap.rotation.x = Math.PI / 2; cap.position.z = 0.24; rig.add(cap);
  for (const [i, x] of [[0, -0.045], [1, 0.045]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.18, 18), dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(x, 0.0, -0.29); rig.add(barrel);
    const rm = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: COLORS[i].clone(), emissiveIntensity: 0.75 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.011, 8, 22), rm); ring.position.set(x, 0, -0.375); rig.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 6, 22), rm); ring2.position.set(x, 0, -0.33); rig.add(ring2);
    rings.push(ring); ringM.push(rm);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.1), shell); bridge.position.set(0, 0.03, -0.28); rig.add(bridge);
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.17, 6, 14), glass); capsule.rotation.x = Math.PI / 2; capsule.position.set(0, 0.095, -0.02); rig.add(capsule);
  const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.15, 4, 10), coreM); core.rotation.x = Math.PI / 2; core.position.set(0, 0.095, -0.02); rig.add(core);
  for (const s of [-1, 1]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.2), dark); fin.position.set(s * 0.09, 0.02, 0.02); rig.add(fin); }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.172, 0.012, 0.12), coreM); stripe.position.set(0, -0.02, 0.1); rig.add(stripe);
  return { rig, rings, ringM, coreM };
}

export function buildViewmodel() {
  const d = buildDevice(), root = new THREE.Group(), rig = d.rig; root.add(rig);
  vm.rings = d.rings; vm.ringM = d.ringM; vm.coreM = d.coreM;
  // muzzle light sits ahead of the barrels: placed inside the muzzle it blew the barrel ends out to white
  vm.light = new THREE.PointLight(COLORS[0], 0, 1.2, 2); vm.light.position.set(0, 0.06, -0.62); rig.add(vm.light);
  root.position.set(0.27, -0.27, -0.62); root.rotation.set(0.03, 0.07, 0); root.scale.setScalar(0.85);
  G.vmScene.add(root); vm.root = root; vm.rig = rig;
}

export function vmFire(i) { vm.recoilV += 1.6; vm.flash[i] = 1; vm.last = i; vm.coreM.emissive.copy(COLORS[i]); }
export function vmNope() { vm.shake = 0.35; }
export function vmMode(mode) { vm.mode = mode; }

// per frame: look deltas (px), bob phase/amount, holding flag, time
export function updateViewmodel(dt, lookX, lookY, bobT, bobAmt, holding, t, land) {
  if (!vm.root) return;
  vm.root.visible = vm.mode > 0;
  vm.swayX += (-lookX * 0.00035 - vm.swayX) * Math.min(1, dt * 10); vm.swayY += (lookY * 0.00035 - vm.swayY) * Math.min(1, dt * 10);
  vm.swayX = Math.max(-0.05, Math.min(0.05, vm.swayX)); vm.swayY = Math.max(-0.05, Math.min(0.05, vm.swayY));
  // recoil spring
  vm.recoilV += (-vm.recoil * 180 - vm.recoilV * 18) * dt; vm.recoil += vm.recoilV * dt;
  vm.hold += ((holding ? 1 : 0) - vm.hold) * Math.min(1, dt * 6);
  vm.shake = Math.max(0, vm.shake - dt);
  const sh = vm.shake > 0 ? Math.sin(t * 90) * vm.shake * 0.03 : 0;
  const bx = Math.sin(bobT) * 0.012 * bobAmt, by = -Math.abs(Math.cos(bobT)) * 0.012 * bobAmt;
  vm.rig.position.set(vm.swayX + bx + sh, vm.swayY + by + vm.hold * 0.03 - land * 0.25, vm.recoil * 0.08);
  vm.rig.rotation.set(vm.recoil * 0.35 + vm.swayY * 0.6 + vm.hold * 0.05, vm.swayX * 0.8, vm.swayX * 0.4 + sh * 2);
  for (let i = 0; i < 2; i++) {
    vm.flash[i] = Math.max(0, vm.flash[i] - dt * 4);
    const avail = vm.mode === 2 || (vm.mode === 1 && i === 0);
    // idle rings sit near display white in their own hue; a shot flashes them to ~2x (a brief glow, not a white-out)
    vm.ringM[i].emissiveIntensity = avail ? 0.75 + vm.flash[i] * 1.4 + vm.hold * (0.3 + Math.sin(t * 12) * 0.2) : 0.06;
    vm.rings[i].scale.setScalar(1 + vm.flash[i] * 0.4);
  }
  vm.coreM.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.15 + vm.hold * 0.5 + vm.flash[vm.last] * 1.2;
  vm.light.color.copy(COLORS[vm.last]); vm.light.intensity = vm.flash[vm.last] * 0.8 + vm.hold * 0.3;
}
