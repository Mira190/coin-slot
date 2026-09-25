// Gels: dispensers spray blobs that fly (through gates) and paint what they hit. Spring gel bounces the player
// off floors and walls; slick gel lets the player build speed. Painted spots are instanced splat decals.
import * as THREE from 'three';
import { LAYER_FX } from './gfx.js';
import { GRAVITY } from './physics.js';
import { castThrough, xfDir } from './portals.js';
import { player, CENTER_H } from './player.js';
import { registerBuilder, evalIn, ev, root, mesh, rayBoxes } from './mech.js';
import { rayBox } from './world.js';

export const GEL = {
  bounce: { color: new THREE.Color(0x7a45ff), glow: new THREE.Color(0x5b2fd0) },
  speed: { color: new THREE.Color(0xff8a12), glow: new THREE.Color(0xd06a00) },
};
export const BOUNCE_MIN = 11, SPEED_MAX = 14;
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const MAX_SPLATS = 900, MAX_BLOBS = 260;

export const splats = []; // { p, n, r, kind }
const blobs = [];
let splatMesh = null, blobMesh = null, dirty = false;

function splatTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2, r = 46 + Math.sin(a * 3) * 7 + Math.sin(a * 7 + 1) * 5; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } g.fill();
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + 0.4, r = 50 + (i % 3) * 5; g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 5 + (i % 2) * 4, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); return t;
}
function ensureMeshes() {
  if (splatMesh && splatMesh.parent === root.group) return;
  const tex = splatTex();
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, alphaMap: tex, transparent: true, alphaTest: 0.35, roughness: 0.25, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0x000000, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });
  splatMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20), mat, MAX_SPLATS); splatMesh.count = 0; splatMesh.frustumCulled = false; splatMesh.receiveShadow = true;
  splatMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLATS * 3), 3);
  root.group.add(splatMesh);
  const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, emissive: 0xffffff, emissiveIntensity: 0.25 });
  blobMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), bm, MAX_BLOBS); blobMesh.count = 0; blobMesh.frustumCulled = false;
  blobMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOBS * 3), 3);
  root.group.add(blobMesh);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
export function paint(p, n, r, kind) {
  // replace any splat mostly covered by this one
  for (let i = splats.length - 1; i >= 0; i--) { const s = splats[i]; if (s.n.dot(n) > 0.9 && s.p.distanceTo(p) + s.r < r * 1.05) splats.splice(i, 1); } // fully covered
  if (splats.length >= MAX_SPLATS) splats.shift();
  splats.push({ p: p.clone(), n: n.clone(), r, kind, rot: Math.random() * Math.PI * 2 });
  dirty = true;
}
function rebuildSplats() {
  ensureMeshes(); dirty = false;
  splats.forEach((s, i) => {
    _q.setFromUnitVectors(_z, s.n).multiply(new THREE.Quaternion().setFromAxisAngle(_z, s.rot));
    _m.compose(s.p.clone().addScaledVector(s.n, 0.012 + (i % 7) * 0.0006), _q, _s.set(s.r, s.r, s.r)); splatMesh.setMatrixAt(i, _m);
    splatMesh.setColorAt(i, GEL[s.kind].color);
  });
  splatMesh.count = splats.length; splatMesh.instanceMatrix.needsUpdate = true; if (splatMesh.instanceColor) splatMesh.instanceColor.needsUpdate = true;
}

// Which gel covers point p on a surface with normal n (most recent wins)?
export function gelAt(p, n) {
  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i];
    if (s.n.dot(n) < 0.8) continue;
    const dx = p.x - s.p.x, dy = p.y - s.p.y, dz = p.z - s.p.z, along = dx * s.n.x + dy * s.n.y + dz * s.n.z;
    if (Math.abs(along) > 0.12) continue;
    if (dx * dx + dy * dy + dz * dz - along * along < s.r * s.r * 0.8) return s.kind;
  }
  return null;
}

