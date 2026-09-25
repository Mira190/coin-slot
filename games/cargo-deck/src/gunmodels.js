// Procedural weapon models. Local frame: barrel toward -z, up +y, origin at the top of the pistol grip.
// Every gun reports named points (grip, fore, sight, muzzle, eject) and movable parts (mag, bolt, slide, pump)
// so the viewmodel can animate reloads and line the sight up with the camera for ADS.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { gunFinish } from './textures.js';

let MATS = null;
export function gunMats() {
  if (MATS) return MATS;
  const f = (k, o = {}) => { const t = gunFinish(k); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rm, metalnessMap: t.rm, roughness: 1, metalness: 1, ...o }); };
  MATS = {
    metal: f('steel'),
    polymer: f('polymer'),
    wood: f('wood'),
    tan: f('tan'),
    bright: new THREE.MeshStandardMaterial({ color: 0x6a6c6f, roughness: 0.35, metalness: 1 }),
    blued: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.62, metalness: 0.55 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.3, metalness: 1 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x2a4a60, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }),
    lensDark: new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.05, metalness: 0.6 }),
    dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.4, 0.3) }),
    tritium: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3, 1) }),
    blade: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.22, metalness: 1 }),
    edge: new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.12, metalness: 1 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4d5a3a, roughness: 0.72, metalness: 0.12 }),
    greyblue: new THREE.MeshStandardMaterial({ color: 0x4a5462, roughness: 0.7, metalness: 0.15 }),
    smokeg: new THREE.MeshStandardMaterial({ color: 0x55604f, roughness: 0.75, metalness: 0.1 }),
    band: new THREE.MeshStandardMaterial({ color: 0xd0c030, roughness: 0.5 }),
  };
  return MATS;
}

