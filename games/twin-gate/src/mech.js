// Chamber mechanisms: signal wiring, floor buttons, pedestal switches, sliding doors, moving platforms, block
// droppers, emancipation grids, hazard liquid, aerial faith plates, indicator wires, triggers and the goal.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G, LAYER_FX } from './gfx.js';
import { phys, GRAVITY } from './physics.js';
import { rayBox } from './world.js';
import { gates, closeGate, blockers, linked } from './portals.js';
import { player, CENTER_H } from './player.js';
import { props, addCube, fizzle, hold, release, CUBE, GROUP } from './props.js';
import { hazardStripe } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const sig = new Map();          // signal id -> boolean
export const ents = [];                // live entities
export const rayBoxes = [];            // moving solids for gate/laser rays: { rec, tag }
export const ev = { say() {}, sfx() {}, die() {}, goal() {}, checkpoint() {}, fx() {}, burn() {} };
export const hazards = [];             // acid volumes (read by gel/props)
export const grids = [];
export const root = { group: null, bodies: [] };
export function addBody(b) { phys.world.addBody(b); root.bodies.push(b); return b; }

const M = {};
function mats() {
  if (M.white) return M;
  M.white = new THREE.MeshStandardMaterial({ color: 0xe9ecea, roughness: 0.45, metalness: 0.05 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x2b3034, roughness: 0.45, metalness: 0.6 });
  M.darker = new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: 0.6, metalness: 0.4 });
  M.hazard = new THREE.MeshStandardMaterial({ map: hazardStripe(), roughness: 0.6 });
  M.off = () => new THREE.MeshStandardMaterial({ color: 0x1a2328, emissive: 0x6b8796, emissiveIntensity: 0.6, roughness: 0.4 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ef, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.09, depthWrite: false }); // faint: denser glass reads as haze
  return M;
}
const ON = new THREE.Color(0xffae2e), OFF = new THREE.Color(0x6b8796);
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------------------------------------------------------------- signals
// in: 'id' | ['a','b'] (all) | { any: [...] } | { not: x } | undefined (always on)
export function evalIn(x) {
  if (x === undefined || x === null) return true;
  if (typeof x === 'string') return !!sig.get(x);
  if (Array.isArray(x)) return x.every(evalIn);
  if (x.any) return x.any.some(evalIn);
  if (x.not !== undefined) return !evalIn(x.not);
  return false;
}

function addStatic(rec, group = G.scene) { // helper: static cannon box from a record {c,h,q}
  const b = new CANNON.Body({ type: CANNON.Body.STATIC, material: phys.mat.world, collisionFilterGroup: GROUP.world });
  b.addShape(new CANNON.Box(new CANNON.Vec3(rec.h.x, rec.h.y, rec.h.z)));
  b.position.set(rec.c.x, rec.c.y, rec.c.z); b.quaternion.set(rec.q.x, rec.q.y, rec.q.z, rec.q.w);
  return addBody(b);
}
export function boxRec(c, h, q = new THREE.Quaternion()) {
  return { aabb: false, c: c.clone(), h: h.clone(), q: q.clone(), qi: q.clone().invert(), min: new THREE.Vector3(), max: new THREE.Vector3() };
}
export function mesh(geo, mat, parent) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; (parent || root.group).add(m); return m; }

// ---------------------------------------------------------------- entity builders
const B = {};

B.cube = (e) => { const pr = addCube(e.p, e.kind, { yaw: e.yaw }); return { e, pr, update() {} }; };

// Ceiling tube that drops a block, and replaces it when it is destroyed.
B.dropper = (e) => {
  const p = V3(e.p), grp = new THREE.Group(); grp.position.copy(p); root.group.add(grp);
  const tube = mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.2, 24, 1, true), M.glass, grp); tube.position.y = 1.5; tube.castShadow = false;
  const ring = mesh(new THREE.TorusGeometry(0.64, 0.07, 8, 28), M.dark, grp); ring.rotation.x = Math.PI / 2; ring.position.y = 0.42;
  const ring2 = ring.clone(); ring2.position.y = 2.6; grp.add(ring2);
  // hatch: two closed half-disc leaves that fit the round tube (square leaves poked their corners out past the ring)
  const half = new THREE.Shape().moveTo(0, -0.64).absarc(0, 0, 0.64, -Math.PI / 2, Math.PI / 2, false).lineTo(0, -0.64);
  const leaf = new THREE.ExtrudeGeometry(half, { depth: 0.05, bevelEnabled: false, curveSegments: 12 }).rotateX(-Math.PI / 2).translate(0, -0.025, 0);
  const hatchR = mesh(leaf, M.dark, grp), hatchL = mesh(leaf, M.dark, grp); hatchL.rotation.y = Math.PI;
  hatchL.position.y = hatchR.position.y = 0.42;
  const o = { e, grp, pr: null, t: 0, open: 0, wasIn: false, pending: 0, first: true,
    update(dt) {
      const want = evalIn(e.in), alive = this.pr && !this.pr.dead && !this.pr.fizzleT;
      if (e.in !== undefined) { if (want && !this.wasIn && this.pending <= 0) { if (alive) fizzle(this.pr); this.pending = alive ? 1.2 : 0.35; } }
      else if (!alive && this.pending <= 0) this.pending = this.first ? 0.05 : 1.0;
      this.wasIn = want;
      if (this.pending > 0) {
        this.pending -= dt; this.open = 1;
        if (this.pending <= 0) { this.first = false; this.pr = addCube([p.x, p.y + 0.9, p.z], e.kind || 'cube', { yaw: e.yaw || 0 }); this.pr.dropper = this; this.pr.body.velocity.set(0, -2, 0); this.t = 0.8; ev.sfx('dropper', p); }
      }
      if (this.t > 0) this.t -= dt; else if (this.pending <= 0) this.open = 0;
      this.k = (this.k || 0) + ((this.open ? 1 : 0) - (this.k || 0)) * Math.min(1, dt * 10);
      hatchL.position.x = -this.k * 0.55; hatchR.position.x = this.k * 0.55;
    } };
  return o;
};

