// Folded Steps: procedural architecture and props: domes, turrets, arches, windows, topiary, lamps,
// flags, the goal gate, the glimmer, pressure plates and crank / slider handles. All geometry is built here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patch, FXU } from './render.js';

const cache = new Map();
// one patched standard material per colour/finish (shared, so the mist uniforms stay in sync)
export function mat(hex, o = {}) {
  const k = hex + JSON.stringify(o);
  if (cache.has(k)) return cache.get(k);
  const m = patch(new THREE.MeshStandardMaterial({ color: hex, roughness: o.rough ?? 0.82, metalness: o.metal ?? 0, flatShading: !!o.flat, emissive: o.emit || '#000000', emissiveIntensity: o.ei ?? 1, envMapIntensity: o.env ?? 0.6, transparent: !!o.alpha, opacity: o.alpha ?? 1, side: o.side ?? THREE.FrontSide }));
  cache.set(k, m);
  return m;
}
export const clearMats = () => { for (const m of cache.values()) m.dispose(); cache.clear(); };
const M = (g, m, cast = true) => { const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = true; return x; };

// a small deterministic hash for "random" placement that stays the same every build
export const hash = (a, b = 0, c = 0) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };

export function dome(P, big = false) {
  const g = new THREE.Group();
  const drum = M(new THREE.CylinderGeometry(0.4, 0.44, 0.28, 24), mat(P.stone));
  drum.position.y = -0.36;
  const cap = M(new THREE.SphereGeometry(0.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(P.roof, { rough: 0.55 }));
  cap.position.y = -0.22;
  const band = M(new THREE.TorusGeometry(0.405, 0.025, 6, 32), mat(P.acc));
  band.rotation.x = Math.PI / 2; band.position.y = -0.22;
  const fin = M(new THREE.ConeGeometry(0.035, 0.26, 8), mat(P.glow, { emit: P.glow, ei: 0.3 }));
  fin.position.y = 0.3;
  const ball = M(new THREE.SphereGeometry(0.05, 12, 8), mat(P.glow, { emit: P.glow, ei: 0.35 }));
  ball.position.y = 0.2;
  // arched windows around the drum
  for (let i = 0; i < 8; i++) {
    const w = M(new THREE.PlaneGeometry(0.09, 0.16), mat('#3b3350', { rough: 1 }), false);
    const a = (i / 8) * Math.PI * 2;
    w.position.set(Math.sin(a) * 0.442, -0.37, Math.cos(a) * 0.442);
    w.rotation.y = a;
    g.add(w);
  }
  g.add(drum, cap, band, fin, ball);
  if (big) g.scale.setScalar(1.25);
  return g;
}
export function turret(P) {
  const g = new THREE.Group();
  const body = M(new THREE.CylinderGeometry(0.3, 0.34, 0.9, 20), mat(P.stone));
  body.position.y = -0.05;
  const roof = M(new THREE.ConeGeometry(0.38, 0.55, 20), mat(P.roof, { rough: 0.6 }));
  roof.position.y = 0.67;
  const w = M(new THREE.PlaneGeometry(0.1, 0.2), mat('#3b3350', { rough: 1 }), false);
  w.position.set(0.23, 0.08, 0.23); w.rotation.y = Math.PI / 4;
  g.add(body, roof, w);
  return g;
}
// an archway block: a unit cube with a round-headed opening through it (open along x or z)
export function archGeo(axis = 'z') {
  // one outline with the opening notched up from the bottom edge (a hole touching the edge triangulates into flaps)
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5); s.lineTo(-0.26, -0.5); s.lineTo(-0.26, 0.06); s.absarc(0, 0.06, 0.26, Math.PI, 0, true);
  s.lineTo(0.26, -0.5); s.lineTo(0.5, -0.5); s.lineTo(0.5, 0.5); s.lineTo(-0.5, 0.5); s.lineTo(-0.5, -0.5);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -0.5);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  return g;
}
export function tree(P, k = 0) {
  const g = new THREE.Group();
  const trunk = M(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 6), mat('#8a6a5a'));
  trunk.position.y = 0.15;
  g.add(trunk);
  const lm = mat(P.leaf, { flat: true, rough: 0.9 });
  const n = 2 + Math.floor(hash(k, 3) * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.2 - i * 0.045;
    const b = M(new THREE.IcosahedronGeometry(r, 1), lm);
    b.position.set((hash(k, i) - 0.5) * 0.08, 0.34 + i * 0.2, (hash(i, k) - 0.5) * 0.08);
    g.add(b);
  }
  return g;
}
export function hedge(P) {
  const b = M(new THREE.BoxGeometry(0.86, 0.34, 0.86, 2, 1, 2), mat(P.leaf, { flat: true, rough: 0.95 }));
  b.position.y = 0.17;
  return b;
}
export function lamp(P) {
  const g = new THREE.Group();
  const post = M(new THREE.CylinderGeometry(0.025, 0.035, 0.42, 8), mat('#6b5d74'));
  post.position.y = 0.21;
  const orb = M(new THREE.SphereGeometry(0.075, 14, 10), mat(P.glow, { emit: P.glow, ei: 1.6 }), false);
  orb.position.y = 0.48;
  const cap = M(new THREE.ConeGeometry(0.08, 0.07, 10), mat('#6b5d74'));
  cap.position.y = 0.57;
  g.add(post, orb, cap);
  g.userData.orb = orb;
  return g;
}
// a pennant whose cloth waves in the vertex shader
export function flag(P) {
  const g = new THREE.Group();
  const pole = M(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6), mat('#7a6a80'));
  pole.position.y = 0.45;
  const cg = new THREE.PlaneGeometry(0.42, 0.2, 10, 2);
  cg.translate(0.21, 0, 0);
  const cm = patch(new THREE.MeshStandardMaterial({ color: P.handle, roughness: 0.7, side: THREE.DoubleSide }), {
    key: 'flag',
    vMain: '',
  });
  const base = cm.onBeforeCompile;
  cm.onBeforeCompile = (sh) => {
    base(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(position.x * 9.0 - uTime * 4.0) * 0.05 * position.x / 0.42;');
  };
  const cloth = M(cg, cm, false);
  cloth.position.y = 0.78;
  g.add(pole, cloth);
  return g;
}
export function windowPane(w = 0.22, h = 0.34) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2 - w / 2); s.absarc(0, h / 2 - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, -h / 2);
  return new THREE.ShapeGeometry(s, 10);
}