function mk(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
const box = (w, h, d, hi, r = 0.004) => hi && Math.min(w, h, d) > r * 2.5 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
const cylZ = (r, len, seg = 12, r2 = r) => { const g = new THREE.CylinderGeometry(r2, r, len, seg); g.rotateX(Math.PI / 2); return g; };
const torusZ = (R, r) => new THREE.TorusGeometry(R, r, 6, 16);

// Picatinny rail: a strip with teeth
function rail(p, M, hi, x, y, z0, z1) {
  mk(p, box(0.022, 0.006, z1 - z0, false), M.metal, x, y, (z0 + z1) / 2);
  if (!hi) return;
  for (let z = z0 + 0.005; z < z1; z += 0.01) mk(p, new THREE.BoxGeometry(0.024, 0.004, 0.005), M.metal, x, y + 0.004, z);
}

export function buildGun(id, lod = 'hi') {
  const M = gunMats(), hi = lod === 'hi';
  const g = new THREE.Group();
  const parts = {}, pts = {};
  const P = (name, x, y, z) => { pts[name] = new THREE.Vector3(x, y, z); };
  switch (id) {
    case 'vk12': {
      // receiver + dust cover
      mk(g, box(0.046, 0.066, 0.3, hi), M.blued, 0, 0.03, 0);
      mk(g, new THREE.CylinderGeometry(0.022, 0.022, 0.27, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), M.blued, 0, 0.05, 0.015);
      // rear sight block + tangent leaf with the notch (notch bottom on the sight line, y 0.1)
      mk(g, box(0.03, 0.026, 0.03, hi), M.metal, 0, 0.076, -0.13);
      mk(g, new THREE.BoxGeometry(0.009, 0.014, 0.008), M.metal, -0.0085, 0.098, -0.13);
      mk(g, new THREE.BoxGeometry(0.009, 0.014, 0.008), M.metal, 0.0085, 0.098, -0.13);
      mk(g, new THREE.BoxGeometry(0.026, 0.004, 0.008), M.metal, 0, 0.09, -0.13);
      // gas tube + wood upper guard, lower handguard
      mk(g, cylZ(0.012, 0.26), M.metal, 0, 0.066, -0.29);
      mk(g, box(0.038, 0.028, 0.19, hi, 0.008), M.wood, 0, 0.068, -0.27);
      mk(g, box(0.056, 0.052, 0.22, hi, 0.01), M.wood, 0, 0.022, -0.27);
      // barrel, front sight tower with hood, muzzle brake
      mk(g, cylZ(0.011, 0.5), M.metal, 0, 0.035, -0.42);
      mk(g, box(0.02, 0.05, 0.03, hi), M.metal, 0, 0.06, -0.57);
      mk(g, new THREE.BoxGeometry(0.0035, 0.02, 0.004), M.metal, 0, 0.09, -0.57);
      if (hi) mk(g, torusZ(0.013, 0.0018), M.metal, 0, 0.095, -0.57);
      mk(g, cylZ(0.016, 0.06, 10), M.metal, 0, 0.035, -0.69);
      if (hi) for (let i = 0; i < 3; i++) mk(g, new THREE.BoxGeometry(0.034, 0.006, 0.008), M.polymer, 0, 0.035, -0.675 - i * 0.014);
      // pistol grip, trigger + guard
      mk(g, box(0.034, 0.105, 0.045, hi, 0.008), M.wood, 0, -0.045, 0.075, -0.3);
      mk(g, new THREE.BoxGeometry(0.006, 0.004, 0.08), M.metal, 0, -0.028, 0.02);
      mk(g, new THREE.BoxGeometry(0.004, 0.03, 0.006), M.metal, 0, -0.02, 0.03, 0.2);
      // stock
      const st = mk(g, box(0.042, 0.075, 0.33, hi, 0.01), M.wood, 0, -0.005, 0.31, 0.12);
      mk(g, box(0.044, 0.105, 0.02, hi), M.polymer, 0, -0.03, 0.47, 0.12);
      // charging handle (bolt carrier) on the right
      const bolt = new THREE.Group(); bolt.position.set(0.028, 0.045, -0.02); g.add(bolt); parts.bolt = bolt;
      mk(bolt, new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8), M.bright, 0.012, 0, 0, 0, 0, Math.PI / 2);
      mk(bolt, new THREE.SphereGeometry(0.009, 8, 6), M.bright, 0.028, 0, 0);
      // curved magazine
      const mag = new THREE.Group(); mag.position.set(0, -0.005, -0.075); g.add(mag); parts.mag = mag;
      for (let i = 0; i < 4; i++) {
        const seg = mk(mag, box(0.03, 0.055, 0.062, hi, 0.006), M.metal, 0, -0.03 - i * 0.048, -0.01 * i * i * 0.8, -0.14 * i);
        if (hi) mk(seg, new THREE.BoxGeometry(0.032, 0.004, 0.064), M.polymer, 0, 0.022, 0);
      }
      P('grip', 0, -0.04, 0.07); P('fore', 0, 0.0, -0.27); P('sight', 0, 0.1, -0.13); P('muzzle', 0, 0.035, -0.73); P('eject', 0.03, 0.05, -0.02); P('front', 0, 0.1, -0.57);
      break;
    }
    case 'r4': {
      mk(g, box(0.042, 0.058, 0.26, hi), M.metal, 0, 0.034, 0.0);
      mk(g, box(0.038, 0.05, 0.2, hi), M.metal, 0, -0.004, 0.02); // lower
      rail(g, M, hi, 0, 0.066, -0.13, 0.03);
      // octagonal handguard with rails
      mk(g, new THREE.CylinderGeometry(0.026, 0.026, 0.28, 8).rotateX(Math.PI / 2), M.polymer, 0, 0.032, -0.27, 0, 0, Math.PI / 8);
      rail(g, M, hi, 0, 0.061, -0.4, -0.14);
      mk(g, cylZ(0.009, 0.14), M.metal, 0, 0.032, -0.47);
      mk(g, cylZ(0.012, 0.045, 8), M.metal, 0, 0.032, -0.555); // flash hider
      if (hi) for (let i = 0; i < 4; i++) mk(g, new THREE.BoxGeometry(0.003, 0.026, 0.03), M.polymer, Math.cos(i * 1.57) * 0.012, 0.032 + Math.sin(i * 1.57) * 0.012, -0.56, 0, 0, i * 1.57);
      // folded front sight
      mk(g, box(0.018, 0.012, 0.03, false), M.metal, 0, 0.07, -0.38);
      // red dot sight on the rail: housing tube, lenses, emissive dot at the centre
      const rd = new THREE.Group(); rd.position.set(0, 0.092, -0.01); g.add(rd); parts.optic = rd;
      mk(rd, box(0.028, 0.016, 0.05, hi), M.metal, 0, -0.021, 0);
      const tube = new THREE.CylinderGeometry(0.02, 0.02, 0.07, 18, 1, true).rotateX(Math.PI / 2);
      mk(rd, tube, M.metal, 0, 0, 0);
      if (hi) { mk(rd, torusZ(0.02, 0.003), M.metal, 0, 0, -0.035); mk(rd, torusZ(0.02, 0.003), M.metal, 0, 0, 0.035); }
      mk(rd, new THREE.CircleGeometry(0.019, 18), M.lens, 0, 0, -0.03);
      mk(rd, new THREE.SphereGeometry(0.0011, 8, 6), M.dot, 0, 0, -0.03);
      mk(rd, box(0.01, 0.012, 0.014, false), M.metal, 0.022, 0, 0); // turret
      // grip, guard, stock tube + stock
      mk(g, box(0.032, 0.1, 0.042, hi, 0.008), M.polymer, 0, -0.06, 0.075, -0.32);
      mk(g, new THREE.BoxGeometry(0.006, 0.004, 0.07), M.metal, 0, -0.032, 0.02);
      mk(g, cylZ(0.015, 0.2), M.metal, 0, 0.02, 0.2);
      mk(g, box(0.04, 0.09, 0.14, hi, 0.012), M.polymer, 0, 0.0, 0.3);
      // charging handle at the rear (T), ejection port cover
      parts.bolt = mk(g, box(0.05, 0.008, 0.012, false), M.metal, 0, 0.058, 0.125);
      mk(g, new THREE.BoxGeometry(0.002, 0.02, 0.05), M.metal, 0.022, 0.035, -0.02);
      const mag = new THREE.Group(); mag.position.set(0, -0.02, -0.04); g.add(mag); parts.mag = mag;
      mk(mag, box(0.026, 0.15, 0.06, hi, 0.005), M.metal, 0, -0.07, -0.006, -0.08);
      mk(mag, box(0.028, 0.012, 0.062, false), M.polymer, 0, -0.145, -0.012, -0.08);
      P('grip', 0, -0.05, 0.07); P('fore', 0, 0.005, -0.27); P('sight', 0, 0.092, -0.01); P('muzzle', 0, 0.032, -0.58); P('eject', 0.03, 0.04, -0.02); P('front', 0, 0.092, -0.045);
      break;
    }
    case 'wasp': {
      mk(g, cylZ(0.026, 0.3, 14), M.metal, 0, 0.04, -0.04);
      mk(g, box(0.036, 0.04, 0.22, hi), M.polymer, 0, 0.0, 0.0);
      mk(g, box(0.05, 0.05, 0.14, hi, 0.012), M.polymer, 0, 0.02, -0.21); // handguard
      mk(g, cylZ(0.008, 0.08), M.metal, 0, 0.04, -0.31);
      mk(g, cylZ(0.011, 0.03, 8), M.metal, 0, 0.04, -0.345);
      // ring sights (rear drum aperture / hooded front post), sight line y 0.078
      mk(g, box(0.02, 0.02, 0.02, false), M.metal, 0, 0.065, 0.08);
      mk(g, torusZ(0.008, 0.0025), M.metal, 0, 0.078, 0.08);
      mk(g, box(0.012, 0.022, 0.012, false), M.metal, 0, 0.064, -0.17);
      mk(g, torusZ(0.011, 0.0022), M.metal, 0, 0.078, -0.17);
      mk(g, new THREE.BoxGeometry(0.002, 0.01, 0.003), M.metal, 0, 0.074, -0.17);
      // grip + guard, folded wire stock
      mk(g, box(0.032, 0.1, 0.04, hi, 0.008), M.polymer, 0, -0.06, 0.06, -0.25);
      mk(g, new THREE.BoxGeometry(0.006, 0.004, 0.06), M.metal, 0, -0.024, 0.02);
      for (const x of [-0.02, 0.02]) mk(g, cylZ(0.004, 0.2), M.metal, x, 0.0, 0.2);
      mk(g, box(0.045, 0.06, 0.012, false), M.polymer, 0, -0.01, 0.3);
      parts.bolt = mk(g, cylZ(0.005, 0.05), M.bright, -0.022, 0.06, -0.14); // cocking tube handle, left side
      const mag = new THREE.Group(); mag.position.set(0, -0.015, -0.06); g.add(mag); parts.mag = mag;
      for (let i = 0; i < 3; i++) mk(mag, box(0.024, 0.06, 0.036, hi, 0.004), M.metal, 0, -0.03 - i * 0.052, -0.012 * i * i, -0.12 * i);
      P('grip', 0, -0.05, 0.06); P('fore', 0, -0.005, -0.21); P('sight', 0, 0.078, 0.08); P('muzzle', 0, 0.04, -0.36); P('eject', 0.03, 0.05, -0.03); P('front', 0, 0.078, -0.17);
      break;
    }
    case 'longbolt': {
      mk(g, cylZ(0.022, 0.24, 14), M.metal, 0, 0.035, -0.02); // receiver
      mk(g, cylZ(0.013, 0.62), M.metal, 0, 0.035, -0.45); // barrel
      mk(g, cylZ(0.017, 0.07, 10), M.metal, 0, 0.035, -0.79);
      // tan chassis/stock
      mk(g, box(0.05, 0.05, 0.4, hi, 0.012), M.tan, 0, 0.0, -0.2);
      mk(g, box(0.034, 0.11, 0.05, hi, 0.01), M.tan, 0, -0.06, 0.08, -0.25);
      mk(g, box(0.044, 0.07, 0.3, hi, 0.012), M.tan, 0, 0.005, 0.3, 0.05);
      mk(g, box(0.044, 0.12, 0.03, hi, 0.008), M.polymer, 0, -0.01, 0.46);
      mk(g, box(0.02, 0.03, 0.16, hi, 0.006), M.tan, 0, 0.055, 0.28); // cheek rest
      mk(g, new THREE.BoxGeometry(0.006, 0.004, 0.07), M.metal, 0, -0.03, 0.03);
      // scope: tube, bells, turrets, rings
      const sc = new THREE.Group(); sc.position.set(0, 0.098, -0.05); g.add(sc); parts.optic = sc;
      mk(sc, cylZ(0.016, 0.26), M.metal, 0, 0, 0);
      mk(sc, cylZ(0.028, 0.08, 16, 0.017), M.metal, 0, 0, -0.16);
      mk(sc, cylZ(0.021, 0.06, 16, 0.017), M.metal, 0, 0, 0.15);
      mk(sc, new THREE.CircleGeometry(0.026, 16), M.lensDark, 0, 0, -0.2005).rotation.y = Math.PI;
      mk(sc, new THREE.CircleGeometry(0.02, 16), M.lensDark, 0, 0, 0.1805);
      mk(sc, new THREE.CylinderGeometry(0.009, 0.009, 0.024, 10), M.metal, 0, 0.024, -0.02);
      mk(sc, new THREE.CylinderGeometry(0.009, 0.009, 0.024, 10).rotateZ(Math.PI / 2), M.metal, 0.024, 0, -0.02);
      for (const z of [-0.08, 0.06]) mk(g, box(0.026, 0.05, 0.02, false), M.metal, 0, 0.07, -0.05 + z);
      // bolt handle
      const bolt = new THREE.Group(); bolt.position.set(0.024, 0.04, 0.08); g.add(bolt); parts.bolt = bolt;
      mk(bolt, new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), M.bright, 0.02, -0.012, 0, 0, 0, 1.1);
      mk(bolt, new THREE.SphereGeometry(0.011, 10, 8), M.polymer, 0.04, -0.03, 0);
      // box magazine, folded bipod
      const mag = new THREE.Group(); mag.position.set(0, -0.03, -0.04); g.add(mag); parts.mag = mag;
      mk(mag, box(0.03, 0.07, 0.085, hi, 0.005), M.metal, 0, -0.03, 0);
      for (const x of [-0.016, 0.016]) mk(g, cylZ(0.005, 0.16), M.metal, x, -0.02, -0.52);
      P('grip', 0, -0.05, 0.08); P('fore', 0, -0.02, -0.24); P('sight', 0, 0.098, 0.15); P('muzzle', 0, 0.035, -0.83); P('eject', 0.03, 0.05, 0.0); P('front', 0, 0.098, -0.2);
      break;
    }
    case 'breacher': {
      mk(g, box(0.048, 0.07, 0.22, hi), M.blued, 0, 0.03, 0.0);
      mk(g, cylZ(0.015, 0.5), M.metal, 0, 0.05, -0.36); // barrel
      mk(g, cylZ(0.014, 0.42), M.metal, 0, 0.018, -0.31); // tube mag
      mk(g, cylZ(0.016, 0.02), M.metal, 0, 0.018, -0.52);
      const pump = new THREE.Group(); pump.position.set(0, 0.018, -0.24); g.add(pump); parts.pump = pump;
      mk(pump, box(0.054, 0.05, 0.16, hi, 0.012), M.polymer, 0, -0.002, 0);
      if (hi) for (let i = 0; i < 6; i++) mk(pump, new THREE.BoxGeometry(0.056, 0.004, 0.006), M.polymer, 0, -0.022, -0.06 + i * 0.024);
      mk(g, box(0.008, 0.024, 0.02, false), M.metal, 0, 0.074, -0.6); // front blade
      mk(g, new THREE.SphereGeometry(0.0035, 8, 6), M.tritium, 0, 0.087, -0.6);
      mk(g, box(0.012, 0.02, 0.016, false), M.metal, 0, 0.074, 0.07); // ghost ring post
      mk(g, torusZ(0.011, 0.0025), M.metal, 0, 0.09, 0.07);
      mk(g, box(0.036, 0.105, 0.045, hi, 0.008), M.polymer, 0, -0.05, 0.08, -0.3);
      mk(g, new THREE.BoxGeometry(0.006, 0.004, 0.07), M.metal, 0, -0.012, 0.02);
      mk(g, box(0.044, 0.09, 0.3, hi, 0.014), M.polymer, 0, -0.0, 0.26, 0.12);
      mk(g, box(0.046, 0.12, 0.025, hi), M.olive, 0, -0.028, 0.41, 0.12);
      parts.eject = mk(g, new THREE.BoxGeometry(0.002, 0.03, 0.06), M.bright, 0.025, 0.035, -0.02);
      P('grip', 0, -0.045, 0.08); P('fore', 0, 0.0, -0.24); P('sight', 0, 0.09, 0.07); P('muzzle', 0, 0.05, -0.62); P('eject', 0.03, 0.04, -0.02); P('front', 0, 0.09, -0.6);
      break;
    }
    case 'talon': {
      const slide = new THREE.Group(); slide.position.set(0, 0.035, -0.04); g.add(slide); parts.slide = slide;
      mk(slide, box(0.029, 0.034, 0.19, hi, 0.004), M.metal, 0, 0, 0);
      if (hi) for (let i = 0; i < 7; i++) mk(slide, new THREE.BoxGeometry(0.031, 0.022, 0.003), M.polymer, 0, 0, 0.065 + i * 0.005);
      mk(slide, new THREE.BoxGeometry(0.006, 0.008, 0.006), M.metal, 0, 0.021, -0.085); // front post
      mk(slide, new THREE.BoxGeometry(0.002, 0.002, 0.002), M.tritium, 0, 0.025, -0.087);
      for (const x of [-0.006, 0.006]) { mk(slide, new THREE.BoxGeometry(0.006, 0.009, 0.008), M.metal, x, 0.021, 0.085); mk(slide, new THREE.BoxGeometry(0.002, 0.002, 0.002), M.tritium, x, 0.024, 0.0885); }
      mk(g, box(0.027, 0.028, 0.16, hi), M.polymer, 0, 0.008, -0.03); // frame
      mk(g, box(0.03, 0.105, 0.045, hi, 0.008), M.polymer, 0, -0.045, 0.045, -0.22);
      mk(g, new THREE.TorusGeometry(0.018, 0.003, 5, 12, Math.PI), M.polymer, 0, -0.008, -0.005, 0, Math.PI / 2, Math.PI);
      mk(g, cylZ(0.006, 0.02), M.metal, 0, 0.035, -0.14);
      const mag = new THREE.Group(); mag.position.set(0, -0.02, 0.04); g.add(mag); parts.mag = mag;
      mk(mag, box(0.022, 0.1, 0.034, hi, 0.004), M.metal, 0, -0.04, 0.0, -0.22);
      P('grip', 0, -0.04, 0.045); P('fore', -0.01, -0.05, 0.04); P('sight', 0, 0.06, 0.045); P('muzzle', 0, 0.035, -0.14); P('eject', 0.02, 0.05, -0.02); P('front', 0, 0.06, -0.125);
      break;
    }
    case 'knife': {
      const blade = new THREE.Shape();
      blade.moveTo(0, 0); blade.lineTo(0.17, 0.004); blade.quadraticCurveTo(0.2, 0.012, 0.215, 0.028); blade.lineTo(0.16, 0.03); blade.lineTo(0, 0.03); blade.closePath();
      const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.002, bevelSegments: 1 });
      bg.translate(0, -0.015, -0.002); bg.rotateY(Math.PI / 2);
      mk(g, bg, M.blade, 0, 0.0, -0.02);
      mk(g, box(0.02, 0.05, 0.012, hi, 0.003), M.metal, 0, 0.0, -0.015); // guard
      mk(g, box(0.026, 0.034, 0.11, hi, 0.01), M.polymer, 0, -0.002, 0.045);
      if (hi) for (let i = 0; i < 6; i++) mk(g, new THREE.BoxGeometry(0.028, 0.036, 0.004), M.metal, 0, -0.002, 0.005 + i * 0.016);
      mk(g, box(0.024, 0.03, 0.014, hi, 0.004), M.metal, 0, -0.002, 0.105);
      P('grip', 0, 0, 0.05); P('fore', 0, 0, 0.05); P('sight', 0, 0.1, 0); P('muzzle', 0, 0, -0.23); P('eject', 0, 0, 0); P('front', 0, 0.1, -0.2);
      break;
    }
  }
  if (!hi) g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, parts, pts };
}