// Floor button: pressed by the player's weight or a block.
B.button = (e) => {
  const p = V3(e.p), grp = new THREE.Group(); grp.position.copy(p); root.group.add(grp);
  const base = mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.14, 32), M.dark, grp); base.position.y = 0.07;
  const ringM = M.off(); const ring = mesh(new THREE.TorusGeometry(0.8, 0.045, 8, 40), ringM, grp); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; ring.layers.enable(LAYER_FX);
  const padM = new THREE.MeshStandardMaterial({ color: 0xc9392a, roughness: 0.35, metalness: 0.1, emissive: 0x2a0500, emissiveIntensity: 1 });
  const pad = mesh(new THREE.CylinderGeometry(0.7, 0.74, 0.12, 32), padM, grp); pad.position.y = 0.18;
  const rec = boxRec(p.clone().add(new THREE.Vector3(0, 0.07, 0)), new THREE.Vector3(0.95, 0.07, 0.95));
  const body = addStatic(rec);
  blockers.push({ min: p.clone().add(new THREE.Vector3(-1.05, -0.2, -1.05)), max: p.clone().add(new THREE.Vector3(1.05, 0.3, 1.05)) });
  return { e, grp, body, down: 0, on: false, update(dt) {
    let on = false;
    const pb = player.body.position, feet = pb.y - CENTER_H;
    if (player.alive && Math.hypot(pb.x - p.x, pb.z - p.z) < 0.95 && feet > p.y - 0.15 && feet < p.y + 0.45) on = true;
    for (const pr of props) {
      const q = pr.body.position;
      if (!pr.fizzleT && !pr.held && Math.hypot(q.x - p.x, q.z - p.z) < 0.85 && q.y > p.y && q.y < p.y + 0.9) { on = true; pr.onButton = true; }
    }
    if (on !== this.on) { ev.sfx(on ? 'btnDown' : 'btnUp', p); this.on = on; }
    if (e.id) sig.set(e.id, on);
    this.down += ((on ? 1 : 0) - this.down) * Math.min(1, dt * 14);
    pad.position.y = 0.18 - this.down * 0.07;
    padM.emissive.setRGB(0.16 + this.down * 0.6, 0.02 + this.down * 0.2, 0);
    ringM.emissive.copy(OFF).lerp(ON, this.down); ringM.emissiveIntensity = 0.6 + this.down * 1.0;
  } };
};

// Pedestal switch: press E; stays on for e.time seconds (or toggles when time is 0).
B.pedestal = (e) => {
  const p = V3(e.p), grp = new THREE.Group(); grp.position.copy(p); grp.rotation.y = e.yaw || 0; root.group.add(grp);
  mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.0, 16), M.white, grp).position.y = 0.5;
  const headM = M.off(); const head = mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.12, 20), headM, grp); head.position.y = 1.06; head.rotation.x = -0.35;
  const rec = boxRec(p.clone().add(new THREE.Vector3(0, 0.55, 0)), new THREE.Vector3(0.22, 0.55, 0.22));
  const body = addStatic(rec);
  const o = { e, grp, rec, on: false, t: 0, usable: true, use() {
    if (e.time) { this.t = e.time; } else this.on = !this.on;
    ev.sfx('pedestal', p); return true;
  }, update(dt) {
    if (e.time) { const was = this.t > 0; this.t = Math.max(0, this.t - dt); this.on = this.t > 0; if (this.on) { this.tick = (this.tick || 0) - dt; if (this.tick <= 0) { this.tick = 0.5; ev.sfx('tick', p); } } if (was && !this.on) ev.sfx('pedestalOff', p); }
    if (e.id) sig.set(e.id, this.on);
    headM.emissive.copy(this.on ? ON : OFF); headM.emissiveIntensity = this.on ? 1.5 : 0.7;
  } };
  return o;
};