// ---------- interactive props ----------
export function plate(P) {
  const g = new THREE.Group();
  const slab = M(new THREE.BoxGeometry(0.72, 0.06, 0.72), mat(P.col));
  slab.position.y = 0.03;
  const ring = M(new THREE.TorusGeometry(0.2, 0.035, 8, 28), mat(P.glow, { emit: P.glow, ei: 0 }), false);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.065;
  const dot = M(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), mat(P.acc));
  dot.position.y = 0.068;
  g.add(slab, ring, dot);
  g.userData = { ring, slab };
  return g;
}
export function goalGate(P) {
  const g = new THREE.Group();
  const sm = mat(P.stone), am = mat(P.acc);
  for (const s of [-1, 1]) {
    const p = M(new THREE.BoxGeometry(0.1, 0.62, 0.1), sm);
    p.position.set(s * 0.33, 0.31, 0);
    g.add(p);
  }
  const arc = M(new THREE.TorusGeometry(0.33, 0.05, 8, 24, Math.PI), am);
  arc.position.y = 0.62;
  g.add(arc);
  const glyph = M(new THREE.OctahedronGeometry(0.13, 0), mat(P.glow, { emit: P.glow, ei: 2.2, rough: 0.3 }), false);
  glyph.position.y = 0.95;
  const halo = M(new THREE.TorusGeometry(0.22, 0.012, 6, 40), mat(P.glow, { emit: P.glow, ei: 1.5 }), false);
  halo.position.y = 0.95;
  g.add(glyph, halo);
  g.userData = { glyph, halo };
  return g;
}
export function glimmer(P) {
  const g = new THREE.Group();
  const m = mat('#ffffff', { emit: P.glow, ei: 2.4, rough: 0.2 });
  const a = M(new THREE.OctahedronGeometry(0.1, 0), m, false);
  const b = M(new THREE.OctahedronGeometry(0.07, 0), m, false);
  b.rotation.set(0.6, 0.6, 0);
  g.add(a, b);
  g.position.y = 0.36;
  return g;
}
// crank wheel for rotors: rim, spokes, hub and a knob to grab. Lies in the plane perpendicular to +y.
export function crank(P, r = 0.42) {
  const g = new THREE.Group();
  const hm = mat(P.handle, { rough: 0.45, env: 1 });
  const rim = M(new THREE.TorusGeometry(r, 0.045, 10, 40), hm);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  for (let i = 0; i < 4; i++) {
    const s = M(new THREE.CylinderGeometry(0.022, 0.022, r * 2, 6), hm);
    s.rotation.z = Math.PI / 2; s.rotation.y = (i * Math.PI) / 4;
    g.add(s);
  }
  const hub = M(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16), mat(P.glow, { emit: P.glow, ei: 0.25 }));
  g.add(hub);
  for (let i = 0; i < 4; i++) {
    const k = M(new THREE.SphereGeometry(0.07, 12, 8), hm);
    const a = (i * Math.PI) / 2;
    k.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.add(k);
  }
  return g;
}
export function sliderKnob(P, dir) {
  const g = new THREE.Group();
  const hm = mat(P.handle, { rough: 0.45, env: 1 });
  const k = M(new THREE.SphereGeometry(0.12, 16, 12), hm);
  g.add(k);
  const d = new THREE.Vector3(...dir).normalize();
  for (const s of [-1, 1]) {
    const c = M(new THREE.ConeGeometry(0.07, 0.14, 12), hm);
    c.position.copy(d).multiplyScalar(0.24 * s);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().multiplyScalar(s));
    g.add(c);
  }
  return g;
}
// grid inlay + cornice band on walkable faces, chevrons on gravity walls (the aW attribute selects)
export function stoneMat(hex) {
  return patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.55 }), {
    key: 'stone',
    vDecl: '\nattribute vec3 aF; varying vec3 vF;',
    vMain: '\nvF = aF;',
    fDecl: '\nvarying vec3 vF;',
    fMain: `
      { vec2 f = vF.xy; float kind = vF.z; vec2 e = min(f, 1.0 - f); float edge = min(e.x, e.y);
        if (kind > 0.5 && kind < 1.5) { // walkable top: soft inlay a little inside the edge
          float l = smoothstep(0.035, 0.0, abs(edge - 0.07)) * 0.08; gl_FragColor.rgb *= 1.0 - l; gl_FragColor.rgb *= 1.0 + smoothstep(0.05, 0.0, edge) * 0.05; }
        else if (kind > 1.5 && kind < 2.5) { // side face: cornice band near the top
          float band = smoothstep(0.86, 0.9, f.y) * (1.0 - smoothstep(0.97, 1.0, f.y));
          gl_FragColor.rgb *= 1.0 + band * 0.1; gl_FragColor.rgb *= 1.0 - smoothstep(0.84, 0.86, f.y) * (1.0 - smoothstep(0.86, 0.88, f.y)) * 0.18; }
        else if (kind > 2.5 && kind < 3.5) { // gravity wall: chevrons that point "up" the wall
          float c = fract((f.y + abs(f.x - 0.5)) * 3.0 - uTime * 0.12); float ch = smoothstep(0.0, 0.08, c) * (1.0 - smoothstep(0.18, 0.26, c));
          gl_FragColor.rgb *= 1.0 + ch * 0.16; gl_FragColor.rgb *= 1.0 - smoothstep(0.04, 0.0, edge) * 0.12; }
      }`,
  });
}
export { mergeGeometries, FXU };