export function buildGrenade(kind) {
  const M = gunMats(), g = new THREE.Group();
  if (kind === 'frag') {
    mk(g, new THREE.SphereGeometry(0.032, 14, 10), M.olive, 0, 0, 0).scale.set(1, 1.15, 1);
    mk(g, new THREE.CylinderGeometry(0.012, 0.014, 0.022, 10), M.metal, 0, 0.042, 0);
    mk(g, new THREE.BoxGeometry(0.01, 0.06, 0.004), M.metal, 0.012, 0.02, 0.0, 0, 0, 0.15); // spoon
    mk(g, new THREE.TorusGeometry(0.011, 0.0018, 5, 12), M.bright, -0.018, 0.05, 0, 0, Math.PI / 2, 0);
  } else {
    const mat = kind === 'flash' ? M.greyblue : M.smokeg;
    mk(g, new THREE.CylinderGeometry(0.027, 0.027, 0.1, 14), mat, 0, 0, 0);
    mk(g, new THREE.CylinderGeometry(0.0275, 0.0275, 0.018, 14), kind === 'flash' ? M.polymer : M.band, 0, 0.02, 0);
    mk(g, new THREE.CylinderGeometry(0.012, 0.014, 0.018, 10), M.metal, 0, 0.058, 0);
    mk(g, new THREE.BoxGeometry(0.01, 0.07, 0.004), M.metal, 0.02, 0.03, 0);
    mk(g, new THREE.TorusGeometry(0.011, 0.0018, 5, 12), M.bright, -0.018, 0.064, 0, 0, Math.PI / 2, 0);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
