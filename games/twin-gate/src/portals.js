// Gates: placement (fit/clamp on light panels), link transforms, physics pass-through (contact filter + rim
// colliders + teleport keeping velocity), and recursive rendering with oblique near-plane clipping.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G, LAYER_FX, LAYER_AVATAR, drawSize } from './gfx.js';
import { world, holeU } from './world.js';
import { phys } from './physics.js';

export const HALF_W = 0.7, HALF_H = 1.2;   // gate opening half-size (m)
export const CUP = 0.15;                   // depth of the view "cup" behind the wall
export const COLORS = [new THREE.Color(0x2fe6c0), new THREE.Color(0xff5a36)];
const FLIP = new THREE.Quaternion(0, 1, 0, 0); // 180 degrees about local up

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion();

// ---------------------------------------------------------------- shaders
const NOISE = `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`;
const cupMat = (i) => new THREE.ShaderMaterial({
  uniforms: { tView: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uMap: { value: new THREE.Vector4(0, 0, 1, 1) }, uCol: { value: COLORS[i].clone() }, uFlash: { value: 0 } },
  vertexShader: `varying vec2 vL; void main(){ vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  // uMap (offset, scale) remaps the screen lookup; identity except for the innermost level (see renderGateViews)
  fragmentShader: `uniform sampler2D tView; uniform vec2 uRes; uniform vec4 uMap; uniform vec3 uCol; uniform float uFlash; varying vec2 vL;
  void main(){ vec3 c = texture2D(tView, uMap.xy + gl_FragCoord.xy / uRes * uMap.zw).rgb; float r = length(vL);
    c = mix(c, uCol * 1.2, smoothstep(0.93, 1.0, r) * 0.2 + uFlash); gl_FragColor = vec4(c, 1.0); }`,
  side: THREE.DoubleSide, fog: false, toneMapped: false,
});
const rimMat = (i) => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: COLORS[i].clone() }, uTime: { value: 0 }, uLinked: { value: 0 }, uOpen: { value: 0 }, uSeed: { value: i * 17.3 }, uAspect: { value: HALF_H / HALF_W }, uNear: { value: 1 } },
  vertexShader: `varying vec2 vL; void main(){ vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uCol; uniform float uTime, uLinked, uOpen, uSeed, uAspect, uNear; varying vec2 vL; ${NOISE}
  void main(){
    float r = length(vL), ang = atan(vL.y, vL.x);
    vec2 ap = vec2(cos(ang) * 3.0, sin(ang) * 3.0);
    float f1 = vn(ap + vec2(uSeed, -uTime * 1.7 + r * 5.0)), f2 = vn(ap * 2.3 + vec2(-uTime * 2.9, uSeed + r * 9.0));
    float flame = f1 * 0.65 + f2 * 0.35;
    float w = (0.035 + 0.07 * flame) * mix(1.0, 0.65, abs(sin(ang)));
    float ring = exp(-pow((r - 1.0) / w, 2.0));
    // halo and inner glow fade out as the camera closes in, so walking through is not a wash of colour
    float halo = r > 1.0 ? exp(-(r - 1.0) * 9.0) * (0.2 + 0.5 * flame) * uNear : 0.0;
    float inner = r < 1.0 ? smoothstep(0.85, 1.0, r) * 0.2 * uNear : 0.0;
    ring *= mix(0.22, 1.0, uNear * uNear);
    // premultiplied: glow is purely additive (alpha 0); the unlinked swirl fill covers the wall.
    // Peak stays in the gate's own hue (no white core) and under ~2x, so tone mapping keeps it coloured, not clipped.
    vec3 col = uCol * (ring * 1.45 + pow(ring, 4.0) * 0.45 + halo * 0.85 + inner);
    float a = 0.0;
    if (uLinked < 0.5 && r < 1.0) {
      float sw = vn(vec2(ang * 3.0 / 6.2832 * 6.0 + r * 6.0 - uTime * 1.3, r * 4.0 + uSeed));
      float sw2 = vn(vec2(ang * 2.0 + uTime * 0.7, r * 9.0 - uTime * 2.0));
      vec3 fill = uCol * (0.1 + 0.8 * sw * sw + 0.3 * sw2 * (1.0 - r));
      a = 0.94 * smoothstep(1.0, 0.96, r); col += fill * a;
    }
    gl_FragColor = vec4(col * uOpen, a * uOpen);
  }`,
  transparent: true, depthWrite: false, fog: false, toneMapped: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

// Elliptic cup: open tube + back cap in unit coords (scaled to the opening), extending CUP behind the plane.
function cupGeometry() {
  const seg = 48, pos = [], idx = [];
  for (let i = 0; i <= seg; i++) { const t = i / seg * Math.PI * 2; pos.push(Math.cos(t), Math.sin(t), 0.002, Math.cos(t), Math.sin(t), -CUP); }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const c = pos.length / 3; pos.push(0, 0, -CUP);
  for (let i = 0; i < seg; i++) idx.push(c, i * 2 + 1, i * 2 + 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}

// ---------------------------------------------------------------- gate objects
class Gate {
  constructor(i) {
    this.i = i; this.open = false; this.fixed = false; this.anim = 0; this.closing = 0; this.flash = 0;
    this.c = V(); this.n = V().set(0, 0, 1); this.u = V().set(0, 1, 0); this.r = V().set(1, 0, 0);
    this.a = HALF_W; this.b = HALF_H; this.depth = 0.5; this.host = null;
    this.frame = new THREE.Matrix4(); this.inv = new THREE.Matrix4(); this.q = new THREE.Quaternion();
    this.plane = new THREE.Plane();
    this.rims = [];
    this.group = new THREE.Group(); this.group.visible = false;
    this.cup = new THREE.Mesh(cupGeometry(), cupMat(i)); this.cup.layers.set(LAYER_FX); this.cup.frustumCulled = false;
    this.rim = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.7), rimMat(i)); this.rim.layers.set(LAYER_FX); this.rim.renderOrder = 3; this.rim.frustumCulled = false;
    this.group.add(this.cup, this.rim);
    this.light = new THREE.PointLight(COLORS[i], 0, 5.5, 1.8);
    this.rts = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true }));
  }
  setFrame(c, n, u) {
    this.c.copy(c); this.n.copy(n).normalize(); this.u.copy(u).normalize();
    this.r.crossVectors(this.u, this.n).normalize();
    this.frame.makeBasis(this.r, this.u, this.n).setPosition(this.c); this.inv.copy(this.frame).invert();
    this.q.setFromRotationMatrix(_m4.makeBasis(this.r, this.u, this.n));
    this.plane.setFromNormalAndCoplanarPoint(this.n, this.c);
    this.group.position.copy(c); this.group.quaternion.copy(this.q);
    this.light.position.copy(c).addScaledVector(n, 0.5);
  }
  dist(p) { return _a.copy(p).sub(this.c).dot(this.n); }
  local(p, out = V()) { _a.copy(p).sub(this.c); return out.set(_a.dot(this.r), _a.dot(this.u), _a.dot(this.n)); }
  // inside the (optionally shrunk) opening, measured on the gate plane
  inHole(p, shrink = 0) { _a.copy(p).sub(this.c); const x = _a.dot(this.r) / (this.a - shrink), y = _a.dot(this.u) / (this.b - shrink); return x * x + y * y < 1; }
}

export const gates = [new Gate(0), new Gate(1)];
export const linked = () => gates[0].open && gates[1].open && !gates[0].closing && !gates[1].closing;
export const on = { open() {}, close() {}, fail() {}, teleport() {} };

// T maps gate i's space to its partner's: M_out * Rot180(up) * M_in^-1
const T = [new THREE.Matrix4(), new THREE.Matrix4()], TQ = [new THREE.Quaternion(), new THREE.Quaternion()];
function relink() {
  for (let i = 0; i < 2; i++) {
    const A = gates[i], B = gates[1 - i];
    T[i].copy(B.frame).multiply(_m4.makeRotationY(Math.PI)).multiply(A.inv);
    TQ[i].copy(B.q).multiply(FLIP).multiply(_q.copy(A.q).invert());
  }
}
export const xfPoint = (i, p, out = V()) => out.copy(p).applyMatrix4(T[i]);
export const xfDir = (i, d, out = V()) => out.copy(d).applyQuaternion(TQ[i]);
export const xfQuat = (i, q, out = new THREE.Quaternion()) => out.copy(TQ[i]).multiply(q);
export const xfMatrix = (i) => T[i];

export function initPortals() {
  for (const g of gates) G.scene.add(g.group, g.light);
  phys.filters.push(holeFilter);
  resizeTargets();
}
export function resizeTargets() {
  const { w, h } = drawSize(), s = G.q.portalScale;
  for (const g of gates) for (const rt of g.rts) rt.setSize(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
}

// ---------------------------------------------------------------- physics: holes, rims, travellers
// Drop contacts between a body and static world geometry where the contact point lies inside a linked
// gate's opening or the tunnel behind it. Rim colliders (the tunnel's walls) always collide.
const _p = V();
function holeFilter(c) {
  if (!linked()) return true;
  let sb = null, r = null;
  if (c.bi.type === CANNON.Body.STATIC) { sb = c.bi; r = c.ri; } else if (c.bj.type === CANNON.Body.STATIC) { sb = c.bj; r = c.rj; } else return true;
  if (sb.isRim || !sb.box) return true;
  _p.set(sb.position.x + r.x, sb.position.y + r.y, sb.position.z + r.z);
  for (const g of gates) {
    const d = g.dist(_p);
    if (d < 0.03 && d > -g.depth - 0.4 && g.inHole(_p, -0.02)) return false;
  }
  return true;
}

function buildRims(g) {
  clearRims(g);
  const N = 14, pts = [];
  for (let k = 0; k < N; k++) { const t = k / N * Math.PI * 2; pts.push([Math.cos(t) * g.a, Math.sin(t) * g.b]); }
  const depth = Math.max(0.3, g.depth + 0.4);
  for (let k = 0; k < N; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % N];
    const tx = x1 - x0, ty = y1 - y0, len = Math.hypot(tx, ty), ox = ty / len, oy = -tx / len; // outward
    const th = 0.3, mx = (x0 + x1) / 2 + ox * (0.045 + th / 2), my = (y0 + y1) / 2 + oy * (0.045 + th / 2);
    const cW = V().copy(g.c).addScaledVector(g.r, mx).addScaledVector(g.u, my).addScaledVector(g.n, -depth / 2);
    const tW = V().copy(g.r).multiplyScalar(tx / len).addScaledVector(g.u, ty / len);
    const oW = V().copy(g.r).multiplyScalar(ox).addScaledVector(g.u, oy);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m4.makeBasis(tW, oW, V().crossVectors(tW, oW)));
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: phys.mat.world });
    body.addShape(new CANNON.Box(new CANNON.Vec3(len / 2 + 0.06, th / 2, depth / 2)));
    body.position.set(cW.x, cW.y, cW.z); body.quaternion.set(q.x, q.y, q.z, q.w); body.isRim = true;
    phys.world.addBody(body); g.rims.push(body);
  }
}
function clearRims(g) { for (const b of g.rims) phys.world.removeBody(b); g.rims.length = 0; }

// Travellers: { body, prev: CANNON.Vec3, radius, onTeleport(i) }. Checked after every physics step.
export const travellers = new Set();
export function beforeStep() { for (const t of travellers) t.prev.copy(t.body.position); }
const _pv = V(), _nv = V(), _x = V();
export function afterStep() {
  if (!linked()) return;
  for (const t of travellers) {
    const b = t.body; if (b.sleepState === CANNON.Body.SLEEPING) continue;
    _pv.set(t.prev.x, t.prev.y, t.prev.z); _nv.set(b.position.x, b.position.y, b.position.z);
    for (const g of gates) {
      const d0 = g.dist(_pv), d1 = g.dist(_nv);
      if (!(d0 >= 0 && d1 < 0)) continue;
      _x.copy(_pv).lerp(_nv, d0 / (d0 - d1));
      if (!g.inHole(_x, 0)) continue;
      teleportBody(b, g.i);
      t.prev.copy(b.position);
      if (t.onTeleport) t.onTeleport(g.i);
      on.teleport(t, g.i);
      break;
    }
  }
}
const _tq = new THREE.Quaternion();
export const lastTeleport = { before: null, after: null, gate: -1 }; // exact numbers, for verification
export function teleportBody(b, i) {
  lastTeleport.gate = i; lastTeleport.before = { p: [b.position.x, b.position.y, b.position.z], v: [b.velocity.x, b.velocity.y, b.velocity.z] };
  _a.set(b.position.x, b.position.y, b.position.z).applyMatrix4(T[i]); b.position.set(_a.x, _a.y, _a.z);
  _a.set(b.velocity.x, b.velocity.y, b.velocity.z).applyQuaternion(TQ[i]); b.velocity.set(_a.x, _a.y, _a.z);
  _a.set(b.angularVelocity.x, b.angularVelocity.y, b.angularVelocity.z).applyQuaternion(TQ[i]); b.angularVelocity.set(_a.x, _a.y, _a.z);
  if (!b.fixedRotation) { _tq.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w).premultiply(TQ[i]); b.quaternion.set(_tq.x, _tq.y, _tq.z, _tq.w); }
  b.previousPosition.copy(b.position); b.interpolatedPosition.copy(b.position);
  b.wakeUp();
  lastTeleport.after = { p: [b.position.x, b.position.y, b.position.z], v: [b.velocity.x, b.velocity.y, b.velocity.z] };
}
// Push anything left inside a closing gate's tunnel back out in front of the wall.
const _ej = new THREE.Vector3();
function ejectFrom(g) {
  for (const t of travellers) {
    _ej.set(t.body.position.x, t.body.position.y, t.body.position.z);
    const d = g.dist(_ej);
    if (d < t.radius && d > -g.depth - 1 && g.inHole(_ej, -t.radius)) { _ej.addScaledVector(g.n, t.radius + 0.03 - d); t.body.position.set(_ej.x, _ej.y, _ej.z); t.prev.copy(t.body.position); }
  }
}

// ---------------------------------------------------------------- placement
export const blockers = []; // extra no-gate zones: { min: Vector3, max: Vector3 }
function surfaceOK(p, n) {
  _b.copy(p).addScaledVector(n, -0.03);
  if (!world.solidAt(_b, (bx) => bx.s === 'W')) return false;
  _b.copy(p).addScaledVector(n, 0.05);
  if (world.solidAt(_b)) return false;
  for (const z of blockers) if (_b.x > z.min.x && _b.y > z.min.y && _b.z > z.min.z && _b.x < z.max.x && _b.y < z.max.y && _b.z < z.max.z) return false;
  return true;
}
const SAMPLES = (() => { const s = [[0, 0]]; for (let k = 0; k < 20; k++) { const t = k / 20 * Math.PI * 2; s.push([Math.cos(t), Math.sin(t)]); } for (let k = 0; k < 10; k++) { const t = (k + 0.5) / 10 * Math.PI * 2; s.push([Math.cos(t) * 0.6, Math.sin(t) * 0.6]); } return s; })();

// Find a valid centre near `hit` on the plane (point, normal). `up` orients the opening. Returns centre or null.
export function fitGate(i, point, normal, up) {
  const r = V().crossVectors(up, normal).normalize(), u = V().crossVectors(normal, r);
  const other = gates[1 - i];
  const c = point.clone(), s = V(), push = V();
  for (let iter = 0; iter < 24; iter++) {
    push.set(0, 0, 0); let bad = 0;
    for (const [x, y] of SAMPLES) {
      s.copy(c).addScaledVector(r, x * HALF_W).addScaledVector(u, y * HALF_H);
      let ok = surfaceOK(s, normal);
      if (ok && other.open && !other.closing && Math.abs(other.dist(s)) < 0.05 && other.n.dot(normal) > 0.99) {
        // keep a gap between the two openings
        other.local(s, _c); const ex = _c.x / (other.a + HALF_W * 0.15), ey = _c.y / (other.b + HALF_H * 0.15);
        if (ex * ex + ey * ey < 1) { ok = false; push.addScaledVector(V().copy(s).sub(other.c).normalize(), 2); }
      }
      if (!ok) { bad++; push.addScaledVector(r, -x).addScaledVector(u, -y); }
    }
    if (!bad) {
      // wall gates that end up just above a floor snap down so the bottom edge sits on it
      if (Math.abs(normal.y) < 0.3) {
        for (let k = 1; k <= 20; k++) { // up to 1 m
          const d = k * 0.05;
          s.copy(c).addScaledVector(u, -HALF_H - d).addScaledVector(normal, 0.3);
          if (world.solidAt(s)) { const c2 = c.clone().addScaledVector(u, -(d - 0.05)); if (validAt(i, c2, r, u, normal)) return { c: c2, r, u }; break; }
        }
      }
      return { c, r, u };
    }
    if (push.lengthSq() < 1e-6) return null;
    push.addScaledVector(normal, -push.dot(normal)).normalize();
    c.addScaledVector(push, 0.06);
    if (c.distanceTo(point) > 1.3) return null;
  }
  return null;
}

function validAt(i, c, r, u, normal) {
  const s = V(), other = gates[1 - i];
  for (const [x, y] of SAMPLES) {
    s.copy(c).addScaledVector(r, x * HALF_W).addScaledVector(u, y * HALF_H);
    if (!surfaceOK(s, normal)) return false;
    if (other.open && !other.closing && Math.abs(other.dist(s)) < 0.05 && other.n.dot(normal) > 0.99) {
      other.local(s, _c); const ex = _c.x / (other.a + HALF_W * 0.15), ey = _c.y / (other.b + HALF_H * 0.15);
      if (ex * ex + ey * ey < 1) return false;
    }
  }
  return true;
}

// Orientation rule: walls keep "up" vertical; floors/ceilings point the top away from the shooter.
export function gateUp(normal, shotDir) {
  if (Math.abs(normal.y) < 0.7) return V().set(0, 1, 0).addScaledVector(normal, -normal.y).normalize();
  const u = V().copy(shotDir).addScaledVector(normal, -shotDir.dot(normal));
  if (u.lengthSq() < 1e-4) u.set(0, 0, -1);
  if (normal.y < 0) u.negate();
  return u.normalize();
}

export function placeGate(i, c, n, u, opts = {}) {
  const g = gates[i];
  if (g.open) { ejectFrom(g); on.close(g, true); clearRims(g); }
  g.setFrame(c, n, u);
  // tunnel depth: how much solid wall sits behind the opening
  let dpt = 0; for (; dpt < 1.6; dpt += 0.05) { _b.copy(c).addScaledVector(n, -dpt - 0.03); if (!world.solidAt(_b)) break; }
  g.depth = Math.max(0.05, dpt);
  g.host = world.solidAt(_b.copy(c).addScaledVector(n, -0.03));
  g.open = true; g.closing = 0; g.anim = opts.instant ? 1 : 0; g.flash = opts.instant ? 0 : 1; g.fixed = !!opts.fixed;
  g.group.visible = true;
  relink();
  buildRims(g);
  on.open(g);
}
export function closeGate(i, silent) {
  const g = gates[i]; if (!g.open) return;
  ejectFrom(g);
  g.closing = 0.001; clearRims(g);
  if (!silent) on.close(g, false);
}
export function resetGates() {
  for (const g of gates) { clearRims(g); g.open = false; g.closing = 0; g.anim = 0; g.fixed = false; g.group.visible = false; g.light.intensity = 0; }
  blockers.length = 0;
}

// ---------------------------------------------------------------- rays through gates
// Walk a ray through linked gates. targets: [{ hit(o, d, maxT) -> {t, point, normal, ...} | null }].
// Returns segments [{ a, b, gate (index crossed at b) | undefined, hit }].
export function castThrough(o, d, maxT = 200, opts = {}) {
  const segs = []; let O = o.clone(), D = d.clone().normalize(), left = maxT;
  for (let hop = 0; hop <= (opts.hops ?? 6); hop++) {
    let hit = world.raycast(O, D, left, opts.pred);
    for (const tg of opts.targets || []) { const h = tg.hit(O, D, hit ? hit.t : left); if (h && (!hit || h.t < hit.t)) hit = h; }
    let gi = -1, gt = hit ? hit.t + 0.02 : left;
    if (linked()) for (const g of gates) {
      const dn = D.dot(g.n); if (dn > -1e-4) continue;
      const t = -g.dist(O) / dn; if (t < 1e-4 || t > gt) continue;
      _c.copy(O).addScaledVector(D, t); if (!g.inHole(_c, 0.02)) continue;
      gi = g.i; gt = t;
    }
    if (gi >= 0) {
      const b = O.clone().addScaledVector(D, gt);
      segs.push({ a: O, b, gate: gi });
      O = xfPoint(gi, b); D = xfDir(gi, D).normalize(); O.addScaledVector(D, 1e-3); left -= gt;
      continue;
    }
    segs.push({ a: O, b: hit ? hit.point.clone() : O.clone().addScaledVector(D, left), hit });
    break;
  }
  return segs;
}

// ---------------------------------------------------------------- per-frame visuals
export function updateGates(dt, time) {
  const L = linked();
  for (const g of gates) {
    if (g.closing) {
      g.closing += dt * 6;
      if (g.closing >= 1) { g.open = false; g.closing = 0; g.group.visible = false; g.anim = 0; }
    } else if (g.open) g.anim = Math.min(1, g.anim + dt * 3.2);
    g.flash = Math.max(0, g.flash - dt * 2.5);
    const e = g.closing ? 1 - g.closing : easeOutBack(g.anim);
    const s = Math.max(0.001, e);
    g.cup.scale.set(g.a * s, g.b * s, 1);
    g.rim.scale.set(g.a * s, g.b * s, 1); g.rim.position.z = 0.004;
    const ru = g.rim.material.uniforms; ru.uTime.value = time; ru.uLinked.value = L ? 1 : 0; ru.uOpen.value = g.open ? Math.min(1, e * 1.5) : 0;
    g.cup.visible = L && g.open;
    g.cup.material.uniforms.uFlash.value = g.flash * 0.5;
    g.light.intensity = g.open ? (1.0 + Math.sin(time * 7 + g.i) * 0.12 + g.flash * 2.5) * Math.min(1, e) : 0;
    const hu = holeU;
    hu.uPC.value[g.i].copy(g.c); hu.uPN.value[g.i].copy(g.n); hu.uPR.value[g.i].copy(g.r); hu.uPU.value[g.i].copy(g.u);
    hu.uPS.value[g.i].set(g.a * s, g.b * s, CUP + 0.01, L && g.open ? 1 : 0);
  }
}
function easeOutBack(t) { const c1 = 1.9, c3 = c1 + 1; return t >= 1 ? 1 : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

// ---------------------------------------------------------------- rendering
const vcam = new THREE.PerspectiveCamera(), _camP = new THREE.Vector3(), _selfP = new THREE.Vector3();
// The player's own body and its clone (registered by props.js). A virtual camera inside either one (the view just
// before crossing is taken from inside the emerging clone) must not draw it, or the arms and device fill the view.
export const selfBodies = [];
const insideSelf = (p) => selfBodies.some((o) => o.visible && _selfP.setFromMatrixPosition(o.matrixWorld).distanceToSquared(p) < 1.1 * 1.1);
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sphere = new THREE.Sphere();
const _v4 = new THREE.Vector4(), _cp = new THREE.Plane();
export const stats = { renders: 0, levels: [0, 0] };

// Lengyel's oblique near plane: replace the projection's near plane with `planeW` (world space, keeps +side).
export function obliqueNear(cam, planeW) {
  _cp.copy(planeW).applyMatrix4(cam.matrixWorldInverse);
  const e = cam.projectionMatrix.elements;
  _v4.set(_cp.normal.x, _cp.normal.y, _cp.normal.z, _cp.constant);
  if (-_v4.w < 0.02) return false; // camera almost on the plane: keep the normal near plane
  const q = new THREE.Vector4((Math.sign(_v4.x) + e[8]) / e[0], (Math.sign(_v4.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  _v4.multiplyScalar(2 / _v4.dot(q));
  e[2] = _v4.x; e[6] = _v4.y; e[10] = _v4.z + 1; e[14] = _v4.w;
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  return true;
}

function visibleFrom(g, cam) {
  _a.setFromMatrixPosition(cam.matrixWorld);
  if (g.dist(_a) < 0.0005) return false;
  _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm);
  _sphere.set(g.c, Math.max(g.a, g.b) * 1.1); return _frustum.intersectsSphere(_sphere);
}
// Screen rectangle (NDC min/max) of the opening seen from cam; full screen if a corner is behind the eye.
const RECT_PTS = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]];
function screenRect(g, cam, out) {
  _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  let x0 = 1, y0 = 1, x1 = -1, y1 = -1;
  for (const [x, y, z] of RECT_PTS) {
    _v4.set(0, 0, 0, 1);
    _a.copy(g.c).addScaledVector(g.r, x * g.a).addScaledVector(g.u, y * g.b).addScaledVector(g.n, z * CUP);
    _v4.set(_a.x, _a.y, _a.z, 1).applyMatrix4(_pm);
    if (_v4.w <= 1e-4) { out.set(-1, -1, 1, 1); return out; }
    const nx = _v4.x / _v4.w, ny = _v4.y / _v4.w;
    x0 = Math.min(x0, nx); y0 = Math.min(y0, ny); x1 = Math.max(x1, nx); y1 = Math.max(y1, ny);
  }
  return out.set(Math.max(-1, x0), Math.max(-1, y0), Math.min(1, x1), Math.min(1, y1));
}
const rects = Array.from({ length: 12 }, () => new THREE.Vector4());
const cams = Array.from({ length: 12 }, () => new THREE.Matrix4());

// Render both gates' view chains into their render targets (deepest level first), then point the cups at level 1.
export function renderGateViews(mainCam) {
  const r = G.renderer; stats.renders = 0;
  const camP = _camP.setFromMatrixPosition(mainCam.matrixWorld);
  for (const g of gates) { const d = Math.max(Math.abs(g.dist(camP)), g.c.distanceTo(camP) - 1.2); g.rim.material.uniforms.uNear.value = THREE.MathUtils.smoothstep(d, 0.1, 1.8); }
  if (!linked()) return;
  const { w: mw, h: mh } = drawSize();
  const maxDepth = Math.max(1, G.q.depth);
  vcam.copy(mainCam, false); vcam.layers.enableAll();
  const oldAuto = r.autoClear; r.autoClear = true;
  for (const g of gates) {
    const o = gates[1 - g.i];
    g.cup.material.uniforms.uRes.value.set(mw, mh);
    if (!visibleFrom(g, mainCam)) { stats.levels[g.i] = 0; continue; }
    // build the chain of virtual camera transforms and nested screen rectangles
    let D = 0, more = false; cams[0].copy(mainCam.matrixWorld); rects[0].set(-1, -1, 1, 1);
    const pcam = mainCam;
    for (let k = 1; k <= maxDepth + 1; k++) {
      const rr = screenRect(g, k === 1 ? pcam : setV(cams[k - 1], mainCam, o), rects[k]);
      rr.set(Math.max(rr.x, rects[k - 1].x), Math.max(rr.y, rects[k - 1].y), Math.min(rr.z, rects[k - 1].z), Math.min(rr.w, rects[k - 1].w));
      if (rr.z <= rr.x || rr.w <= rr.y) break;
      if (k > maxDepth) { more = true; break; } // the chain goes on past the deepest level we render
      cams[k].multiplyMatrices(T[g.i], cams[k - 1]);
      D = k;
      if (!visibleFrom(g, setV(cams[k], mainCam, o))) break;
    }
    stats.levels[g.i] = D;
    // hide the exit gate (we look out of it), show the entry gate (it recurses)
    o.group.visible = false; g.group.visible = true;
    const rt = g.rts, uni = g.cup.material.uniforms;
    for (let k = D; k >= 1; k--) {
      const target = rt[k & 1], spare = rt[(k + 1) & 1];
      setV(cams[k], mainCam, o);
      vcam.layers[insideSelf(vcam.position) ? 'disable' : 'enable'](LAYER_AVATAR);
      uni.tView.value = spare.texture; uni.uRes.value.set(target.width, target.height);
      if (k === D && more) {
        // Innermost level: its own gate is still in view, but there is no deeper level to show in it, only last
        // frame's picture (which ghosts while turning). So the gate shows this level's own image, shrunk from this
        // level's rectangle into the next one's (a depth doubler). Drawn twice: the first pass fills the spare target
        // with last frame's image shrunk, the second shows the first; any lag ends up two levels deeper, sub-pixel.
        const a = rects[k], b = rects[k + 1], sx = (a.z - a.x) / (b.z - b.x), sy = (a.w - a.y) / (b.w - b.y);
        uni.uMap.value.set((a.x * 0.5 + 0.5) - (b.x * 0.5 + 0.5) * sx, (a.y * 0.5 + 0.5) - (b.y * 0.5 + 0.5) * sy, sx, sy);
        uni.tView.value = target.texture; drawLevel(r, spare, rects[k]); uni.tView.value = spare.texture;
      }
      drawLevel(r, target, rects[k]);
      uni.uMap.value.set(0, 0, 1, 1);
    }
    r.setRenderTarget(null);
    o.group.visible = o.open; g.group.visible = g.open;
    uni.tView.value = rt[1].texture; uni.uRes.value.set(mw, mh);
  }
  r.autoClear = oldAuto;
}
// Render the scene from vcam into `target`, scissored to the NDC rectangle R.
function drawLevel(r, target, R) {
  const tw = target.width, th = target.height;
  const sx = Math.floor((R.x * 0.5 + 0.5) * tw), sy = Math.floor((R.y * 0.5 + 0.5) * th);
  target.scissor.set(sx, sy, Math.ceil((R.z * 0.5 + 0.5) * tw) - sx + 1, Math.ceil((R.w * 0.5 + 0.5) * th) - sy + 1);
  target.scissorTest = true;
  r.setRenderTarget(target); r.render(G.scene, vcam); stats.renders++;
}
// Configure the shared virtual camera from a world matrix, with the oblique plane at the exit gate `o`.
function setV(m, mainCam, o) {
  vcam.matrixWorld.copy(m); vcam.matrixWorld.decompose(vcam.position, vcam.quaternion, vcam.scale);
  vcam.matrixWorldInverse.copy(m).invert();
  vcam.projectionMatrix.copy(mainCam.projectionMatrix);
  vcam.projectionMatrixInverse.copy(mainCam.projectionMatrixInverse);
  _cp.copy(o.plane); _cp.constant += 0.002; // nudge the clip plane a hair behind the wall
  obliqueNear(vcam, _cp);
  vcam.matrixAutoUpdate = false; vcam.matrixWorldAutoUpdate = false;
  return vcam;
}
