// Articulated soldier: bone hierarchy with capsule/lathe limbs, procedural gait (run / strafe / backpedal /
// crouch / jump), IK arms that hold the third-person gun, per-limb hitbox capsules that follow the bones,
// and a Verlet ragdoll for deaths.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { camo } from './textures.js';
import { buildGun } from './gunmodels.js';
import { mergeChildren, mergeDeep } from './geom.js';
const SOLID = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.08 });

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DOWN = V(0, -1, 0);
const _v1 = V(), _v2 = V(), _v3 = V(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

// team looks: uniform camo palette, vest, helmet, accent (armband / helmet band)
const LOOKS = [
  { camo: ['#3c4b5e', '#58687c', '#2a3340', '#7a8898'], vest: 0x2d3440, helmet: 0x3a4250, accent: 0x2f7bff, boots: 0x1c1d20 },
  { camo: ['#77684a', '#94805a', '#51452f', '#ab9a76'], vest: 0x8a7550, helmet: 0x7d6c4c, accent: 0xe03a2a, boots: 0x3a2b1e },
];
const SKIN = [0xc99c7c, 0x8d5a3f, 0xe0b594, 0x6b4430, 0xb5835f];
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = LOOKS.map((L, t) => {
    const c = camo(L.camo, 5 + t * 13, 6);
    return {
      cloth: new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normal, roughness: 0.9, metalness: 0 }),
      vest: new THREE.MeshStandardMaterial({ color: L.vest, roughness: 0.8, metalness: 0.05 }),
      pouch: new THREE.MeshStandardMaterial({ color: new THREE.Color(L.vest).multiplyScalar(0.8), roughness: 0.85 }),
      helmet: new THREE.MeshStandardMaterial({ color: L.helmet, roughness: 0.55, metalness: 0.15 }),
      accent: new THREE.MeshStandardMaterial({ color: new THREE.Color(L.accent).multiplyScalar(1.4), roughness: 0.5 }),
      boots: new THREE.MeshStandardMaterial({ color: L.boots, roughness: 0.7 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.75 }),
      black: new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.5, metalness: 0.3 }),
      lens: new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.05, metalness: 0.9 }),
      skins: SKIN.map((s) => new THREE.MeshStandardMaterial({ color: s, roughness: 0.65 })),
    };
  });
  return SHARED;
}
const cap = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 4, seg);
function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = false;
  parent.add(m); return m;
}
const bone = (parent, x, y, z) => { const b = new THREE.Group(); b.position.set(x, y, z); parent.add(b); return b; };

// ray vs capsule (segment a-b, radius r): distance along the unit ray or -1
export function rayCapsule(o, d, a, b, r) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const oax = o.x - a.x, oay = o.y - a.y, oaz = o.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz, bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz, rdoa = d.x * oax + d.y * oay + d.z * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
  const A = baba - bard * bard; let B = baba * rdoa - baoa * bard; let C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0 && A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A, y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
    const ocx = y <= 0 ? oax : o.x - b.x, ocy = y <= 0 ? oay : o.y - b.y, ocz = y <= 0 ? oaz : o.z - b.z;
    B = d.x * ocx + d.y * ocy + d.z * ocz; C = ocx * ocx + ocy * ocy + ocz * ocz - r * r; h = B * B - C;
    if (h > 0) return -B - Math.sqrt(h);
  }
  return -1;
}

