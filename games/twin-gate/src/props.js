// Carryable test blocks (plain and lens), holding/throwing through gates, fizzling, and clone meshes that
// draw the part of an object that is already through a gate. The player's avatar uses the same clone logic.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { G, LAYER_AVATAR } from './gfx.js';
import { phys } from './physics.js';
import { gates, linked, xfPoint, xfQuat, xfMatrix, castThrough, travellers, selfBodies } from './portals.js';
import { cubeFaces } from './textures.js';
import { player, CENTER_H } from './player.js';
import { buildDevice } from './viewmodel.js';

export const CUBE = 0.7;
export const GROUP = { world: 1, player: 2, prop: 4, held: 8 };
export const props = [];
export const hooks = { fizzle() {}, pickup() {}, drop() {}, impact() {} };

let GEO = null, TEX = null;
function assets() {
  if (GEO) return;
  GEO = new RoundedBoxGeometry(CUBE, CUBE, CUBE, 3, 0.07);
  TEX = { cube: cubeFaces('cube'), lens: cubeFaces('lens') };
}
const FAR = () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e5);
function cubeMats(kind) {
  const base = new THREE.MeshStandardMaterial({ map: TEX.cube.map, emissiveMap: TEX.cube.emissiveMap, emissive: 0x9ff7e4, emissiveIntensity: 1.4, metalness: 0.35, roughness: 0.48, clippingPlanes: [FAR()] });
  if (kind !== 'lens') return base;
  const lens = new THREE.MeshStandardMaterial({ map: TEX.lens.map, emissiveMap: TEX.lens.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.3, clippingPlanes: base.clippingPlanes });
  return [base, base, base, base, lens, base];
}
const matList = (m) => Array.isArray(m) ? [...new Set(m)] : [m];

// ---------------------------------------------------------------- straddling / clones
// Give any object a clone at the partner gate, and clip both copies at their gate planes.
// Returns an updater called each frame with the object's (visual) world centre and bounding radius.
export function makeCloner(obj, radius) {
  const clone = obj.clone(true); clone.visible = false; clone.matrixAutoUpdate = false;
  const mats = [], cmats = [];
  obj.traverse((o) => { if (o.material) { o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); for (const m of matList(o.material)) { m.clippingPlanes = [FAR()]; mats.push(m); } } });
  clone.traverse((o) => { if (o.material) { o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); for (const m of matList(o.material)) { m.clippingPlanes = [FAR()]; cmats.push(m); } } });
  G.scene.add(clone);
  const _c = new THREE.Vector3();
  return {
    clone, mats, cmats,
    update(center) {
      let s = -1;
      if (linked()) for (const g of gates) {
        const d = g.dist(center);
        if (d > -radius && d < radius && g.inHole(center, -radius)) { s = g.i; break; }
      }
      if (s < 0) { clone.visible = false; for (const m of mats) m.clippingPlanes[0].set(_c.set(0, 1, 0), 1e5); return; }
      const g = gates[s], o = gates[1 - s];
      for (const m of mats) m.clippingPlanes[0].copy(g.plane);
      for (const m of cmats) m.clippingPlanes[0].copy(o.plane);
      obj.updateMatrixWorld();
      clone.matrix.multiplyMatrices(xfMatrix(s), obj.matrixWorld); clone.matrixWorldNeedsUpdate = true;
      clone.visible = obj.visible;
    },
    dispose() { G.scene.remove(clone); },
  };
}

