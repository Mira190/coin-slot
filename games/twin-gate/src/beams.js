// Beams traced through gates: the discouragement laser (with lens-block redirection, catchers and relays)
// and hard-light bridges (walkable slabs rebuilt whenever their path changes).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LAYER_FX } from './gfx.js';
import { phys } from './physics.js';
import { rayBox } from './world.js';
import { castThrough, xfDir, gates } from './portals.js';
import { player, CENTER_H } from './player.js';
import { props, rayProp, GROUP } from './props.js';
import { registerBuilder, evalIn, sig, ev, root, addBody, boxRec, mesh, rayBoxes } from './mech.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const lasers = [], catchers = [], relays = [], bridges = [];
const dark = () => new THREE.MeshStandardMaterial({ color: 0x2b3034, roughness: 0.45, metalness: 0.6 });
const white = () => new THREE.MeshStandardMaterial({ color: 0xe9ecea, roughness: 0.45, metalness: 0.05 });

// ---------------------------------------------------------------- beam visuals
const beamMat = (col, core) => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Color(col) }, uTime: { value: 0 }, uCore: { value: core } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vY = position.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform vec3 uCol; uniform float uTime, uCore; varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float k = pow(f, uCore > 0.5 ? 1.5 : 3.0);
      float flick = 0.85 + 0.15 * sin(vY * 30.0 - uTime * 40.0);
      vec3 c = (uCore > 0.5 ? mix(uCol, vec3(1.0), 0.35) * 2.2 : uCol * 1.0) * k * flick; gl_FragColor = vec4(c, k); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
});
class BeamPool {
  constructor(col) { this.col = col; this.items = []; this.used = 0; this.core = beamMat(col, 1); this.glow = beamMat(col, 0); }
  begin() { this.used = 0; }
  seg(a, b, t) {
    let it = this.items[this.used];
    if (!it) {
      it = new THREE.Group();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 8, 1, true), this.core);
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 10, 1, true), this.glow);
      c.layers.set(LAYER_FX); g.layers.set(LAYER_FX); c.frustumCulled = g.frustumCulled = false; it.add(c, g); root.group.add(it); this.items.push(it);
    }
    if (!it.parent) root.group.add(it);
    const d = b.clone().sub(a), L = d.length();
    it.position.copy(a).addScaledVector(d, 0.5); it.quaternion.setFromUnitVectors(_up, d.normalize()); it.scale.set(1, Math.max(L, 1e-3), 1);
    it.visible = true; this.used++;
    this.core.uniforms.uTime.value = t; this.glow.uniforms.uTime.value = t;
  }
  end() { for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false; }
  reset() { this.items.length = 0; this.used = 0; }
}
const _up = new THREE.Vector3(0, 1, 0);
let pool = null;

// ---------------------------------------------------------------- laser emitter
registerBuilder('laser', (e) => {
  const p = V3(e.p), d = V3(e.dir).normalize();
  const grp = new THREE.Group(); grp.position.copy(p); grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d); root.group.add(grp);
  mesh(new THREE.BoxGeometry(0.9, 0.9, 0.5), dark(), grp).position.z = -0.3;
  const lensM = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2244, emissiveIntensity: 1.8 });
  const lens = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 20), lensM, grp); lens.rotation.x = Math.PI / 2; lens.position.z = -0.02; lens.layers.enable(LAYER_FX);
  const o = { e, p, d, on: true, path: [], update() { this.on = evalIn(e.in); lensM.emissiveIntensity = this.on ? 1.8 : 0.3; } };
  lasers.push(o); return o;
});

// Catcher: lights up (signal on) while a beam hits its lens.
registerBuilder('catcher', (e) => {
  const p = V3(e.p), n = V3(e.n).normalize();
  const grp = new THREE.Group(); grp.position.copy(p); grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); root.group.add(grp);
  mesh(new THREE.BoxGeometry(1.1, 1.1, 0.4), white(), grp).position.z = -0.17; // face 3 cm proud of the wall it is mounted on
  const ringM = new THREE.MeshStandardMaterial({ color: 0x1a2328, emissive: 0x6b8796, emissiveIntensity: 0.6 });
  const ring = mesh(new THREE.TorusGeometry(0.36, 0.06, 10, 30), ringM, grp); ring.position.z = 0.02; ring.layers.enable(LAYER_FX);
  const lensM = new THREE.MeshStandardMaterial({ color: 0x331015, emissive: 0xff2244, emissiveIntensity: 0.2, roughness: 0.1 });
  const lens = mesh(new THREE.SphereGeometry(0.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lensM, grp); lens.rotation.x = Math.PI / 2; lens.scale.set(1, 0.5, 1); lens.layers.enable(LAYER_FX);
  const rec = boxRec(p.clone().addScaledVector(n, -0.05), new THREE.Vector3(0.55, 0.55, 0.3), grp.quaternion);
  const o = { e, rec, hit: 0, on: false, spin: 0, update(dt) {
    const was = this.on; this.on = this.hit > 0 || (e.latch && this.on); this.hit = Math.max(0, this.hit - dt);
    if (this.on !== was) ev.sfx(this.on ? 'catchOn' : 'catchOff', p);
    if (e.id) sig.set(e.id, this.on);
    this.spin += dt * (this.on ? 6 : 0.4); ring.rotation.z = this.spin;
    lensM.emissiveIntensity += ((this.on ? 2.2 : 0.2) - lensM.emissiveIntensity) * Math.min(1, dt * 8);
    ringM.emissive.set(this.on ? 0xffae2e : 0x6b8796); ringM.emissiveIntensity = this.on ? 1.5 : 0.6;
  } };
  catchers.push(o); return o;
});