export class Soldier {
  constructor(team, seed = 0) {
    const S = shared()[team];
    this.team = team;
    const g = this.group = new THREE.Group();
    const skin = S.skins[seed % S.skins.length];
    // ---- skeleton
    const B = this.b = {};
    B.hips = bone(g, 0, 0.95, 0);
    B.spine = bone(B.hips, 0, 0.1, 0);
    B.chest = bone(B.spine, 0, 0.2, 0);
    B.neck = bone(B.chest, 0, 0.22, 0);
    B.head = bone(B.neck, 0, 0.07, 0);
    for (const s of [-1, 1]) {
      const k = s < 0 ? 'L' : 'R';
      B['sh' + k] = bone(B.chest, s * 0.2, 0.16, 0.0);
      B['el' + k] = bone(B['sh' + k], 0, -0.29, 0);
      B['ha' + k] = bone(B['el' + k], 0, -0.27, 0);
      B['th' + k] = bone(B.hips, s * 0.1, -0.04, 0);
      B['kn' + k] = bone(B['th' + k], 0, -0.44, 0);
      B['ft' + k] = bone(B['kn' + k], 0, -0.44, 0);
    }
    // ---- meshes
    // pelvis + belt
    add(B.hips, new RoundedBoxGeometry(0.34, 0.2, 0.22, 2, 0.06), S.cloth, 0, 0.0, 0);
    add(B.hips, new THREE.BoxGeometry(0.36, 0.05, 0.24), S.black, 0, 0.07, 0);
    for (const x of [-0.13, 0.13]) add(B.hips, new RoundedBoxGeometry(0.07, 0.09, 0.06, 1, 0.015), S.pouch, x, 0.02, -0.12);
    add(B.hips, new RoundedBoxGeometry(0.06, 0.12, 0.05, 1, 0.015), S.pouch, 0.19, -0.02, 0.02); // holster
    // abdomen / chest (shirt) + plate carrier + pouches + backpack
    add(B.spine, new RoundedBoxGeometry(0.31, 0.24, 0.2, 2, 0.07), S.cloth, 0, 0.08, 0);
    add(B.chest, new RoundedBoxGeometry(0.38, 0.34, 0.23, 2, 0.08), S.cloth, 0, 0.06, 0);
    add(B.chest, new RoundedBoxGeometry(0.4, 0.32, 0.28, 2, 0.05), S.vest, 0, 0.04, 0.0);
    for (let i = -1; i <= 1; i++) add(B.chest, new RoundedBoxGeometry(0.1, 0.13, 0.06, 1, 0.015), S.pouch, i * 0.115, -0.03, -0.16);
    add(B.chest, new RoundedBoxGeometry(0.1, 0.08, 0.04, 1, 0.01), S.pouch, -0.1, 0.12, -0.155); // radio pouch
    add(B.chest, new THREE.CylinderGeometry(0.008, 0.008, 0.18, 5), S.black, -0.14, 0.26, -0.1, 0.1, 0, 0.1); // antenna
    add(B.chest, new RoundedBoxGeometry(0.26, 0.3, 0.1, 2, 0.035), S.pouch, 0, 0.02, 0.185); // assault pack
    add(B.chest, new THREE.CylinderGeometry(0.05, 0.05, 0.28, 10), S.vest, 0, 0.2, 0.19, 0, 0, Math.PI / 2); // bedroll
    for (const x of [-0.07, 0.07]) add(B.chest, new THREE.BoxGeometry(0.03, 0.26, 0.012), S.black, x, 0.06, 0.24); // straps
    add(B.chest, new RoundedBoxGeometry(0.1, 0.14, 0.06, 1, 0.02), S.accent, 0.235, 0.02, 0.0, 0, 0, 0.1).scale.set(0.3, 1, 1.3); // team flash on the shoulder strap
    // neck + head (skin, helmet, goggles, headset / face cover)
    add(B.neck, new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), skin, 0, 0.02, 0);
    const head = add(B.head, new THREE.SphereGeometry(0.105, 16, 12), skin, 0, 0.1, -0.005, 0, 0, 0, 0.92, 1.05, 1.0);
    add(B.head, new THREE.SphereGeometry(0.03, 8, 6), skin, 0, 0.085, -0.1); // nose
    for (const x of [-0.035, 0.035]) { add(B.head, new THREE.SphereGeometry(0.012, 8, 6), S.black, x, 0.11, -0.088); add(B.head, new THREE.BoxGeometry(0.03, 0.007, 0.01), S.black, x, 0.128, -0.09); }
    add(B.head, new THREE.BoxGeometry(0.04, 0.006, 0.01), S.black, 0, 0.055, -0.094); // mouth
    if (team === 1) add(B.head, new THREE.SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4), S.black, 0, 0.1, -0.012, 0, 0, 0, 0.96, 1.06, 1.04); // face wrap
    // profile listed bottom -> top so the lathe's faces point outward
    const hg = new THREE.LatheGeometry([V(0.128, -0.005), V(0.14, 0.0), V(0.137, 0.02), V(0.132, 0.07), V(0.11, 0.125), V(0.06, 0.155), V(0.001, 0.16)].map((p) => new THREE.Vector2(p.x, p.y)), 18);
    add(B.head, hg, S.helmet, 0, 0.11, 0.0);
    add(B.head, new THREE.TorusGeometry(0.135, 0.008, 5, 20), S.accent, 0, 0.14, 0, Math.PI / 2, 0, 0);
    add(B.head, new RoundedBoxGeometry(0.16, 0.045, 0.05, 1, 0.012), S.lens, 0, 0.13, -0.1); // goggles
    add(B.head, new THREE.BoxGeometry(0.2, 0.02, 0.02), S.black, 0, 0.13, -0.07);
    for (const s of [-1, 1]) add(B.head, new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12), S.black, s * 0.11, 0.09, 0.0, 0, 0, Math.PI / 2);
    add(B.head, new RoundedBoxGeometry(0.05, 0.05, 0.03, 1, 0.01), S.black, 0, 0.2, -0.1); // NVG mount
    this.headMesh = head;
    // arms
    for (const s of [-1, 1]) {
      const k = s < 0 ? 'L' : 'R';
      add(B['sh' + k], new THREE.SphereGeometry(0.07, 10, 8), S.cloth, 0, -0.01, 0);
      add(B['sh' + k], cap(0.056, 0.2), S.cloth, 0, -0.145, 0);
      if (k === 'L') add(B['sh' + k], new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), S.accent, 0, -0.09, 0); // armband
      add(B['el' + k], cap(0.047, 0.2), S.cloth, 0, -0.13, 0);
      add(B['el' + k], new THREE.CylinderGeometry(0.052, 0.05, 0.06, 10), S.glove, 0, -0.24, 0); // cuff
      const hand = add(B['ha' + k], new RoundedBoxGeometry(0.075, 0.1, 0.035, 2, 0.015), S.glove, 0, -0.045, 0);
      add(B['ha' + k], cap(0.014, 0.03, 6), S.glove, s * -0.035, -0.03, -0.02, 0.6, 0, s * 0.5);
      // legs
      add(B['th' + k], cap(0.085, 0.3), S.cloth, 0, -0.21, 0);
      add(B['th' + k], new RoundedBoxGeometry(0.07, 0.1, 0.07, 1, 0.015), S.pouch, s * 0.085, -0.2, 0.0);
      add(B['kn' + k], new RoundedBoxGeometry(0.1, 0.1, 0.06, 1, 0.02), S.black, 0, -0.02, -0.06); // knee pad
      add(B['kn' + k], cap(0.065, 0.28), S.cloth, 0, -0.2, 0);
      add(B['kn' + k], new THREE.CylinderGeometry(0.068, 0.072, 0.14, 10), S.boots, 0, -0.39, 0);
      add(B['ft' + k], new RoundedBoxGeometry(0.1, 0.08, 0.26, 2, 0.03), S.boots, 0, -0.03, -0.06);
    }
    // one textured + one vertex-coloured mesh per bone keeps ten soldiers to a few hundred draw calls
    for (const bn of Object.values(B)) mergeChildren(bn, SOLID);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // weapon anchor on the chest (right shoulder pocket); gun + knife attached here
    this.anchor = bone(B.chest, 0.12, 0.08, -0.22);
    this.guns = {};
    this.gun = null; this.gunId = null;
    // state
    this.phase = Math.random() * 6; this.kick = 0; this.crouch = 0; this.leanYaw = 0; this.alive = true;
    this.rag = null; this._hb = null; this._hbFrame = -1;
    this.visible = true;
  }
  setWeapon(id) {
    if (this.gunId === id) return;
    if (this.gun) this.gun.group.visible = false;
    if (!this.guns[id]) {
      const g = buildGun(id === 'frag' || id === 'flash' || id === 'smoke' ? 'talon' : id, 'lo');
      mergeDeep(g.group);
      this.anchor.add(g.group); this.guns[id] = g;
    }
    this.gun = this.guns[id]; this.gun.group.visible = !(id === 'frag' || id === 'flash' || id === 'smoke');
    this.gunId = id;
  }
  fire() { this.kick = 1; }
  // hit reaction: torso (or head) snaps away from the shot, decays in a few tenths of a second
  hit(dir, part) {
    const lx = dir.x * Math.cos(this.group.rotation.y) - dir.z * Math.sin(this.group.rotation.y);
    const k = part === 'head' ? 1.4 : part === 'leg' ? 0.5 : 1;
    this.fl = this.fl || { x: 0, z: 0, h: 0 };
    this.fl.x += 0.22 * k; this.fl.z += -lx * 0.3 * k; if (part === 'head') this.fl.h += 0.5;
  }
  // st: { pos, yaw, pitch, vel, onGround, crouch 0..1, reload 0..1|null, knife 0..1|null, throw 0..1|null, dt }
  update(dt, st) {
    this._hbFrame = -1; // pose changes this step: hitboxes must be rebuilt from it
    if (this.rag) return;
    const B = this.b;
    this.group.position.copy(st.pos);
    this.group.rotation.y = st.yaw;
    // local velocity (forward = -z)
    const cs = Math.cos(st.yaw), sn = Math.sin(st.yaw);
    const vx = st.vel.x, vz = st.vel.z;
    const fwd = -(vx * sn + vz * cs), right = vx * cs - vz * sn; // project on facing (-z) and right (+x)
    const speed = Math.hypot(vx, vz);
    const back = fwd < -0.3;
    let legYaw = speed > 0.3 ? Math.atan2(right, back ? -fwd : fwd) : 0;
    legYaw = clamp(legYaw, -1.1, 1.1) * (back ? -1 : 1);
    this.leanYaw += (legYaw - this.leanYaw) * Math.min(1, dt * 8);
    const amp = clamp(speed / 5.2, 0, 1);
    this.phase += dt * (speed * 1.75 + 0.01) * (back ? -1 : 1);
    this.crouch += ((st.crouch || 0) - this.crouch) * Math.min(1, dt * 10);
    const c = this.crouch, air = st.onGround ? 0 : 1;
    // hips / spine
    B.hips.position.y = 0.95 - 0.34 * c + (Math.abs(Math.cos(this.phase)) - 0.6) * 0.045 * amp;
    B.hips.rotation.set(0.08 * amp + 0.15 * c, -this.leanYaw * 0.75, Math.sin(this.phase) * 0.05 * amp);
    const pitch = st.pitch || 0;
    this.kick *= Math.exp(-dt * 14);
    B.spine.rotation.set(pitch * 0.25 - 0.06 * amp + 0.1 * c, this.leanYaw * 0.45, 0);
    const fl = this.fl || { x: 0, z: 0, h: 0 };
    if (this.fl) { const d = Math.exp(-dt * 9); fl.x *= d; fl.z *= d; fl.h *= d; }
    B.chest.rotation.set(pitch * 0.4 - 0.08 * this.kick - fl.x, this.leanYaw * 0.3, -Math.sin(this.phase) * 0.03 * amp + fl.z);
    B.neck.rotation.set(pitch * 0.15, 0, 0); B.head.rotation.set(pitch * 0.12 - fl.h, 0, fl.z * 0.5);
    // legs: gait + crouch + air tuck
    for (const s of [-1, 1]) {
      const k = s < 0 ? 'L' : 'R', ph = this.phase + (s < 0 ? 0 : Math.PI);
      const swing = Math.sin(ph) * 0.62 * amp, lift = Math.max(0, Math.sin(ph + 1.2)) * 1.15 * amp;
      const kneel = s < 0 ? [1.35, -1.55, 0.3] : [0.25, -2.0, 1.1]; // left knee up, right knee down
      B['th' + k].rotation.set(swing + kneel[0] * c * (1 - amp * 0.5) + air * 0.5, 0, s * 0.04);
      B['kn' + k].rotation.set(-lift - 0.08 + kneel[1] * c * (1 - amp * 0.4) - air * 0.9, 0, 0);
      B['ft' + k].rotation.set(lift * 0.3 + kneel[2] * c * (1 - amp) + air * 0.3, 0, 0);
    }
    // weapon pose: gun on the anchor, aimed with the rest of the pitch
    const a = this.anchor, id = this.gunId;
    const pistol = id === 'talon', knife = id === 'knife', nade = id === 'frag' || id === 'flash' || id === 'smoke';
    a.position.set(pistol ? 0.05 : 0.12, pistol ? 0.1 : 0.08, pistol ? -0.36 : -0.2 + this.kick * 0.04);
    a.rotation.set(pitch * 0.2 + this.kick * 0.08, 0, 0);
    let ru = st.reload;
    if (ru != null) { const w = Math.sin(Math.min(1, ru) * Math.PI); a.rotation.z = 0.5 * w; a.rotation.x -= 0.25 * w; } else a.rotation.z = 0;
    if (knife) { a.position.set(0.18, -0.05, -0.28); a.rotation.set(-0.3 + (st.knife != null ? Math.sin(st.knife * Math.PI) * 1.2 : 0), 0.4, 0); }
    if (nade && st.throw != null) { const w = st.throw; a.position.set(0.2, 0.25 - w * 0.2, 0.1 - w * 0.5); }
    B.chest.updateMatrixWorld(true);
    // arms by IK in chest space
    const gun = this.gun;
    const gp = gun ? gun.pts.grip : V(), fp = gun ? gun.pts.fore : V();
    const toChest = (p) => _v1.copy(p).applyMatrix4(a.matrix);
    const hr = toChest(gp).clone();
    let hl;
    if (knife || nade) hl = V(-0.15, -0.28, -0.12);
    else if (pistol) hl = toChest(V(gp.x - 0.02, gp.y - 0.01, gp.z + 0.01)).clone();
    else hl = toChest(V(fp.x, fp.y - 0.02, fp.z)).clone();
    if (ru != null && !pistol && !knife && gun && gun.parts.mag) { const w = Math.sin(Math.min(1, ru) * Math.PI); hl.lerp(V(0.0, -0.3, 0.05), w * 0.9); }
    this._armIK('R', hr, V(0.9, -1, 0.6));
    this._armIK('L', hl, V(-0.9, -1, 0.3));
  }
  _armIK(k, targetChest, pole) {
    const B = this.b, sh = B['sh' + k], el = B['el' + k];
    const S = sh.position, a = 0.29, b = 0.27;
    const d = _v2.copy(targetChest).sub(S); let L = d.length();
    L = clamp(L, 0.1, a + b - 0.002); d.normalize();
    const x = (a * a - b * b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, a * a - x * x));
    const p = _v3.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
    const elbow = V().copy(S).addScaledVector(d, x).addScaledVector(p, h);
    // upper arm: -y toward the elbow (chest space)
    sh.quaternion.setFromUnitVectors(DOWN, elbow.clone().sub(S).normalize());
    // forearm: -y toward the hand, expressed in upper-arm space
    const hand = targetChest.clone().sub(S).addScaledVector(elbow.clone().sub(S).normalize(), 0);
    const dirF = targetChest.clone().sub(elbow).normalize().applyQuaternion(_q1.copy(sh.quaternion).invert());
    el.quaternion.setFromUnitVectors(DOWN, dirF);
    // hand roughly aligned with the forearm, palm inward
    B['ha' + k].rotation.set(0, k === 'R' ? -0.6 : 0.6, 0);
  }
  // ---------------------------------------------------------------------------------- hitboxes
  hitboxes(frame) {
    if (this._hbFrame === frame && this._hb) return this._hb;
    this._hbFrame = frame;
    const B = this.b;
    this.group.updateMatrixWorld(true);
    const w = (bn, x, y, z) => V(x, y, z).applyMatrix4(bn.matrixWorld);
    const hb = this._hb = [
      { part: 'head', a: w(B.head, 0, 0.07, -0.005), b: w(B.head, 0, 0.14, -0.005), r: 0.115 },
      { part: 'chest', a: w(B.spine, 0, 0.16, 0), b: w(B.neck, 0, -0.04, 0), r: 0.175 },
      { part: 'stomach', a: w(B.hips, 0, -0.02, 0), b: w(B.spine, 0, 0.12, 0), r: 0.165 },
      { part: 'arm', a: w(B.shL, 0, 0, 0), b: w(B.elL, 0, 0, 0), r: 0.065 },
      { part: 'arm', a: w(B.elL, 0, 0, 0), b: w(B.haL, 0, -0.04, 0), r: 0.055 },
      { part: 'arm', a: w(B.shR, 0, 0, 0), b: w(B.elR, 0, 0, 0), r: 0.065 },
      { part: 'arm', a: w(B.elR, 0, 0, 0), b: w(B.haR, 0, -0.04, 0), r: 0.055 },
      { part: 'leg', a: w(B.thL, 0, 0, 0), b: w(B.knL, 0, 0, 0), r: 0.09 },
      { part: 'leg', a: w(B.knL, 0, 0, 0), b: w(B.ftL, 0, 0.02, 0), r: 0.07 },
      { part: 'leg', a: w(B.thR, 0, 0, 0), b: w(B.knR, 0, 0, 0), r: 0.09 },
      { part: 'leg', a: w(B.knR, 0, 0, 0), b: w(B.ftR, 0, 0.02, 0), r: 0.07 },
    ];
    // bounding sphere for a cheap reject
    let cx = 0, cy = 0, cz = 0;
    for (const h of hb) { cx += h.a.x + h.b.x; cy += h.a.y + h.b.y; cz += h.a.z + h.b.z; }
    const n = hb.length * 2; this._bc = V(cx / n, cy / n, cz / n);
    let r = 0; for (const h of hb) r = Math.max(r, this._bc.distanceTo(h.a) + h.r, this._bc.distanceTo(h.b) + h.r);
    this._br = r;
    return hb;
  }
  raycast(o, d, maxT, frame) {
    const hb = this.hitboxes(frame);
    // sphere reject
    const cx = this._bc.x - o.x, cy = this._bc.y - o.y, cz = this._bc.z - o.z;
    const tc = cx * d.x + cy * d.y + cz * d.z;
    const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
    if (d2 > this._br * this._br || tc < -this._br) return null;
    let best = null;
    for (const h of hb) {
      const t = rayCapsule(o, d, h.a, h.b, h.r);
      if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, part: h.part };
    }
    return best;
  }
  // ---------------------------------------------------------------------------------- ragdoll
  die(dir, part, force, vel) {
    const B = this.b;
    this.group.updateMatrixWorld(true);
    const wp = (bn, x = 0, y = 0, z = 0) => V(x, y, z).applyMatrix4(bn.matrixWorld);
    const P = [
      wp(B.head, 0, 0.1, 0), wp(B.neck), wp(B.hips),
      wp(B.shL), wp(B.elL), wp(B.haL), wp(B.shR), wp(B.elR), wp(B.haR),
      wp(B.thL), wp(B.knL), wp(B.ftL), wp(B.thR), wp(B.knR), wp(B.ftR),
    ];
    const prev = P.map((p) => p.clone().addScaledVector(vel, -1 / 60));
    // impulse at the hit region
    const hitIdx = { head: [0, 1], chest: [1, 3, 6], stomach: [2, 9, 12], arm: [4, 7], leg: [10, 13] }[part] || [1, 2];
    const kick = dir.clone().normalize().multiplyScalar(force / 60);
    for (let i = 0; i < P.length; i++) prev[i].addScaledVector(kick, hitIdx.includes(i) ? -1 : -0.35);
    const C = [];
    const link = (a, b) => C.push([a, b, P[a].distanceTo(P[b])]);
    [[0, 1], [1, 2], [1, 3], [1, 6], [3, 6], [9, 12], [2, 9], [2, 12], [3, 9], [6, 12], [3, 12], [6, 9], [0, 3], [0, 6],
      [3, 4], [4, 5], [6, 7], [7, 8], [9, 10], [10, 11], [12, 13], [13, 14], [1, 9], [1, 12]].forEach(([a, b]) => link(a, b));
    this.rag = { P, prev, C, t: 0, still: 0 };
    this.alive = false;
    // the gun leaves the hands: it falls and lies flat on the deck beside the body
    if (this.gun && this.gun.group.visible) {
      const g = this.gun.group;
      const wpos = new THREE.Vector3(), wq = new THREE.Quaternion();
      g.getWorldPosition(wpos); g.getWorldQuaternion(wq);
      this.dropped = { g, pos: wpos, vel: vel.clone().addScaledVector(dir.clone().normalize(), force * 0.25), yaw: Math.random() * 6.28, t: 0, q: wq };
      this.group.parent.attach(g);
    }
  }
  stepRagdoll(dt, coll) {
    const R = this.rag; if (!R) return;
    R.t += dt;
    const D = this.dropped;
    if (D && !D.rest) {
      D.vel.y -= 18 * dt; D.pos.addScaledVector(D.vel, dt);
      const gr = coll.groundAt(D.pos.x, D.pos.z, 0.05, D.pos.y - 3, D.pos.y + 0.3);
      const k = Math.min(1, D.t * 3); D.t += dt;
      const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, D.yaw, Math.PI / 2));
      D.g.quaternion.copy(D.q).slerp(flat, k);
      if (gr && D.pos.y < gr.y + 0.03) { D.pos.y = gr.y + 0.03; D.vel.set(0, 0, 0); if (k >= 1) D.rest = true; }
      D.g.position.copy(D.pos);
    }
    if (R.still > 1.5) return;
    const g = 18 * dt * dt;
    let motion = 0;
    for (let i = 0; i < R.P.length; i++) {
      const p = R.P[i], q = R.prev[i];
      const vx = (p.x - q.x) * 0.992, vy = (p.y - q.y) * 0.992, vz = (p.z - q.z) * 0.992;
      q.copy(p);
      p.x += vx; p.y += vy - g; p.z += vz;
      motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
    }
    for (let it = 0; it < 6; it++) {
      for (const [a, b, L] of R.C) {
        const A = R.P[a], Bp = R.P[b];
        _v1.subVectors(Bp, A); const d = _v1.length() || 1e-6; const k = (d - L) / d * 0.5;
        A.addScaledVector(_v1, k); Bp.addScaledVector(_v1, -k);
      }
      // world collision: floor + push out of solid boxes
      for (let i = 0; i < R.P.length; i++) {
        const p = R.P[i], rad = i === 0 ? 0.11 : i === 2 || i === 1 ? 0.13 : 0.06;
        const gr = coll.groundAt(p.x, p.z, 0.02, p.y - 2.5, p.y + rad + 0.25);
        if (gr && p.y < gr.y + rad) { p.y = gr.y + rad; const q = R.prev[i]; q.x = p.x - (p.x - q.x) * 0.6; q.z = p.z - (p.z - q.z) * 0.6; }
        const cand = coll.query(p.x - rad, p.z - rad, p.x + rad, p.z + rad, this._qq || (this._qq = []));
        for (const bx of cand) {
          if (!bx.solid || p.y < bx.y0 - rad || p.y > bx.y1 + rad) continue;
          if (!coll.overlapsCircle(bx, p.x, p.z, rad)) continue;
          if (p.y > bx.y1 - 0.15) { p.y = Math.max(p.y, bx.y1 + rad); continue; }
          if (coll._circle(bx, p.x, p.z, rad)) { p.x += coll._px; p.z += coll._pz; }
        }
      }
    }
    R.still = motion < 0.004 * R.P.length ? R.still + dt : 0;
    this._poseFromRag();
  }
  _poseFromRag() {
    const R = this.rag, B = this.b, P = R.P;
    this.group.updateMatrixWorld(true);
    const setWorld = (bn, pos, quat) => {
      bn.parent.updateMatrixWorld(true);
      _m.copy(bn.parent.matrixWorld).invert();
      const lp = pos.clone().applyMatrix4(_m);
      _q2.setFromRotationMatrix(bn.parent.matrixWorld).invert();
      bn.position.copy(lp); bn.quaternion.copy(_q2).multiply(quat);
      bn.updateMatrixWorld(true);
    };
    // torso frame from hips / neck / shoulders
    const up = _v1.subVectors(P[1], P[2]).normalize().clone();
    let rt = _v2.subVectors(P[12], P[9]).add(_v3.subVectors(P[6], P[3])).normalize().clone();
    rt.addScaledVector(up, -rt.dot(up)).normalize();
    const bk = V().crossVectors(rt, up);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(rt, up, bk));
    setWorld(B.hips, P[2], q);
    B.spine.quaternion.identity(); B.chest.quaternion.identity(); B.neck.quaternion.identity();
    B.spine.position.set(0, 0.1, 0); B.chest.position.set(0, 0.2, 0);
    B.hips.updateMatrixWorld(true);
    // head looks along the neck->head line
    const hq = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), _v3.subVectors(P[0], P[1]).normalize());
    setWorld(B.head, B.head.getWorldPosition(V()), hq);
    const limbTo = (bn, from, to) => {
      bn.parent.updateMatrixWorld(true);
      const dirW = _v3.subVectors(to, from).normalize();
      _q1.setFromRotationMatrix(bn.parent.matrixWorld).invert();
      const dl = dirW.clone().applyQuaternion(_q1);
      bn.quaternion.setFromUnitVectors(DOWN, dl);
      bn.updateMatrixWorld(true);
    };
    limbTo(B.shL, P[3], P[4]); limbTo(B.elL, P[4], P[5]);
    limbTo(B.shR, P[6], P[7]); limbTo(B.elR, P[7], P[8]);
    limbTo(B.thL, P[9], P[10]); limbTo(B.knL, P[10], P[11]);
    limbTo(B.thR, P[12], P[13]); limbTo(B.knR, P[13], P[14]);
  }
  reset() {
    this.rag = null; this.alive = true;
    if (this.dropped) { this.anchor.attach(this.dropped.g); this.dropped.g.position.set(0, 0, 0); this.dropped.g.quaternion.identity(); this.dropped = null; }
    const B = this.b;
    B.hips.position.set(0, 0.95, 0); B.hips.quaternion.identity();
    B.spine.position.set(0, 0.1, 0); B.chest.position.set(0, 0.2, 0); B.head.position.set(0, 0.07, 0);
    for (const k of ['L', 'R']) { B['sh' + k].quaternion.identity(); B['el' + k].quaternion.identity(); B['th' + k].quaternion.identity(); B['kn' + k].quaternion.identity(); }
  }
  // release this soldier's own geometry (merged per bone / per gun); shared materials stay
  dispose() {
    const seen = new Set();
    this.group.traverse((o) => { if (o.isMesh && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
    for (const g of Object.values(this.guns)) { g.group.traverse((o) => { if (o.isMesh && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } }); if (g.group.parent) g.group.parent.remove(g.group); }
  }
  // centre of mass in world space (death cam target)
  center(out = V()) { if (this.rag) return out.copy(this.rag.P[1]).lerp(this.rag.P[2], 0.5); return this.b.chest.getWorldPosition(out); }
}