// Sliding double doors. p = bottom centre, axis = 'x' (panels slide along x) or 'z'.
B.door = (e) => {
  const p = V3(e.p), w = e.w || 2.4, h = e.h || 3, ax = e.axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const th = 0.24, halfs = [];
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), ax);
  const lightM = M.off();
  for (const s of [-1, 1]) {
    const grp = new THREE.Group(); root.group.add(grp); grp.quaternion.copy(q);
    const slab = mesh(new THREE.BoxGeometry(w / 2, h, th), M.white, grp);
    const edge = mesh(new THREE.BoxGeometry(0.06, h - 0.2, th + 0.02), lightM, grp); edge.position.x = -s * (w / 4 - 0.04); // 1 cm in from the seam: flush, its face would fight the slab's edge.layers.enable(LAYER_FX);
    const band = mesh(new THREE.BoxGeometry(w / 2 - 0.1, 0.12, th + 0.03), M.dark, grp); band.position.y = -h / 2 + 0.5;
    const rec = boxRec(new THREE.Vector3(), new THREE.Vector3(w / 4, h / 2, th / 2), q);
    const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: phys.mat.world, collisionFilterGroup: GROUP.world });
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 4, h / 2, th / 2))); body.quaternion.set(q.x, q.y, q.z, q.w);
    addBody(body);
    halfs.push({ s, grp, rec, body });
    rayBoxes.push({ rec, tag: 'door' });
  }
  const o = { e, halfs, open: e.startOpen ? 1 : 0, on: !!e.startOpen, update() {
    for (const hf of halfs) hf.grp.position.set(hf.body.position.x, hf.body.position.y, hf.body.position.z);
    lightM.emissive.copy(OFF).lerp(ON, this.open); lightM.emissiveIntensity = 0.6 + this.open * 1.0;
  }, step(dt) {
    const want = evalIn(e.in) && !this.locked;
    if (want !== this.on) { this.on = want; ev.sfx(want ? 'doorOpen' : 'doorClose', p); }
    const prev = this.open;
    this.open += Math.sign((want ? 1 : 0) - this.open) * Math.min(Math.abs((want ? 1 : 0) - this.open), 1.6 * dt);
    for (const hf of halfs) {
      // open travel stops 8 cm short of the jamb, so no leaf face ends up in the jamb's plane
      const at = (k) => { const c = p.clone().addScaledVector(ax, hf.s * (w / 4 + k * (w / 2 - 0.08))); c.y += h / 2; return c; };
      const c0 = at(prev), c1 = at(this.open);
      hf.body.position.set(c0.x, c0.y, c0.z);
      hf.body.velocity.set((c1.x - c0.x) / dt, 0, (c1.z - c0.z) / dt);
      hf.rec.c.copy(c1);
      hf.body.collisionResponse = this.open < 0.97;
    }
  } };
  o.step(1 / 120); o.update();
  return o;
};

// Moving platform: kinematic slab between p0 and p1. With `in`, it rests at p0 and travels to p1 while on.
B.platform = (e) => {
  const p0 = V3(e.p0), p1 = V3(e.p1), size = V3(e.size || [3, 0.4, 3]);
  const grp = new THREE.Group(); root.group.add(grp);
  mesh(new THREE.BoxGeometry(size.x, size.y, size.z), M.white, grp);
  const rim = mesh(new THREE.BoxGeometry(size.x + 0.08, 0.08, size.z + 0.08), M.dark, grp); rim.position.y = -size.y / 2 + 0.05; // underside 1 cm above the slab's, not in its plane
  const lampM = M.off(); const lamp = mesh(new THREE.BoxGeometry(size.x * 0.6, 0.04, 0.12), lampM, grp); lamp.position.set(0, -size.y / 2 - 0.02, 0); lamp.layers.enable(LAYER_FX);
  const h = size.clone().multiplyScalar(0.5), rec = boxRec(p0, h);
  const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: phys.mat.world, collisionFilterGroup: GROUP.world });
  body.addShape(new CANNON.Box(new CANNON.Vec3(h.x, h.y, h.z))); addBody(body);
  rayBoxes.push({ rec, tag: 'platform' });
  const len = p0.distanceTo(p1), speed = e.speed || 2;
  const o = { e, grp, body, rec, s: e.phase || 0, dir: 1, wait: 0, pos: p0.clone(), update() {}, step(dt) {
    let target;
    if (e.in !== undefined) target = evalIn(e.in) ? 1 : 0;
    else if (this.wait > 0) { this.wait -= dt; target = this.s; }
    else { target = this.dir > 0 ? 1 : 0; if (this.s === target) { this.dir = -this.dir; this.wait = e.pause ?? 1.2; } }
    const prev = this.s;
    this.s += Math.sign(target - this.s) * Math.min(Math.abs(target - this.s), speed / len * dt);
    const k = this.s < 0.5 ? 2 * this.s * this.s : 1 - Math.pow(-2 * this.s + 2, 2) / 2; // ease in-out
    const np = p0.clone().lerp(p1, k);
    const v = np.clone().sub(this.pos).multiplyScalar(1 / dt);
    body.velocity.set(v.x, v.y, v.z); body.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.pos.copy(np);
    lampM.emissive.copy(Math.abs(this.s - prev) > 1e-6 ? ON : OFF);
  }, frame() { grp.position.set(this.body.position.x, this.body.position.y, this.body.position.z); rec.c.copy(grp.position); } };
  o.pos.copy(p0.clone().lerp(p1, o.s)); body.position.set(o.pos.x, o.pos.y, o.pos.z);
  return o;
};