// ---------------------------------------------------------------- blocks
export function addCube(p, kind = 'cube', opts = {}) {
  assets();
  const body = new CANNON.Body({ mass: 22, material: phys.mat.prop, linearDamping: 0.02, angularDamping: 0.08,
    collisionFilterGroup: GROUP.prop, collisionFilterMask: GROUP.world | GROUP.player | GROUP.prop });
  body.addShape(new CANNON.Box(new CANNON.Vec3(CUBE / 2, CUBE / 2, CUBE / 2)));
  body.position.set(p[0], p[1], p[2]);
  if (opts.yaw) body.quaternion.setFromEuler(0, opts.yaw, 0);
  body.isProp = true; body.sleepSpeedLimit = 0.15; body.sleepTimeLimit = 0.6;
  phys.world.addBody(body);
  const mesh = new THREE.Mesh(GEO, cubeMats(kind)); mesh.castShadow = true; mesh.receiveShadow = true;
  G.scene.add(mesh);
  const pr = { kind, body, mesh, spawn: p.slice(), yaw: opts.yaw || 0, dropper: opts.dropper || null, held: false, fizzleT: 0, onButton: false, glow: 0,
    prev: new THREE.Vector3(), cur: new THREE.Vector3(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion(), dead: false };
  pr.cloner = makeCloner(mesh, CUBE * 0.87);
  pr.traveller = { body, prev: new CANNON.Vec3(), radius: CUBE / 2, prop: pr, onTeleport: () => { snapInterp(pr); } };
  travellers.add(pr.traveller);
  body.addEventListener('collide', (e) => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v > 1.5) hooks.impact(pr, v); });
  snapInterp(pr);
  props.push(pr);
  return pr;
}
function snapInterp(pr) {
  const b = pr.body; pr.cur.set(b.position.x, b.position.y, b.position.z); pr.prev.copy(pr.cur);
  pr.q1.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w); pr.q0.copy(pr.q1);
}
export function removeProp(pr) {
  if (hold.prop === pr) release();
  phys.world.removeBody(pr.body); G.scene.remove(pr.mesh); pr.cloner.dispose(); travellers.delete(pr.traveller);
  pr.dead = true; const i = props.indexOf(pr); if (i >= 0) props.splice(i, 1);
}
export function clearProps() { while (props.length) removeProp(props[0]); }

// Dissolve a block (grid, acid): it drifts up, flashes, and is gone; droppers make a new one.
export function fizzle(pr) {
  if (pr.fizzleT || pr.dead) return;
  if (hold.prop === pr) release();
  pr.fizzleT = 0.001; pr.body.type = CANNON.Body.KINEMATIC; pr.body.velocity.set(0, 0.4, 0); pr.body.angularVelocity.set(0.6, 1.2, 0.3);
  pr.body.collisionResponse = false;
  hooks.fizzle(pr);
}

// ---------------------------------------------------------------- ray targets
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _qi = new THREE.Quaternion();
export function rayProp(pr, o, d, maxT) {
  const b = pr.body; _qi.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w).invert();
  _o.set(o.x - b.position.x, o.y - b.position.y, o.z - b.position.z).applyQuaternion(_qi); _d.copy(d).applyQuaternion(_qi);
  const h = CUBE / 2; let t0 = -Infinity, t1 = Infinity, ax = -1, sg = 0;
  for (let a = 0; a < 3; a++) {
    const oa = _o.getComponent(a), da = _d.getComponent(a);
    if (Math.abs(da) < 1e-9) { if (oa < -h || oa > h) return null; continue; }
    let ta = (-h - oa) / da, tb = (h - oa) / da, s = -1; if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
    if (ta > t0) { t0 = ta; ax = a; sg = s; } if (tb < t1) t1 = tb; if (t0 > t1) return null;
  }
  if (t0 < 0 || t0 > maxT) return null;
  const n = new THREE.Vector3().setComponent(ax, sg).applyQuaternion(_qi.invert());
  return { t: t0, point: o.clone().addScaledVector(d, t0), normal: n, prop: pr, localAxis: ax, localSign: sg };
}
export const propTargets = (skip) => props.filter((p) => p !== skip && !p.fizzleT).map((pr) => ({ hit: (o, d, m) => rayProp(pr, o, d, m) }));

// ---------------------------------------------------------------- holding
export const hold = { prop: null, far: 0, dist: 1.55 };
export function tryPickup(eye, dir) {
  const segs = castThrough(eye, dir, 2.6, { targets: propTargets(), hops: 2 });
  const last = segs[segs.length - 1]; if (!last.hit || !last.hit.prop) return false;
  let len = 0; for (const s of segs) len += s.a.distanceTo(s.b); if (len > 2.6) return false;
  const pr = last.hit.prop; if (pr.fizzleT) return false;
  hold.prop = pr; pr.held = true; hold.far = 0;
  pr.body.collisionFilterGroup = GROUP.held; pr.body.collisionFilterMask = GROUP.world | GROUP.prop;
  pr.body.wakeUp(); pr.body.held = true;
  hooks.pickup(pr);
  return true;
}
export function release(throwDir) {
  const pr = hold.prop; if (!pr) return;
  pr.held = false; pr.body.held = false; hold.prop = null;
  pr.body.collisionFilterGroup = GROUP.prop; pr.body.collisionFilterMask = GROUP.world | GROUP.player | GROUP.prop;
  const v = pr.body.velocity;
  if (throwDir) { v.set(throwDir.x * 9 + player.body.velocity.x, throwDir.y * 9 + player.body.velocity.y + 1, throwDir.z * 9 + player.body.velocity.z); }
  else { const pv = player.body.velocity; v.set(pv.x + (v.x - pv.x) * 0.3, Math.min(v.y, 2), pv.z + (v.z - pv.z) * 0.3); pr.body.angularVelocity.set(0, 0, 0); }
  hooks.drop(pr, !!throwDir);
}