// Relay: a post the beam passes through; lit while crossed.
registerBuilder('relay', (e) => {
  const p = V3(e.p), grp = new THREE.Group(); grp.position.copy(p); root.group.add(grp);
  mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.2, 20), dark(), grp).position.y = 0.1;
  mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.2, 20), dark(), grp).position.y = 1.7;
  const coreM = new THREE.MeshStandardMaterial({ color: 0x331015, emissive: 0xff2244, emissiveIntensity: 0.2, transparent: true, opacity: 0.7 });
  const core = mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 20, 1, true), coreM, grp); core.position.y = 0.9; core.layers.enable(LAYER_FX);
  const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: phys.mat.world, collisionFilterGroup: GROUP.world });
  body.addShape(new CANNON.Cylinder(0.3, 0.3, 1.8, 12)); body.position.set(p.x, p.y + 0.9, p.z); addBody(body);
  const rec = boxRec(p.clone().add(new THREE.Vector3(0, 0.9, 0)), new THREE.Vector3(0.5, 0.8, 0.5));
  const o = { e, rec, hit: 0, on: false, update(dt) {
    const was = this.on; this.on = this.hit > 0; this.hit = Math.max(0, this.hit - dt);
    if (this.on !== was) ev.sfx(this.on ? 'catchOn' : 'catchOff', p);
    if (e.id) sig.set(e.id, this.on);
    coreM.emissiveIntensity += ((this.on ? 2.2 : 0.2) - coreM.emissiveIntensity) * Math.min(1, dt * 8);
  } };
  relays.push(o); return o;
});

// ---------------------------------------------------------------- laser tracing
const segDist = (() => { // distance between segments p1-q1 and p2-q2
  const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), r = new THREE.Vector3(), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
  return (p1, q1, p2, q2) => {
    d1.subVectors(q1, p1); d2.subVectors(q2, p2); r.subVectors(p1, p2);
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r); let s, t;
    const c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
    s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    c1.copy(p1).addScaledVector(d1, s); c2.copy(p2).addScaledVector(d2, t); return { d: c1.distanceTo(c2), p: c1.clone() };
  };
})();

export const laserHits = []; // end points this frame (for sparks)
function traceLaser(L, dt, t) {
  let o = L.p.clone(), d = L.d.clone(), skip = null; const path = [];
  for (let bounce = 0; bounce < 6; bounce++) {
    const targets = [
      ...props.filter((pr) => pr !== skip && !pr.fizzleT).map((pr) => ({ hit: (a, b, m) => rayProp(pr, a, b, m) })),
      ...catchers.map((c) => ({ hit: (a, b, m) => { const h = rayBox(a, b, c.rec, m); if (h) h.catcher = c; return h; } })),
      ...rayBoxes.map((rb) => ({ hit: (a, b, m) => rayBox(a, b, rb.rec, m) })),
    ];
    const segs = castThrough(o, d, 120, { pred: (bx) => bx.s !== 'G', targets, hops: 6 });
    path.push(...segs);
    const h = segs[segs.length - 1].hit;
    if (h && h.catcher) h.catcher.hit = 0.25;
    if (h && h.prop && h.prop.kind === 'lens') {
      const pr = h.prop, b = pr.body;
      h.prop.lit = 0.2;
      o = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
      d = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
      o.addScaledVector(d, 0.36); skip = pr; continue;
    }
    break;
  }
  return path;
}

export function beamsFrame(dt, t) {
  if (!pool) pool = new BeamPool(0xff2244);
  pool.begin(); laserHits.length = 0;
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const pp = player.body.position; pa.set(pp.x, pp.y - CENTER_H + 0.2, pp.z); pb.set(pp.x, pp.y + 0.75, pp.z);
  let burn = 0, push = null;
  for (const L of lasers) {
    if (!L.on) { L.path = []; continue; }
    const path = traceLaser(L, dt, t); L.path = path;
    for (const s of path) {
      pool.seg(s.a, s.b, t);
      for (const r of relays) if (rayBox(s.a, s.b.clone().sub(s.a).normalize(), r.rec, s.a.distanceTo(s.b))) r.hit = 0.25;
      if (player.alive) { const q = segDist(s.a, s.b, pa, pb); if (q.d < 0.34) { burn += dt; push = s.b.clone().sub(s.a).normalize(); } }
    }
    const last = path[path.length - 1]; if (last && last.hit && !last.hit.catcher) laserHits.push({ p: last.b, n: last.hit.normal });
  }
  pool.end();
  if (burn > 0) ev.burn(burn, push);
}

