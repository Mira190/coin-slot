// Shared singletons (renderer, scene, camera), math helpers and procedural-texture utilities.
import * as THREE from 'three';
import { mergeGeometries as _merge } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE };
export const V3 = THREE.Vector3;
export const UP = new V3(0, 1, 0);
export const $ = (s) => document.querySelector(s);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const fract = (x) => x - Math.floor(x);
export const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
export const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
export const TAU = Math.PI * 2;
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// seeded PRNG so the island, town and feathers are the same every visit
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// smooth 2D value noise + fbm (terrain, textures)
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); }
// tileable value noise over a period p (for seamless textures)
export function tnoise(x, y, p) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (n) => ((n % p) + p) % p;
  const a = hash2(m(xi), m(yi)), b = hash2(m(xi + 1), m(yi)), c = hash2(m(xi), m(yi + 1)), d = hash2(m(xi + 1), m(yi + 1));
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function tfbm(x, y, p, oct = 4) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * tnoise(x * f, y * f, p * f); n += a; f *= 2; a *= 0.5; } return s / n; }

export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
export const store = {
  get(k) { try { return localStorage.getItem('pelican-pedal.' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('pelican-pedal.' + k, v); } catch (e) { /* private mode */ } },
};

// scratch objects
export const _v = new V3(), _v2 = new V3(), _v3 = new V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _c = new THREE.Color();

// ---------------------------------------------------------------- renderer
export let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  const el = $('#err'); if (el) { el.hidden = false; el.textContent = 'WebGL is not available in this browser, so the ride cannot start.'; }
  throw e;
}
export const DPR = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(Math.min(DPR, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.transmissionResolutionScale = 0.5;
renderer.domElement.tabIndex = -1;
renderer.domElement.setAttribute('aria-label', 'A pelican riding a bicycle along an island coast road');
renderer.domElement.setAttribute('role', 'img');
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xd8a080, 0.0012);
export const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 20000);
camera.position.set(4, 2, 6);
camera.layers.enable(1); // layer 1: small things kept out of the water reflection
export const MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

// ---------------------------------------------------------------- textures
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function canvasTex(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = canvas(w, h); draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// RGBA byte array -> texture
export function dataTex(data, w, h, { srgb = false, repeat = true } = {}) {
  const t = new THREE.DataTexture(data, w, h); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = MAX_ANISO; t.needsUpdate = true; return t;
}
// tangent-space normal map from a height field (Float32Array W*H, tiling)
export function normalFromHeight(hts, W, H, strength = 2, wrap = true) {
  const d = new Uint8Array(W * H * 4);
  const at = (x, y) => { if (wrap) { x = (x + W) % W; y = (y + H) % H; } else { x = clamp(x, 0, W - 1); y = clamp(y, 0, H - 1); } return hts[y * W + x]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (at(x - 1, y) - at(x + 1, y)) * strength, ny = (at(x, y + 1) - at(x, y - 1)) * strength, k = 1 / Math.hypot(nx, ny, 1);
    const i = (y * W + x) * 4; d[i] = (nx * k * 0.5 + 0.5) * 255; d[i + 1] = (ny * k * 0.5 + 0.5) * 255; d[i + 2] = (k * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return dataTex(d, W, H, { repeat: wrap });
}
export function heightToNormal(W, H, hf, strength = 2) {
  const hts = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hts[y * W + x] = hf(x, y);
  return normalFromHeight(hts, W, H, strength);
}

// ---------------------------------------------------------------- geometry helpers
export const noReflect = (o) => { o.traverse((c) => c.layers.set(1)); return o; };
export function mesh(geo, mat, cast = true, receive = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; return m; }
// place a unit-height Y cylinder between a and b
export function placeLimb(m, a, b, r = 1) {
  _v.subVectors(b, a); const len = _v.length() || 1e-5;
  m.position.addVectors(a, b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(UP, _v.divideScalar(len)); m.scale.set(r, len, r);
}
// baked cylinder between two points (for merging)
export function tubeGeo(a, b, r, r2 = r, seg = 12) {
  const g = new THREE.CylinderGeometry(r2, r, 1, seg, 1, false);
  const o = new THREE.Object3D(); placeLimb(o, a, b); o.updateMatrix(); return g.applyMatrix4(o.matrix);
}
export function xf(g, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) { return g.applyMatrix4(_m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _v2.set(s, s, s))); }
export function colorize(geo, fn) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(col, p.getX(i), p.getY(i), p.getZ(i), i); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}
export const ni = (g) => (g.index ? g.toNonIndexed() : g);

// shortest-arc helper: quaternion that rotates frame (f0 forward, u0 up) to (f, u)
const _mb = new THREE.Matrix4(), _x = new V3(), _y = new V3(), _z = new V3();
export function basisQuat(q, fwd, up) {
  _z.copy(fwd).normalize(); _x.crossVectors(up, _z).normalize(); _y.crossVectors(_z, _x);
  _mb.makeBasis(_x, _y, _z); return q.setFromRotationMatrix(_mb);
}

// 2-bone IK in a plane given by a pole direction. Returns the middle joint in `out`.
// a: root, t: target, l1/l2 bone lengths, pole: direction the joint should bend towards.
export function ik2(a, t, l1, l2, pole, out) {
  _v.subVectors(t, a); let d = _v.length(); const dir = _v.divideScalar(d || 1);
  d = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _v2.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  return out.copy(a).addScaledVector(dir, x).addScaledVector(_v2, h);
}

// fixed-size event emitter used across modules
export const bus = {
  h: {},
  on(k, f) { (this.h[k] = this.h[k] || []).push(f); },
  emit(k, a, b) { const l = this.h[k]; if (l) for (const f of l) f(a, b); },
};

// Merge the static meshes under `root` into one mesh per material (fewer draw calls).
// `keep(obj)` protects animated sub-trees (wheels, cranks, steering...), which stay as they are.
export function bakeStatic(root, keep = () => false) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), groups = new Map(), victims = [];
  const visit = (o) => {
    for (const c of o.children) {
      if (keep(c)) continue;
      if (c.isMesh && !c.isInstancedMesh && !c.isSkinnedMesh && c.geometry && !Array.isArray(c.material)) {
        const g = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const key = c.material.uuid + (g.attributes.color ? ':c' : '') + (c.castShadow ? ':s' : '') + (c.receiveShadow ? ':r' : '') + ':' + c.renderOrder;
        if (!groups.has(key)) groups.set(key, { mat: c.material, cast: c.castShadow, recv: c.receiveShadow, order: c.renderOrder, geos: [] });
        groups.get(key).geos.push(g); victims.push(c);
      }
      visit(c);
    }
  };
  visit(root);
  for (const v of victims) v.parent.remove(v);
  for (const G of groups.values()) {
    const m = new THREE.Mesh(G.geos.length > 1 ? _merge(G.geos) : G.geos[0], G.mat);
    m.castShadow = G.cast; m.receiveShadow = G.recv; m.renderOrder = G.order; root.add(m);
  }
  // prune empty groups
  const prune = (o) => { for (const c of [...o.children]) { if (keep(c)) continue; prune(c); if (!c.isMesh && !c.isLight && !c.isInstancedMesh && c.children.length === 0 && c.type === 'Group') o.remove(c); } };
  prune(root);
  return root;
}