// Emancipation grid: a shimmering plane. Fizzles blocks, closes the player's gates, blocks gate shots.
const gridMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uOn: { value: 1 }, uSize: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime, uOn; uniform vec2 uSize; varying vec2 vUv;
  void main(){ vec2 p = vUv * uSize;
    float lines = pow(abs(sin(p.x * 3.1 + sin(p.y * 1.3 + uTime * 1.7) * 0.6 + uTime * 0.6)), 24.0) * 0.7;
    float scan = smoothstep(0.1, 0.0, abs(fract(p.y * 0.25 - uTime * 0.35) - 0.5)) * 0.35;
    float edge = smoothstep(0.08, 0.0, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)) * min(uSize.x, uSize.y)) * 0.6;
    float a = (0.07 + lines + scan + edge) * uOn;
    gl_FragColor = vec4(vec3(0.55, 0.78, 1.0) * (1.2 + lines * 2.0) * a, a); }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
});
B.grid = (e) => {
  const mn = V3(e.min), mx = V3(e.max), size = mx.clone().sub(mn);
  const thin = size.x < size.z ? 'x' : 'z';
  const w = thin === 'x' ? size.z : size.x, hgt = size.y;
  const mat = gridMat(); mat.uniforms.uSize.value.set(w, hgt);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), mat); m.layers.set(LAYER_FX); m.renderOrder = 6;
  m.position.copy(mn).add(mx).multiplyScalar(0.5); if (thin === 'x') m.rotation.y = Math.PI / 2; root.group.add(m);
  // emitter strips on both sides
  for (const s of [-1, 1]) {
    const strip = mesh(new THREE.BoxGeometry(0.16, hgt, 0.16), M.dark);
    strip.position.copy(m.position); if (thin === 'x') strip.position.z += s * (w / 2 + 0.02); else strip.position.x += s * (w / 2 + 0.02);
  }
  const o = { e, m, mat, mn, mx, thin, on: true, side: new Map(), update(dt, _s, t) {
    this.on = evalIn(e.in); mat.uniforms.uTime.value = t; mat.uniforms.uOn.value += ((this.on ? 1 : 0) - mat.uniforms.uOn.value) * Math.min(1, dt * 8);
  }, contains(p, pad = 0) { return p.x > mn.x - pad && p.x < mx.x + pad && p.y > mn.y - pad && p.y < mx.y + pad && p.z > mn.z - pad && p.z < mx.z + pad; },
  // crossing test: which side of the grid plane is a point on
  sideOf(p) { const c = thin === 'x' ? (mn.x + mx.x) / 2 : (mn.z + mx.z) / 2; return Math.sign((thin === 'x' ? p.x : p.z) - c); },
  inSpan(p, pad) { return thin === 'x' ? (p.z > mn.z - pad && p.z < mx.z + pad && p.y > mn.y - pad && p.y < mx.y + pad) : (p.x > mn.x - pad && p.x < mx.x + pad && p.y > mn.y - pad && p.y < mx.y + pad); },
  step() {
    if (!this.on) { this.side.clear(); return; }
    const test = (key, p, pad, fn) => {
      const sd = this.sideOf(p), was = this.side.get(key);
      if (was && was.s !== sd && this.inSpan(p, pad) && Math.hypot(p.x - was.x, p.y - was.y, p.z - was.z) < 1.5) fn();
      this.side.set(key, { s: sd, x: p.x, y: p.y, z: p.z });
    };
    const pb = player.body.position;
    test('player', pb, 0.2, () => {
      let any = false;
      for (const g of gates) if (g.open && !g.fixed) { closeGate(g.i); any = true; }
      if (hold.prop) { fizzle(hold.prop); any = true; }
      ev.sfx('gridPass', pb); if (any) ev.say('gridFizzle');
    });
    for (const pr of props) test(pr, pr.body.position, 0.1, () => fizzle(pr));
  } };
  grids.push(o);
  return o;
};

