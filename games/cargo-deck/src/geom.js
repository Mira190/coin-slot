// Geometry batching: primitives are collected per material key and merged into one mesh per key,
// so the whole ship draws in a few dozen calls. Boxes get world-aligned UVs (continuous texturing
// across neighbouring pieces) or per-face 0..1 UVs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Build a box geometry (24 verts) at world position with yaw ry.
// faces: function(faceName, normalWorld, centerWorld) -> materialKey | null (skip face). Returns {key: BufferGeometry}.
// uv: 'world' (metres * scale along world-projected face axes) or 'unit'
export function boxFaces(x, y, z, sx, sy, sz, ry, faces, uv = 'world', scale = 1) {
  const cs = Math.cos(ry), sn = Math.sin(ry);
  // local axes in world
  const ax = [cs, 0, -sn], ay = [0, 1, 0], az = [sn, 0, cs];
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const P = (u, v, w) => [x + ax[0] * u + az[0] * w, y + v, z + ax[2] * u + az[2] * w];
  const defs = [
    ['px', [1, 0, 0], (a, b) => [hx, b * hy, -a * hz], [0, 0, -1], [0, 1, 0], sz, sy],
    ['nx', [-1, 0, 0], (a, b) => [-hx, b * hy, a * hz], [0, 0, 1], [0, 1, 0], sz, sy],
    ['py', [0, 1, 0], (a, b) => [a * hx, hy, -b * hz], [1, 0, 0], [0, 0, -1], sx, sz],
    ['ny', [0, -1, 0], (a, b) => [a * hx, -hy, b * hz], [1, 0, 0], [0, 0, 1], sx, sz],
    ['pz', [0, 0, 1], (a, b) => [a * hx, b * hy, hz], [1, 0, 0], [0, 1, 0], sx, sy],
    ['nz', [0, 0, -1], (a, b) => [-a * hx, b * hy, -hz], [-1, 0, 0], [0, 1, 0], sx, sy],
  ];
  const out = {};
  for (const [name, nl, corner, tl, bl, fw, fh] of defs) {
    const nw = [ax[0] * nl[0] + az[0] * nl[2], nl[1], ax[2] * nl[0] + az[2] * nl[2]];
    const c = corner(0, 0), cw = P(c[0], c[1], c[2]);
    const key = faces(name, nw, cw, fw, fh);
    if (!key) continue;
    const tw = [ax[0] * tl[0] + az[0] * tl[2], tl[1], ax[2] * tl[0] + az[2] * tl[2]];
    const bw = [ax[0] * bl[0] + az[0] * bl[2], bl[1], ax[2] * bl[0] + az[2] * bl[2]];
    const pos = [], nor = [], uvs = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const l = corner(a, b), w = P(l[0], l[1], l[2]);
      pos.push(...w); nor.push(...nw);
      if (uv === 'unit') uvs.push((a + 1) / 2, (b + 1) / 2);
      else uvs.push((w[0] * tw[0] + w[1] * tw[1] + w[2] * tw[2]) * scale, (w[0] * bw[0] + w[1] * bw[1] + w[2] * bw[2]) * scale);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    (out[key] || (out[key] = [])).push(g);
  }
  return out;
}

export class Batch {
  constructor() { this.parts = new Map(); }
  push(key, g) {
    if (!g.index) { const n = g.attributes.position.count, idx = []; for (let i = 0; i < n; i++) idx.push(i); g.setIndex(idx); }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    let a = this.parts.get(key);
    if (!a) this.parts.set(key, (a = []));
    a.push(g);
  }
  // box with one material (or a faces() function); uv scale in texture repeats per metre
  box(key, x, y, z, sx, sy, sz, ry = 0, uv = 'world', scale = 1) {
    const f = typeof key === 'function' ? key : () => key;
    const r = boxFaces(x, y, z, sx, sy, sz, ry, f, uv, scale);
    for (const k in r) for (const g of r[k]) this.push(k, g);
  }
  // box from two opposite corners (axis aligned; either order: a negative size would build it inside out)
  aabb(key, x0, y0, z0, x1, y1, z1, uv = 'world', scale = 1) {
    this.box(key, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 0, uv, scale);
  }
  // cylinder between two points
  cyl(key, a, b, r, seg = 8, r2 = r, caps = true) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const d = B.clone().sub(A), L = d.length();
    const g = new THREE.CylinderGeometry(r2, r, L, seg, 1, !caps);
    _q.setFromUnitVectors(UP, d.normalize());
    _m.compose(_p.copy(A).lerp(B, 0.5), _q, _s.set(1, 1, 1));
    g.applyMatrix4(_m);
    this.push(key, g);
  }
  // any geometry with a transform
  geo(key, g, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const e = new THREE.Euler(rx, ry, rz, 'YXZ');
    _m.compose(_p.set(x, y, z), _q.setFromEuler(e), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    this.push(key, g);
  }
  build(mats, opts = {}) {
    const group = new THREE.Group();
    for (const [key, list] of this.parts) {
      const mat = mats[key];
      if (!mat) { console.warn('no material', key); continue; }
      const g = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = key;
      const o = (opts[key] || opts['*'] || {});
      m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false;
      group.add(m);
    }
    this.parts.clear();
    return group;
  }
}

// Collapse the mesh children of `parent` into one mesh per bucket to save draw calls.
// Textured materials keep their own bucket; plain-colour materials are baked into vertex colours and share
// `solid` (a MeshStandardMaterial with vertexColors). Only direct children are merged (bones stay bones).
export function mergeChildren(parent, solid) {
  const buckets = new Map();
  const kids = parent.children.filter((c) => c.isMesh && c.children.length === 0);
  if (kids.length < 2) return;
  for (const m of kids) {
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.clone() : m.geometry.clone();
    g.applyMatrix4(m.matrix);
    const textured = !!m.material.map;
    const key = textured ? m.material.uuid : 'solid';
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) { const n = g.attributes.position.count, idx = []; for (let i = 0; i < n; i++) idx.push(i); g.setIndex(idx); }
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: textured ? m.material : solid, list: [] }));
    b.list.push({ g, color: m.material.color });
  }
  const colored = (b) => b.mat === solid;
  for (const b of buckets.values()) {
    const geos = b.list.map(({ g, color }) => {
      if (colored(b)) {
        const n = g.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
        g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      } else if (b.list.some((x) => x.g.attributes.color)) g.deleteAttribute('color');
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = true;
    parent.add(mesh);
  }
  for (const m of kids) parent.remove(m);
}
// Merge every mesh under `root` (any depth) into one mesh per material, in root's local space.
export function mergeDeep(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map(), meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) { const n = g.attributes.position.count, idx = []; for (let i = 0; i < n; i++) idx.push(i); g.setIndex(idx); }
    let l = byMat.get(m.material); if (!l) byMat.set(m.material, (l = [])); l.push(g);
  }
  for (const m of meshes) m.parent.remove(m);
  for (const c of [...root.children]) if (!c.isMesh && c.children.length === 0) root.remove(c);
  for (const [mat, list] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
    list.forEach((g) => g.dispose());
    mesh.castShadow = true;
    root.add(mesh);
  }
}