// Drive the held block toward a point in front of the view (followed through gates). Called each physics step.
const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _cand = new THREE.Vector3(), _dq = new THREE.Quaternion(), _qq = new THREE.Quaternion();
const _ax = new THREE.Vector3(), _yq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
export function holdStep(dt, eye, dir, yaw) {
  const pr = hold.prop; if (!pr) return;
  const b = pr.body;
  const segs = castThrough(eye, dir, hold.dist, { hops: 2 });
  const last = segs[segs.length - 1];
  _t.copy(last.b); if (last.hit) _t.addScaledVector(dir, 0); // gate-transformed dir handled below
  if (last.hit) { const back = last.a.clone().sub(last.b).normalize(); _t.addScaledVector(back, CUBE * 0.62); }
  // candidate targets expressed in each space the block might be in (before each gate hop)
  _p.set(b.position.x, b.position.y, b.position.z);
  let best = _t.clone(), bd = _p.distanceToSquared(_t);
  // a held Lens Block settles on the nearest 45° heading when you look within 10° of it; a beam crossing a room to a
  // catcher otherwise needs sub-degree aim (1.5° off missed Refraction's). Outside that window it turns freely.
  if (pr.kind === 'lens') { const s = Math.round(yaw / (Math.PI / 4)) * (Math.PI / 4); if (Math.abs(yaw - s) < 10 * Math.PI / 180) yaw = s; }
  let yawQ = _yq.setFromAxisAngle(_up, yaw);
  // map the target back through the hops so a block still on the near side heads into the entry gate
  let tgt = _t.clone();
  for (let k = segs.length - 2; k >= 0; k--) {
    const gi = segs[k].gate; if (gi === undefined) continue;
    tgt = xfPoint(1 - gi, tgt); // partner maps back
    const dd = _p.distanceToSquared(tgt); if (dd < bd) { bd = dd; best = tgt.clone(); }
  }
  // target orientation: upright, facing away from the viewer (so a lens points where you look)
  let q = yawQ.clone();
  if (best !== _t && bd < _p.distanceToSquared(_t)) { /* near side: keep yaw */ } else {
    for (const s of segs) if (s.gate !== undefined) q = xfQuat(s.gate, q);
  }
  const dx = best.x - _p.x, dy = best.y - _p.y, dz = best.z - _p.z, dist = Math.hypot(dx, dy, dz);
  const k = 16, maxV = 14; let vx = dx * k, vy = dy * k, vz = dz * k; const vl = Math.hypot(vx, vy, vz);
  if (vl > maxV) { vx *= maxV / vl; vy *= maxV / vl; vz *= maxV / vl; }
  b.velocity.set(b.velocity.x + (vx - b.velocity.x) * 0.5, b.velocity.y + (vy - b.velocity.y) * 0.5 + 15 * dt * 0.5, b.velocity.z + (vz - b.velocity.z) * 0.5);
  _qq.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  _dq.copy(q).multiply(_qq.invert());
  if (_dq.w < 0) { _dq.x *= -1; _dq.y *= -1; _dq.z *= -1; _dq.w *= -1; }
  const ang = 2 * Math.acos(Math.min(1, _dq.w)); _ax.set(_dq.x, _dq.y, _dq.z);
  if (_ax.lengthSq() > 1e-10) _ax.normalize().multiplyScalar(Math.min(ang * 18, 22)); else _ax.set(0, 0, 0);
  b.angularVelocity.set(_ax.x, _ax.y, _ax.z);
  hold.far = dist > 1.6 ? hold.far + dt : 0;
  if (hold.far > 0.35) release();
}