// Hazard liquid ("caustic ink"). Optional rise: { to, speed, in }.
const acidMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float uTime; varying vec3 vW;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  void main(){ vec2 p = vW.xz * 0.6;
    float a = n(p + vec2(uTime * 0.25, uTime * 0.1)) * 0.6 + n(p * 2.7 - vec2(uTime * 0.4, -uTime * 0.2)) * 0.4;
    float caust = pow(n(p * 4.0 + a * 2.0 + uTime * 0.5), 6.0);
    vec3 deep = vec3(0.10, 0.13, 0.02), mid = vec3(0.34, 0.45, 0.04), hot = vec3(0.85, 1.0, 0.25);
    vec3 c = mix(deep, mid, a) + hot * caust * 1.6;
    gl_FragColor = vec4(c, 1.0); }`,
});
B.acid = (e) => {
  const mn = V3(e.min), mx = V3(e.max), size = mx.clone().sub(mn);
  const mat = acidMat(); const m = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.z, 1, 1), mat);
  m.rotation.x = -Math.PI / 2; m.position.set((mn.x + mx.x) / 2, mx.y, (mn.z + mx.z) / 2); root.group.add(m);
  const o = { e, m, mat, mn, mx, level: mx.y, update(dt, _s, t) {
    mat.uniforms.uTime.value = t;
    if (e.rise && evalIn(e.rise.in)) this.level = Math.min(e.rise.to, this.level + e.rise.speed * dt);
    m.position.y = this.level;
    this.bub = (this.bub || 0) - dt; if (this.bub <= 0) { this.bub = 0.25; ev.fx('bubble', new THREE.Vector3(mn.x + Math.random() * size.x, this.level, mn.z + Math.random() * size.z)); }
  }, step() {
    const pb = player.body.position;
    if (player.alive && pb.x > mn.x && pb.x < mx.x && pb.z > mn.z && pb.z < mx.z && pb.y - CENTER_H < this.level - 0.12 && pb.y > mn.y - 3) ev.die('acid');
    for (const pr of props) { const q = pr.body.position; if (!pr.fizzleT && q.x > mn.x && q.x < mx.x && q.z > mn.z && q.z < mx.z && q.y < this.level + 0.1 && q.y > mn.y - 3) fizzle(pr); }
  } };
  hazards.push(o);
  return o;
};

// Aerial faith plate: launches bodies on it toward `target` with the given apex height.
B.plate = (e) => {
  const p = V3(e.p), tgt = V3(e.target), grp = new THREE.Group(); grp.position.copy(p); root.group.add(grp);
  const dir = tgt.clone().sub(p); dir.y = 0; const yaw = Math.atan2(dir.x, dir.z); grp.rotation.y = yaw;
  mesh(new THREE.BoxGeometry(1.8, 0.12, 1.8), M.dark, grp).position.y = 0.06;
  const hinge = new THREE.Group(); hinge.position.set(0, 0.13, -0.85); grp.add(hinge);
  const plate = mesh(new THREE.BoxGeometry(1.5, 0.08, 1.5), M.white, hinge); plate.position.set(0, 0.04, 0.8);
  const arrowM = M.off(); const arrow = mesh(new THREE.ConeGeometry(0.25, 0.5, 3), arrowM, hinge); arrow.rotation.x = Math.PI / 2; arrow.position.set(0, 0.1, 1.0); arrow.scale.y = 0.4; arrow.layers.enable(LAYER_FX);
  const rec = boxRec(p.clone().add(new THREE.Vector3(0, 0.06, 0)), new THREE.Vector3(0.9, 0.06, 0.9)); addStatic(rec);
  blockers.push({ min: p.clone().add(new THREE.Vector3(-1, -0.2, -1)), max: p.clone().add(new THREE.Vector3(1, 0.4, 1)) });
  const apex = Math.max(tgt.y, p.y) + (e.apex ?? 3);
  const launch = (from) => {
    const vy = Math.sqrt(2 * GRAVITY * Math.max(0.1, apex - from.y));
    const tUp = vy / GRAVITY, tDown = Math.sqrt(2 * Math.max(0.05, apex - tgt.y) / GRAVITY), T = tUp + tDown;
    return new THREE.Vector3((tgt.x - from.x) / T, vy, (tgt.z - from.z) / T);
  };
  const o = { e, flip: 0, cool: 0, on: true, update(dt) {
    this.on = evalIn(e.in);
    this.flip = Math.max(0, this.flip - dt * 3); hinge.rotation.x = -Math.sin(Math.min(1, this.flip) * Math.PI) * 0.9;
    arrowM.emissive.copy(this.on ? ON : OFF); arrowM.emissiveIntensity = this.on ? 1.5 : 0.5;
  }, step(dt) {
    this.cool = Math.max(0, this.cool - dt); if (!this.on || this.cool > 0) return;
    const pb = player.body.position; let fired = false;
    if (player.alive && Math.abs(pb.x - p.x) < 0.9 && Math.abs(pb.z - p.z) < 0.9 && pb.y - CENTER_H > p.y - 0.1 && pb.y - CENTER_H < p.y + 0.5) {
      const v = launch(new THREE.Vector3(pb.x, pb.y - CENTER_H + 0.13, pb.z)); player.body.velocity.set(v.x, v.y, v.z); player.grounded = false; player.noAir = true; fired = true;
    }
    for (const pr of props) { const q = pr.body.position; if (!pr.held && !pr.fizzleT && Math.abs(q.x - p.x) < 0.9 && Math.abs(q.z - p.z) < 0.9 && q.y > p.y && q.y < p.y + 0.8) { const v = launch(new THREE.Vector3(q.x, q.y - CUBE / 2, q.z)); pr.body.velocity.set(v.x, v.y, v.z); pr.body.wakeUp(); fired = true; } }
    if (fired) { this.flip = 1.0001; this.cool = 0.9; ev.sfx('plate', p); ev.fx('plate', p); }
  }, arc(n = 40) { // for diagrams/tests: predicted path from the plate
    const v = launch(p.clone().add(new THREE.Vector3(0, 0.13, 0))), pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n * (v.y / GRAVITY + Math.sqrt(2 * Math.max(0.05, apex - tgt.y) / GRAVITY)); pts.push([p.x + v.x * t, p.y + 0.13 + v.y * t - GRAVITY * t * t / 2, p.z + v.z * t]); }
    return pts;
  } };
  return o;
};

// Indicator wire: a dotted light trail from a switch to what it drives.
B.wire = (e) => {
  const pts = e.path.map(V3), n = V3(e.n || [0, 1, 0]), dots = [];
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], L = a.distanceTo(b); for (let d = 0; d < L; d += 0.4) dots.push(a.clone().lerp(b, d / L)); }
  dots.push(pts[pts.length - 1].clone());
  const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: OFF.clone(), emissiveIntensity: 0.7 });
  const im = new THREE.InstancedMesh(new THREE.CircleGeometry(0.06, 10), mat, dots.length); im.layers.enable(LAYER_FX);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n), m4 = new THREE.Matrix4();
  dots.forEach((d, i) => { im.setMatrixAt(i, m4.compose(d.clone().addScaledVector(n, 0.012), q, new THREE.Vector3(1, 1, 1))); });
  root.group.add(im);
  return { e, update() { const on = evalIn(e.in); mat.emissive.copy(on ? ON : OFF); mat.emissiveIntensity = on ? 1.5 : 0.7; } };
};

// Trigger volume: fires a caption key, a checkpoint, or a signal.
B.trigger = (e) => {
  const mn = V3(e.min), mx = V3(e.max);
  return { e, done: false, update() {}, step() {
    if (this.done && e.once !== false) return;
    const p = player.body.position, inside = p.x > mn.x && p.x < mx.x && p.y > mn.y && p.y < mx.y && p.z > mn.z && p.z < mx.z && (!e.grounded || player.grounded);
    if (e.id) sig.set(e.id, inside || (e.latch && sig.get(e.id)));
    if (inside && !this.done) {
      this.done = true;
      if (e.say) ev.say(e.say, e.now); // now: cut in over queued lines
      if (e.checkpoint) ev.checkpoint(e.checkpoint);
    }
    if (!inside && e.once === false) this.done = false;
  } };
};

// Goal: walking in here completes the trial (`grounded`: only once standing in it).
B.goal = (e) => {
  const mn = V3(e.min), mx = V3(e.max);
  return { e, update() {}, step() { const p = player.body.position; if (player.alive && (!e.grounded || player.grounded) && p.x > mn.x && p.x < mx.x && p.y > mn.y && p.y < mx.y && p.z > mn.z && p.z < mx.z) ev.goal(); } };
};

// Skylight hatch (Daylight): two leaves hinged on the curb's long edges. They stand open until the player has flown
// out above `above`, then swing shut (and become solid) so nobody drops back down the chimney.
B.hatch = (e) => {
  const [x0, x1] = e.x, [z0, z1] = e.z, w = (x1 - x0) / 2, d = z1 - z0, c = new THREE.Vector3((x0 + x1) / 2, e.y, (z0 + z1) / 2);
  const leaves = [[x0, 1], [x1, -1]].map(([hx, s]) => {
    const pv = new THREE.Group(); pv.position.set(hx, e.y, c.z); root.group.add(pv);
    const lid = mesh(new THREE.BoxGeometry(w, 0.08, d), rkMats().paint, pv); lid.position.set(s * w / 2, 0.04, 0);
    const st = mesh(new THREE.BoxGeometry(0.22, 0.012, d - 0.2), M.hazard, lid); st.position.set(s * (w / 2 - 0.13), 0.046, 0); // along the meeting edge
    st.material = M.hazard.clone(); st.material.map = M.hazard.map.clone(); st.material.map.needsUpdate = true; st.material.map.repeat.set((d - 0.2) / 0.5, 1); st.material.map.rotation = Math.PI / 2;
    pv.rotation.z = s * Math.PI / 2; return { pv, s };
  });
  return { e, t: 0, shut: false, update(dt) {
    if (!this.shut) return;
    this.t = Math.min(1, this.t + dt / 0.9); const k = this.t * this.t * (3 - 2 * this.t);
    for (const l of leaves) l.pv.rotation.z = l.s * Math.PI / 2 * (1 - k);
  }, step() {
    if (this.shut || player.body.position.y < e.above) return;
    this.shut = true; ev.sfx('doorClose', c);
    addStatic(boxRec(c.clone().setY(e.y + 0.04), new THREE.Vector3(w, 0.04, d / 2)));
  } };
};

// An extra light for one chamber (Daylight's sun down the chimney). kind 'spot' aims at `target`.
B.light = (e) => {
  // decay 1: a gentle falloff, so walls near the source do not clip while far ones still get some light
  const l = e.kind === 'spot' ? new THREE.SpotLight(e.color, e.i, e.dist, (e.angle || 40) * Math.PI / 180, 0.8, 1) : new THREE.PointLight(e.color, e.i, e.dist, 1);
  l.position.copy(V3(e.p)); root.group.add(l);
  if (l.isSpotLight) { l.target.position.copy(V3(e.target)); root.group.add(l.target); }
  return { e, update() {} };
};

// Timer signal: on for `on` seconds, off for `off` seconds.
B.clock = (e) => ({ e, t: e.phase || 0, update(dt) { this.t = (this.t + dt) % (e.on + e.off); sig.set(e.id, this.t < e.on); } });

// Static decoration: hazard-striped trim along a box, sign boards, observation windows etc. are geometry-only.
B.stripe = (e) => { const mn = V3(e.min), mx = V3(e.max), s = mx.clone().sub(mn); const m = mesh(new THREE.BoxGeometry(s.x, s.y, s.z), M.hazard); m.position.copy(mn).add(mx).multiplyScalar(0.5); m.material = M.hazard.clone(); m.material.map = M.hazard.map.clone(); m.material.map.needsUpdate = true; m.material.map.repeat.set(Math.max(s.x, s.z) / 0.5, 1); return { e, update() {} }; };

// Rooftop props for the finale: air handlers with turning fans, a water tank on legs, a solar array and mushroom
// vents. Render only (static parts merged per material); their colliders are hidden boxes in the level data.
let RK = null;
function rkMats() {
  if (RK) return RK;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#16263d'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#6f8196'; x.lineWidth = 2; x.strokeRect(1, 1, 126, 126);
  x.strokeStyle = '#34485f'; x.lineWidth = 1.5; for (let i = 16; i < 128; i += 16) { x.beginPath(); x.moveTo(i, 2); x.lineTo(i, 126); x.moveTo(2, i); x.lineTo(126, i); x.stroke(); }
  const cells = new THREE.CanvasTexture(c); cells.colorSpace = THREE.SRGBColorSpace; cells.anisotropy = 4;
  RK = {
    paint: new THREE.MeshStandardMaterial({ color: 0xa3abae, roughness: 0.55, metalness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x7b878d, roughness: 0.45, metalness: 0.6 }),
    shroud: new THREE.MeshStandardMaterial({ color: 0x7b878d, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide }),
    tank: new THREE.MeshStandardMaterial({ color: 0x97a7af, roughness: 0.5, metalness: 0.4 }),
    solar: new THREE.MeshStandardMaterial({ map: cells, roughness: 0.2, metalness: 0.35 }),
  };
  return RK;
}
B.roofkit = (e) => {
  const R = rkMats(), y = e.y, parts = new Map(), fans = [];
  const add = (mat, g, px, py, pz, rx = 0, ry = 0, rz = 0) => {
    g.rotateX(rx).rotateY(ry).rotateZ(rz).translate(px, py, pz);
    if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(g);
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (r0, r1, h, n = 16, open = false) => new THREE.CylinderGeometry(r0, r1, h, n, 1, open);
  for (const [kind, ...a] of e.items) {
    if (kind === 'hvac') {
      const [x, z, w, d, h] = a, top = y + h;
      add(M.dark, box(w + 0.2, 0.15, d + 0.2), x, y + 0.075, z);
      add(R.paint, box(w, h - 0.15, d), x, y + 0.15 + (h - 0.15) / 2, z);
      for (let sy = y + 0.4; sy < y + 0.4 + (h - 0.15) * 0.55; sy += 0.13) { // louvres on all four sides
        for (const s of [-1, 1]) { add(M.darker, box(w - 0.4, 0.05, 0.03), x, sy, z + s * (d / 2 + 0.015)); add(M.darker, box(0.03, 0.05, d - 0.4), x + s * (w / 2 + 0.015), sy, z); }
      }
      const long = Math.max(w, d), n = Math.max(1, Math.floor(long / 1.8));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5, fx = w >= d ? x + t * long : x, fz = w >= d ? z : z + t * long, r = 0.7;
        add(R.shroud, cyl(r, r, 0.32, 28, true), fx, top + 0.16, fz);
        add(R.steel, new THREE.TorusGeometry(r, 0.035, 8, 32), fx, top + 0.32, fz, Math.PI / 2);
        add(M.darker, new THREE.CircleGeometry(r - 0.02, 28), fx, top + 0.01, fz, -Math.PI / 2);
        add(M.darker, cyl(0.12, 0.12, 0.2, 12), fx, top + 0.1, fz);
        for (let k = -2; k <= 2; k++) { const o = k * 0.26, L = 2 * Math.sqrt(r * r - o * o) - 0.04; add(R.steel, box(L, 0.018, 0.018), fx, top + 0.3, fz + o); add(R.steel, box(0.018, 0.018, L), fx + o, top + 0.28, fz); }
        const fan = new THREE.Group(); fan.position.set(fx, top + 0.17, fz); root.group.add(fan);
        for (let k = 0; k < 4; k++) { const b = mesh(box(0.62, 0.015, 0.16), M.darker, fan); b.position.set(Math.cos(k * Math.PI / 2) * 0.36, 0, Math.sin(k * Math.PI / 2) * 0.36); b.rotation.order = 'YXZ'; b.rotation.set(0.35, -k * Math.PI / 2, 0); }
        fans.push([fan, 5 + i * 1.3]);
      }
    } else if (kind === 'tank') {
      const [x, z] = a;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(R.steel, cyl(0.07, 0.07, 2.3, 8), x + sx * 1.05, y + 1.15, z + sz * 1.05);
      const dl = Math.hypot(2.1, 1.9), da = Math.atan2(1.9, 2.1);
      for (const s of [-1, 1]) for (const f of [-1, 1]) { // cross braces on each side
        add(R.steel, cyl(0.03, 0.03, dl, 6), x, y + 1.2, z + s * 1.05, 0, 0, Math.PI / 2 + f * da);
        add(R.steel, cyl(0.03, 0.03, dl, 6), x + s * 1.05, y + 1.2, z, Math.PI / 2 + f * da, 0, 0);
      }
      add(M.dark, box(2.6, 0.1, 2.6), x, y + 2.35, z);
      add(R.tank, cyl(1.25, 1.25, 2.8, 32), x, y + 3.8, z);
      add(R.tank, new THREE.ConeGeometry(1.32, 0.55, 32), x, y + 5.475, z);
      for (const by of [3.1, 4.5]) add(R.steel, new THREE.TorusGeometry(1.26, 0.03, 6, 40), x, y + by, z, Math.PI / 2);
      for (const s of [-1, 1]) add(R.steel, box(0.04, 2.4, 0.04), x + 1.38, y + 1.2, z + s * 0.22); // ladder
      for (let ry = 0.3; ry < 2.3; ry += 0.3) add(R.steel, box(0.04, 0.03, 0.44), x + 1.38, y + ry, z);
    } else if (kind === 'solar') {
      const [x0, z0, x1, z1] = a, rows = 2, per = Math.floor((x1 - x0) / 2), tilt = 0.44;
      for (let rI = 0; rI < rows; rI++) {
        const rz = z0 + (z1 - z0) * (rI + 0.5) / rows;
        add(M.dark, box(x1 - x0 - 0.2, 0.06, 0.08), (x0 + x1) / 2, y + 0.03, rz - 0.35); add(M.dark, box(x1 - x0 - 0.2, 0.06, 0.08), (x0 + x1) / 2, y + 0.03, rz + 0.35);
        for (let i = 0; i < per; i++) {
          const px = x0 + 1 + i * 2;
          add(R.solar, box(1.85, 0.04, 1.15), px, y + 0.62, rz, tilt);
          // legs stand on the rails and end inside the tilted panel (back 0.78 m, front 0.45 m)
          for (const s of [-1, 1]) { add(M.dark, box(0.05, 0.72, 0.05), px + s * 0.8, y + 0.42, rz - 0.35); add(M.dark, box(0.05, 0.39, 0.05), px + s * 0.8, y + 0.255, rz + 0.35); }
        }
      }
    } else if (kind === 'vent') {
      const [x, z] = a;
      add(R.steel, cyl(0.19, 0.21, 0.06, 16), x, y + 0.03, z);
      add(R.steel, cyl(0.11, 0.11, 0.66, 12), x, y + 0.39, z);
      add(M.darker, cyl(0.24, 0.24, 0.05, 16), x, y + 0.72, z);
      add(M.darker, new THREE.ConeGeometry(0.24, 0.12, 16), x, y + 0.805, z);
    }
  }
  for (const [mat, gs] of parts) mesh(mergeGeometries(gs), mat);
  return { e, update(dt) { for (const [f, s] of fans) f.rotation.y += dt * s; } };
};

// ---------------------------------------------------------------- registry
const extra = {}; // other modules (beams, gel, props) add builders here
export function registerBuilder(t, fn) { extra[t] = fn; }

export function buildEnts(level) {
  mats(); if (!root.group) clearEnts();
  for (const e of level.ents || []) {
    const fn = B[e.t] || extra[e.t];
    if (!fn) { console.warn('unknown entity', e.t); continue; }
    const n0 = root.group.children.length, o = fn(e); if (o) { o.type = e.t; ents.push(o); }
    for (const c of root.group.children.slice(n0)) c.userData.ent = e.t; // labels for tools/verify/coplanar.mjs
  }
}
export function clearEnts() {
  for (const o of ents) if (o.dispose) o.dispose();
  if (root.group) { G.scene.remove(root.group); root.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  for (const b of root.bodies) phys.world.removeBody(b);
  root.bodies.length = 0; root.group = new THREE.Group(); G.scene.add(root.group);
  ents.length = 0; rayBoxes.length = 0; hazards.length = 0; grids.length = 0; sig.clear();
}
export function mechStep(dt) { for (const o of ents) if (o.step) o.step(dt); }
export function mechFrame(dt, t) { for (const pr of props) pr.onButton = false; for (const o of ents) { o.update(dt, 0, t); if (o.frame) o.frame(); } }

// E key: the nearest usable entity in front of the viewer.
export function useEntity(eye, dir) {
  let best = null, bt = 2.4;
  for (const o of ents) if (o.usable && o.rec) { const h = rayBox(eye, dir, o.rec, bt); if (h) { bt = h.t; best = o; } }
  return best ? best.use() : false;
}
export const rayTargets = () => rayBoxes.map((rb) => ({ hit: (o, d, m) => { const h = rayBox(o, d, rb.rec, m); if (h) h.tag = rb.tag; return h; } }));
