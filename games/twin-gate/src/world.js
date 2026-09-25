// Static chamber geometry: box records, merged meshes per material, colliders, ray casts and point queries.
// Surfaces: W = light panel (gates stick), M = dark metal, C = concrete, G = glass.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G } from './gfx.js';
import { whitePanel, whiteFloor, darkMetal, metalFloor, concrete, lampLouvre, facade } from './textures.js';
import { phys } from './physics.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- gate holes in world materials
// Every world material discards fragments inside a linked gate's opening (and a thin slab behind it),
// so the gate's view shows through the wall. Written by portals.js each frame.
export const holeU = {
  uPC: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  uPN: { value: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)] },
  uPR: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 0)] },
  uPU: { value: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)] },
  uPS: { value: [new THREE.Vector4(1, 1, 0.2, 0), new THREE.Vector4(1, 1, 0.2, 0)] },
};
export function patchHoles(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, holeU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHoleW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vHoleW; uniform vec3 uPC[2]; uniform vec3 uPN[2]; uniform vec3 uPR[2]; uniform vec3 uPU[2]; uniform vec4 uPS[2];`)
      .replace('void main() {', `void main() {
  for (int i = 0; i < 2; i++) {
    if (uPS[i].w > 0.5) {
      vec3 d = vHoleW - uPC[i]; float dn = dot(d, uPN[i]);
      if (dn < 0.004 && dn > -uPS[i].z) { float x = dot(d, uPR[i]) / uPS[i].x, y = dot(d, uPU[i]) / uPS[i].y; if (x * x + y * y < 1.0) discard; }
    }
  }`);
  };
  mat.customProgramCacheKey = () => 'holes';
  return mat;
}

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const mk = (tex, o) => patchHoles(new THREE.MeshStandardMaterial({ ...tex, ...o }));
  const wp = whitePanel(), wf = whiteFloor(), dm = darkMetal(), mf = metalFloor(), cc = concrete();
  MATS = {
    Wwall: mk(wp, { color: 0xffffff, metalness: 0.0, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) }),
    Wfloor: mk(wf, { color: 0xf2f2ee, metalness: 0.0, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }),
    // metal is lit mostly by reflection: it keeps its own (stronger) environment so it stays readable under the low lab ambient
    Mwall: mk(dm, { color: 0xffffff, metalness: 0.55, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9), envMap: G.scene.environment, envMapIntensity: 0.85 }),
    Mfloor: mk(mf, { color: 0xffffff, metalness: 0.6, roughness: 1, normalScale: new THREE.Vector2(1, 1), envMap: G.scene.environment, envMapIntensity: 0.85 }),
    C: mk(cc, { color: 0xffffff, metalness: 0.0, roughness: 1 }),
    G: new THREE.MeshStandardMaterial({ color: 0xbfe6ef, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.07, depthWrite: false, envMapIntensity: 0.55 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xf4f8ff, emissiveMap: lampLouvre(), emissiveIntensity: 1.5 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2a2e31, metalness: 0.7, roughness: 0.4 }),
  };
  return MATS;
}
export function worldMats() { return mats(); }

const SPAN = 2; // metres covered by one texture repeat

// ---------------------------------------------------------------- the world
export const world = {
  boxes: [], group: null, bounds: new THREE.Box3(), bodies: [],

  clear() {
    if (this.group) { G.scene.remove(this.group); this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    for (const b of this.bodies) phys.world.removeBody(b);
    this.boxes = []; this.bodies = []; this.group = null; this.bounds.makeEmpty();
  },

  // level.boxes: [x0,y0,z0,x1,y1,z1,s,flags]; level.obbs: {c,h,r(deg),s,flags}
  build(level) {
    this.clear();
    mats();
    const group = new THREE.Group(); group.name = 'world'; this.group = group;
    for (const b of level.boxes) {
      const [x0, y0, z0, x1, y1, z1, s = 'M', f = ''] = b;
      const min = new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
      const max = new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
      if (max.x - min.x < 1e-4 || max.y - min.y < 1e-4 || max.z - min.z < 1e-4) continue;
      const c = min.clone().add(max).multiplyScalar(0.5), h = max.clone().sub(min).multiplyScalar(0.5);
      this.boxes.push({ aabb: true, min, max, c, h, q: new THREE.Quaternion(), qi: new THREE.Quaternion(), s, nc: f.includes('n'), hid: f.includes('h') });
    }
    for (const o of level.obbs || []) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.r.map((d) => d * Math.PI / 180), 'YXZ'));
      const c = new THREE.Vector3(...o.c), h = new THREE.Vector3(...o.h);
      const bb = new THREE.Box3(); for (let i = 0; i < 8; i++) bb.expandByPoint(new THREE.Vector3(i & 1 ? h.x : -h.x, i & 2 ? h.y : -h.y, i & 4 ? h.z : -h.z).applyQuaternion(q).add(c));
      this.boxes.push({ aabb: false, min: bb.min, max: bb.max, c, h, q, qi: q.clone().invert(), s: o.s || 'M', nc: (o.f || '').includes('n'), hid: false });
    }
    // merged render geometry per material and shadow flag
    const buckets = new Map();
    const bucket = (key, cast) => { const k = key + (cast ? '+' : '-'); if (!buckets.has(k)) buckets.set(k, { key, cast, p: [], n: [], uv: [] }); return buckets.get(k); };
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    for (const bx of this.boxes) {
      this.bounds.expandByPoint(bx.min).expandByPoint(bx.max);
      if (bx.hid) continue;
      for (let f = 0; f < 6; f++) {
        const ax = f >> 1, sg = f & 1 ? 1 : -1;
        nn.set(0, 0, 0).setComponent(ax, sg).applyQuaternion(bx.q);
        const floor = nn.y > 0.7;
        const key = bx.s === 'W' ? (floor ? 'Wfloor' : 'Wwall') : bx.s === 'M' ? (floor ? 'Mfloor' : 'Mwall') : bx.s;
        const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
        if (bx.aabb && faceBuried(this, bx, ax, sg, a1, a2)) continue;
        const bk = bucket(key, !bx.nc && bx.s !== 'G');
        // face-plane axes: u along a horizontal axis where possible, v up
        let ua = ax === 1 ? 0 : (ax === 0 ? 2 : 0), va = ax === 1 ? 2 : 1;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const quad = [];
        for (const [s1, s2] of corners) {
          const loc = new THREE.Vector3(); loc.setComponent(ax, sg * bx.h.getComponent(ax)); loc.setComponent(a1, s1 * bx.h.getComponent(a1)); loc.setComponent(a2, s2 * bx.h.getComponent(a2));
          const w = loc.clone().applyQuaternion(bx.q).add(bx.c);
          const src = bx.aabb ? w : loc.clone().add(bx.h);
          quad.push({ w, u: src.getComponent(ua) / SPAN, vv: src.getComponent(va) / SPAN });
        }
        // winding: make the triangle normal agree with nn
        const e1 = quad[1].w.clone().sub(quad[0].w), e2 = quad[2].w.clone().sub(quad[0].w);
        const order = e1.cross(e2).dot(nn) > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const i of order) { const q = quad[i]; bk.p.push(q.w.x, q.w.y, q.w.z); bk.n.push(nn.x, nn.y, nn.z); bk.uv.push(q.u, q.vv); }
      }
    }
    for (const bk of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bk.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, MATS[bk.key]); m.name = 'world:' + bk.key; m.castShadow = bk.cast; m.receiveShadow = bk.key !== 'G';
      if (bk.key === 'G') m.renderOrder = 5;
      group.add(m);
    }
    // ceiling light fixtures: a grid under every ceiling slab, wherever there is open air below
    const lampG = [], trimG = [], _p = new THREE.Vector3();
    for (const bx of this.boxes) {
      if (!bx.nc || !bx.aabb || bx.s === 'G') continue;
      const x0 = bx.min.x + 1.6, x1 = bx.max.x - 1.6, z0 = bx.min.z + 1.6, z1 = bx.max.z - 1.6;
      if (x1 < x0 || z1 < z0) continue;
      const alongX = x1 - x0 >= z1 - z0, nx = Math.floor((x1 - x0) / 5.5) + 1, nz = Math.floor((z1 - z0) / 5.5) + 1;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = nx === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * i / (nx - 1), z = nz === 1 ? (z0 + z1) / 2 : z0 + (z1 - z0) * j / (nz - 1), y = bx.min.y;
        if (this.solidAt(_p.set(x, y - 0.3, z)) || this.solidAt(_p.set(x, y - 2.5, z))) continue;
        const w = alongX ? 2.6 : 0.9, d = alongX ? 0.9 : 2.6;
        const lg = new THREE.BoxGeometry(w, 0.05, d), uv = lg.attributes.uv; // whole 0.3 m louvre cells across the face
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * Math.round(w / 0.3) / 2, uv.getY(k) * Math.round(d / 0.3) / 2);
        lampG.push(lg.translate(x, y - 0.035, z));
        trimG.push(new THREE.BoxGeometry(w + 0.18, 0.06, d + 0.18).translate(x, y - 0.02, z)); // ends 1 cm above the lamp face (no z-fight)
      }
    }
    // glass gets thin dark frames on its edges so it reads as glass, not haze
    for (const bx of this.boxes) {
      if (bx.s !== 'G') continue;
      const s = bx.h.clone().multiplyScalar(2), t = 0.05;
      for (let a = 0; a < 3; a++) for (const u of [-1, 1]) for (const v of [-1, 1]) {
        const size = [t, t, t]; size[a] = s.getComponent(a) + (a === 0 ? t : -t); // butt joints: overlapping corners would z-fight
        const off = [0, 0, 0]; off[(a + 1) % 3] = u * bx.h.getComponent((a + 1) % 3); off[(a + 2) % 3] = v * bx.h.getComponent((a + 2) % 3);
        trimG.push(new THREE.BoxGeometry(...size).translate(bx.c.x + off[0], bx.c.y + off[1], bx.c.z + off[2]));
      }
    }
    // render-only scenery (the skyline around the lab in the finale): no colliders, not in ray casts
    if (level.decor && level.decor.length) {
      const tint = new THREE.Color();
      const dg = level.decor.map(([x0, y0, z0, x1, y1, z1], k) => {
        const w = x1 - x0, h = y1 - y0, d = z1 - z0, g = new THREE.BoxGeometry(w, h, d).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        // facade UVs in metres (one repeat = 5 m x 7 m); roofs (faces 2, 3) sample the plain frame colour
        const uv = g.attributes.uv, S = [[d, h], [d, h], null, null, [w, h], [w, h]];
        for (let i = 0; i < uv.count; i++) { const s = S[i >> 2]; uv.setXY(i, s ? uv.getX(i) * s[0] / 5 : 0.02, s ? uv.getY(i) * s[1] / 7 : 0.02); }
        tint.setHSL(0.08 + ((k * 0.37) % 1) * 0.5, 0.06, 0.62 + ((k * 0.61) % 1) * 0.3);
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(0).flatMap(() => [tint.r, tint.g, tint.b]), 3));
        g.setIndex([...g.index.array].filter((_, i) => (i / 6 | 0) !== 3)); // no bottoms: never seen, and they share one plane
        return g;
      });
      const dm = new THREE.Mesh(mergeGeometries(dg), new THREE.MeshStandardMaterial({ ...facade(), vertexColors: true, roughness: 1, metalness: 0.05 }));
      dm.name = 'world:skyline'; dm.receiveShadow = true; group.add(dm);
    }
    if (lampG.length) { const lm = new THREE.Mesh(mergeGeometries(lampG), MATS.lamp); lm.name = 'world:lamp'; group.add(lm); }
    if (trimG.length) { const tm = new THREE.Mesh(mergeGeometries(trimG), MATS.trim); tm.name = 'world:trim'; tm.castShadow = true; group.add(tm); }
    G.scene.add(group);
    // colliders: one static body per box
    for (const bx of this.boxes) {
      const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: phys.mat.world });
      body.addShape(new CANNON.Box(new CANNON.Vec3(bx.h.x, bx.h.y, bx.h.z)));
      body.position.set(bx.c.x, bx.c.y, bx.c.z); body.quaternion.set(bx.q.x, bx.q.y, bx.q.z, bx.q.w);
      body.box = bx; bx.body = body;
      phys.world.addBody(body); this.bodies.push(body);
    }
  },

  // Is the point inside a static box? Returns the box (optionally filtered).
  solidAt(p, pred) {
    for (const b of this.boxes) {
      if (p.x < b.min.x || p.y < b.min.y || p.z < b.min.z || p.x > b.max.x || p.y > b.max.y || p.z > b.max.z) continue;
      if (b.aabb) { if (!pred || pred(b)) return b; continue; }
      _l.copy(p).sub(b.c).applyQuaternion(b.qi);
      if (Math.abs(_l.x) <= b.h.x && Math.abs(_l.y) <= b.h.y && Math.abs(_l.z) <= b.h.z && (!pred || pred(b))) return b;
    }
    return null;
  },

  // Nearest static hit along a ray. Returns { t, point, normal, box } or null.
  raycast(o, d, maxT = 500, pred) {
    let best = null;
    for (const b of this.boxes) {
      if (pred && !pred(b)) continue;
      const h = rayBox(o, d, b, best ? best.t : maxT);
      if (h) best = h;
    }
    return best;
  },
};
const _l = new THREE.Vector3();

// A face is skipped when points just outside it (centre and 8 around) all sit inside other solid boxes.
const _fp = new THREE.Vector3();
function faceBuried(w, bx, ax, sg, a1, a2) {
  for (const [s1, s2] of [[0, 0], [-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9], [0, 0.9], [0, -0.9], [0.9, 0], [-0.9, 0]]) {
    _fp.copy(bx.c); _fp.setComponent(ax, bx.c.getComponent(ax) + sg * (bx.h.getComponent(ax) + 0.01));
    _fp.setComponent(a1, bx.c.getComponent(a1) + s1 * bx.h.getComponent(a1)); _fp.setComponent(a2, bx.c.getComponent(a2) + s2 * bx.h.getComponent(a2));
    if (!w.solidAt(_fp, (o) => o !== bx && o.s !== 'G')) return false;
  }
  return true;
}

// Ray vs (oriented) box using the slab method in box space.
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
export function rayBox(o, d, b, maxT) {
  _o.copy(o).sub(b.c); _d.copy(d);
  if (!b.aabb) { _o.applyQuaternion(b.qi); _d.applyQuaternion(b.qi); }
  let t0 = -Infinity, t1 = Infinity, ax0 = -1, sg0 = 0;
  for (let a = 0; a < 3; a++) {
    const oa = _o.getComponent(a), da = _d.getComponent(a), h = b.h.getComponent(a);
    if (Math.abs(da) < 1e-9) { if (oa < -h || oa > h) return null; continue; }
    let ta = (-h - oa) / da, tb = (h - oa) / da, s = -1;
    if (ta > tb) { const tt = ta; ta = tb; tb = tt; s = 1; }
    if (ta > t0) { t0 = ta; ax0 = a; sg0 = s; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (t0 < 0 || t0 > maxT || ax0 < 0) return null; // starting inside a box counts as no hit
  const normal = new THREE.Vector3().setComponent(ax0, sg0);
  if (!b.aabb) normal.applyQuaternion(b.q);
  return { t: t0, point: o.clone().addScaledVector(d, t0), normal, box: b };
}

// ---------------------------------------------------------------- AABB helpers for level authoring
// Subtract box `h` from each box in `list` (keeps surface/flags); returns the new list.
export function carve(list, h) {
  const out = [];
  for (const b of list) {
    const [x0, y0, z0, x1, y1, z1, s, f] = b;
    if (h[0] >= x1 || h[3] <= x0 || h[1] >= y1 || h[4] <= y0 || h[2] >= z1 || h[5] <= z0) { out.push(b); continue; }
    const cx0 = Math.max(x0, h[0]), cx1 = Math.min(x1, h[3]), cy0 = Math.max(y0, h[1]), cy1 = Math.min(y1, h[4]);
    if (x0 < cx0) out.push([x0, y0, z0, cx0, y1, z1, s, f]);
    if (cx1 < x1) out.push([cx1, y0, z0, x1, y1, z1, s, f]);
    if (y0 < cy0) out.push([cx0, y0, z0, cx1, cy0, z1, s, f]);
    if (cy1 < y1) out.push([cx0, cy1, z0, cx1, y1, z1, s, f]);
    if (z0 < h[2]) out.push([cx0, cy0, z0, cx1, cy1, h[2], s, f]);
    if (h[5] < z1) out.push([cx0, cy0, h[5], cx1, cy1, z1, s, f]);
  }
  return out;
}