// ---------------------------------------------------------------- per frame
const _ic = new THREE.Vector3();
export function updateProps(dt, alpha) {
  for (let i = props.length - 1; i >= 0; i--) {
    const pr = props[i], b = pr.body;
    if (pr.fizzleT) {
      pr.fizzleT += dt;
      b.position.y += 0.4 * dt; b.quaternion.integrate(b.angularVelocity, dt, b.angularVelocity, b.quaternion);
      const k = Math.min(1, pr.fizzleT / 1.1);
      for (const m of pr.cloner.mats) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 1.4 + k * 6; m.transparent = true; m.opacity = 1 - k; }
      pr.mesh.scale.setScalar(1 - k * 0.25);
      if (k >= 1) { removeProp(pr); continue; }
    }
    pr.mesh.position.copy(_ic.copy(pr.prev).lerp(pr.cur, alpha));
    pr.mesh.quaternion.copy(pr.q0).slerp(pr.q1, alpha);
    // button glow: jade idle, warm when it is doing a job
    pr.glow += ((pr.onButton ? 1 : 0) - pr.glow) * Math.min(1, dt * 6);
    if (!pr.fizzleT) for (const m of pr.cloner.mats) if (m.map === TEX.cube.map) m.emissive.setRGB(0.62 + 0.38 * pr.glow, 0.97 - 0.55 * pr.glow, 0.89 - 0.7 * pr.glow);
    pr.cloner.update(pr.mesh.position);
  }
}
export function propsPostStep() {
  for (const pr of props) {
    const b = pr.body; pr.prev.copy(pr.cur); pr.cur.set(b.position.x, b.position.y, b.position.z);
    pr.q0.copy(pr.q1); pr.q1.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    if (b.position.y < -60 && !pr.fizzleT) fizzle(pr);
  }
}

// ---------------------------------------------------------------- avatar: the player's body, seen through gates
export const avatar = { root: null, cloner: null };
export function buildAvatar() {
  const root = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xe9ecea, roughness: 0.6, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22272b, roughness: 0.4, metalness: 0.4 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x0d3b33, emissive: 0x2fe6c0, emissiveIntensity: 0.8 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 6, 14), suit); torso.position.y = 0.25;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.06, 20), stripe); belt.position.y = 0.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), suit); head.position.y = 0.72;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 12, -0.9, 1.8, 0.9, 0.8), dark); visor.position.set(0, 0.73, -0.035); visor.rotation.y = Math.PI;
  const legs = [-0.11, 0.11].map((x) => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 4, 10), suit); l.position.set(x, -0.5, 0); return l; });
  const boots = [-0.11, 0.11].map((x) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.26), dark); l.position.set(x, -0.84, -0.04); return l; });
  // arms as capsules between joints (rounded ends overlap, so shoulders, elbows and wrists have no gaps),
  // holding the same device as the first-person view: right hand on the grip, left hand under the barrels
  const limb = (a, b, r, m) => {
    const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), L = d.length();
    const o = new THREE.Mesh(new THREE.CapsuleGeometry(r, L, 4, 10), m);
    o.position.copy(A).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return o;
  };
  const glove = (p) => { const o = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), dark); o.position.set(...p); o.scale.set(1, 0.85, 1.25); return o; };
  const R = [[0.25, 0.44, 0], [0.28, 0.17, -0.1], [0.13, 0.2, -0.35]], Lf = [[-0.25, 0.44, 0], [-0.24, 0.15, -0.2], [0.05, 0.23, -0.55]];
  const arms = [limb(R[0], R[1], 0.068, suit), limb(R[1], R[2], 0.056, suit), glove(R[2]), limb(Lf[0], Lf[1], 0.068, suit), limb(Lf[1], Lf[2], 0.056, suit), glove(Lf[2])];
  const dev = buildDevice().rig; dev.position.set(0.13, 0.36, -0.47); // grip (0, -0.16, 0.12) lands in the right glove
  root.add(torso, belt, head, visor, ...legs, ...boots, ...arms, dev);
  root.traverse((o) => { o.layers.set(LAYER_AVATAR); if (o.isMesh) o.castShadow = false; });
  G.scene.add(root);
  avatar.root = root; avatar.cloner = makeCloner(root, 1.0);
  selfBodies.push(root, avatar.cloner.clone);
  avatar.cloner.clone.traverse((o) => o.layers.set(LAYER_AVATAR));
}
const _aq = new THREE.Quaternion(), _up2 = new THREE.Vector3(0, 1, 0);
export function updateAvatar(alpha) {
  if (!avatar.root) return;
  const r = avatar.root;
  r.position.copy(player.prev).lerp(player.cur, alpha);
  _aq.setFromUnitVectors(_up2, player.up);
  r.quaternion.setFromAxisAngle(_up2, player.yaw).premultiply(_aq);
  r.visible = player.alive;
  avatar.cloner.update(r.position);
}