// ---------------------------------------------------------------- hard-light bridge
const bridgeMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vP;
  void main(){ float x = abs(vUv.x - 0.5) * 2.0;
    float edge = smoothstep(0.86, 1.0, x);
    float lines = pow(abs(sin(vP.z * 6.0 - uTime * 3.0)), 30.0) * 0.5;
    float hexish = pow(abs(sin(vUv.x * 40.0) * sin(vP.z * 9.0)), 12.0) * 0.25;
    // edges peak around 1.5x in blue: bright hard light that keeps its colour instead of clipping to white
    float a = 0.16 + edge * 0.75 + lines + hexish;
    gl_FragColor = vec4(vec3(0.5, 0.8, 1.0) * (0.8 + edge * 0.9) * a, a); }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
});
registerBuilder('bridge', (e) => {
  const p = V3(e.p), d = V3(e.dir).normalize(), up = V3(e.up || [0, 1, 0]).normalize(), w = e.w || 1.3;
  const grp = new THREE.Group(); grp.position.copy(p); root.group.add(grp);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, d), up, d));
  grp.quaternion.copy(q);
  mesh(new THREE.BoxGeometry(w + 0.5, 0.5, 0.4), dark(), grp).position.set(0, -0.12, -0.155); // 4.5 cm proud of the wall; the slab starts inside it
  const slotM = new THREE.MeshStandardMaterial({ color: 0x111820, emissive: 0x8cd2ff, emissiveIntensity: 1.5 });
  const slot = mesh(new THREE.BoxGeometry(w, 0.06, 0.05), slotM, grp); slot.position.z = 0.01; slot.layers.enable(LAYER_FX);
  const mat = bridgeMat();
  const o = { e, p, d, up, w, mat, on: false, len: 0, sig: '', bodies: [], meshes: [], update(dt, _s, t) {
    const on = evalIn(e.in);
    if (on !== this.on) { this.on = on; ev.sfx(on ? 'bridgeOn' : 'bridgeOff', p); }
    mat.uniforms.uTime.value = t; slotM.emissiveIntensity = this.on ? 1.5 : 0.3;
  }, step(dt) {
    this.len = this.on ? Math.min(200, this.len + dt * 45) : 0;
    const segs = this.len > 0 ? castThrough(p.clone().addScaledVector(d, 0.02), d, this.len, { pred: (bx) => true, targets: rayBoxes.map((rb) => ({ hit: (a, b, m) => rayBox(a, b, rb.rec, m) })), hops: 4 }) : [];
    const key = segs.map((s) => s.a.toArray().concat(s.b.toArray()).map((v) => v.toFixed(2)).join(',')).join('|');
    if (key === this.sig) return;
    this.sig = key; this.rebuild(segs);
  }, rebuild(segs) {
    for (const b of this.bodies) { phys.world.removeBody(b); const i = root.bodies.indexOf(b); if (i >= 0) root.bodies.splice(i, 1); }
    for (const m of this.meshes) { grp.parent.remove(m); m.geometry.dispose(); }
    for (const r of this.recs || []) { const i = rayBoxes.indexOf(r); if (i >= 0) rayBoxes.splice(i, 1); }
    this.bodies = []; this.meshes = []; this.recs = [];
    let u = up.clone(), dir = d.clone();
    for (const s of segs) {
      const L = s.a.distanceTo(s.b); dir = s.b.clone().sub(s.a).normalize();
      if (L > 0.02) {
        const rgt = new THREE.Vector3().crossVectors(u, dir).normalize(); const uu = new THREE.Vector3().crossVectors(dir, rgt);
        const qq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(rgt, uu, dir));
        const c = s.a.clone().add(s.b).multiplyScalar(0.5).addScaledVector(uu, -0.04);
        // the slab stops 1 cm short of each end, so its end caps never sit in the plane of the surface it hits
        const geo = new THREE.BoxGeometry(w, 0.05, L - 0.02); const m = new THREE.Mesh(geo, mat); m.position.copy(c); m.quaternion.copy(qq); m.layers.set(LAYER_FX); m.renderOrder = 4;
        grp.parent.add(m); this.meshes.push(m);
        const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: phys.mat.world, collisionFilterGroup: GROUP.world });
        body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, 0.04, L / 2))); body.position.set(c.x, c.y, c.z); body.quaternion.set(qq.x, qq.y, qq.z, qq.w); body.isBridge = true;
        addBody(body); this.bodies.push(body);
        const rb = { rec: boxRec(c, new THREE.Vector3(w / 2, 0.04, L / 2), qq), tag: 'bridge' }; this.recs.push(rb);
      }
      if (s.gate !== undefined) u = xfDir(s.gate, u).normalize();
    }
  } };
  bridges.push(o); return o;
});

export function clearBeams() { lasers.length = 0; catchers.length = 0; relays.length = 0; bridges.length = 0; if (pool) pool.reset(); }