// ---------------------------------------------------------------- dispensers and pre-painted areas
registerBuilder('gel', (e) => {
  const p = V3(e.p), kind = e.kind || 'bounce', dir = V3(e.dir || [0, -1, 0]).normalize();
  ensureMeshes();
  const grp = new THREE.Group(); grp.position.copy(p); grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir); root.group.add(grp);
  const pipeM = new THREE.MeshStandardMaterial({ color: 0x2b3034, metalness: 0.6, roughness: 0.4 });
  mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 20), pipeM, grp).position.y = 0.6;
  const lipM = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: GEL[kind].glow, emissiveIntensity: 1.5 });
  const lip = mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 24), lipM, grp); lip.rotation.x = Math.PI / 2; lip.layers.enable(LAYER_FX);
  return { e, acc: 0, on: false, update() { this.on = evalIn(e.in); lipM.emissiveIntensity = this.on ? 1.5 : 0.3; }, step(dt) {
    if (!this.on) return;
    this.acc += dt * (e.rate || 16);
    while (this.acc >= 1) {
      this.acc -= 1;
      if (blobs.length >= MAX_BLOBS) break;
      const sp = e.spread ?? 0.35, v = dir.clone().multiplyScalar(e.speed || 3).add(new THREE.Vector3((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp));
      blobs.push({ p: p.clone().addScaledVector(dir, 0.1).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), v, kind, life: 8 });
    }
  } };
});
// Pre-painted rectangle: c = centre on the surface, n = normal, size = [w, h] along the surface.
registerBuilder('paint', (e) => {
  const c = V3(e.c), n = V3(e.n).normalize(), [w, h] = e.size;
  const t1 = Math.abs(n.y) > 0.7 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize(); t1.crossVectors(t2, n).normalize();
  const r = 0.75, step = 0.9;
  for (let a = -w / 2 + step / 2; a <= w / 2; a += step) for (let b = -h / 2 + step / 2; b <= h / 2; b += step) {
    const jit = new THREE.Vector3().addScaledVector(t1, (Math.random() - 0.5) * 0.2).addScaledVector(t2, (Math.random() - 0.5) * 0.2);
    paint(c.clone().addScaledVector(t1, a).addScaledVector(t2, b).add(jit), n, r * (0.9 + Math.random() * 0.25), e.kind);
  }
  return { e, update() {} };
});

// ---------------------------------------------------------------- simulation
const _d = new THREE.Vector3();
export function gelStep(dt) {
  for (let i = blobs.length - 1; i >= 0; i--) {
    const b = blobs[i]; b.life -= dt;
    b.v.y -= GRAVITY * dt;
    const L = b.v.length() * dt; if (L < 1e-5) continue;
    _d.copy(b.v).normalize();
    const segs = castThrough(b.p, _d, L, { hops: 2, targets: rayBoxes.map((rb) => ({ hit: (o, d, m) => rayBox(o, d, rb.rec, m) })) });
    const last = segs[segs.length - 1];
    for (const s of segs) if (s.gate !== undefined) xfDir(s.gate, b.v, b.v);
    if (last.hit) {
      paint(last.hit.point, last.hit.normal, 0.75 + Math.random() * 0.45, b.kind);
      ev.fx('gel', last.hit.point, last.hit.normal, b.kind);
      if (Math.random() < 0.25) ev.sfx('splat', last.hit.point);
      blobs.splice(i, 1); continue;
    }
    b.p.copy(last.b);
    if (b.life <= 0 || b.p.y < -80) blobs.splice(i, 1);
  }
  applyToPlayer();
}

let bounceCool = 0;
function applyToPlayer() {
  bounceCool = Math.max(0, bounceCool - 1 / 120);
  if (!player.alive) return;
  const v = player.body.velocity, pv = player.preVel;
  let onSpeed = false;
  for (const c of player.contacts) {
    const n = new THREE.Vector3(c.nx, c.ny, c.nz), p = new THREE.Vector3(c.px, c.py, c.pz), k = gelAt(p, n);
    if (!k) continue;
    if (k === 'speed' && n.y > 0.6) onSpeed = true;
    if (k === 'bounce' && bounceCool <= 0) {
      if (n.y > 0.6) { // floor: reflect the fall, never less than the minimum
        const up = Math.max(-pv.y * 0.97, BOUNCE_MIN);
        v.y = up; player.grounded = false; player.coyote = 0; bounceCool = 0.15; ev.sfx('bounce', p); ev.fx('gel', p, n, 'bounce'); break;
      } else if (Math.abs(n.y) < 0.5) { // wall: kick back out and up
        const into = -(pv.x * n.x + pv.z * n.z);
        if (into > 1.5) { v.x = pv.x + n.x * into * 2; v.z = pv.z + n.z * into * 2; v.y = Math.max(v.y, 6); bounceCool = 0.2; ev.sfx('bounce', p); ev.fx('gel', p, n, 'bounce'); break; }
      }
    }
  }
  player.speedGel = onSpeed && player.grounded;
}

export function gelFrame() {
  ensureMeshes();
  if (dirty) rebuildSplats();
  blobs.forEach((b, i) => { _m.makeTranslation(b.p.x, b.p.y, b.p.z); blobMesh.setMatrixAt(i, _m); blobMesh.setColorAt(i, GEL[b.kind].color); });
  blobMesh.count = blobs.length; blobMesh.instanceMatrix.needsUpdate = true; if (blobMesh.instanceColor) blobMesh.instanceColor.needsUpdate = true;
}
export function clearGel() { splats.length = 0; blobs.length = 0; splatMesh = null; blobMesh = null; dirty = true; }
