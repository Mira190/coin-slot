// Particles (one additive point cloud) and short-lived light flashes: gate open/close bursts, shot tracers,
// sparks, fizzles, bubbles, dust and gel splashes.
import * as THREE from 'three';
import { G, LAYER_FX } from './gfx.js';
import { dotSprite } from './textures.js';

const MAX = 4000;
const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3), size = new Float32Array(MAX), alpha = new Float32Array(MAX);
const P = []; // live particles: { p, v, life, max, size, c, g, drag, fade }
let points = null;

export function initEffects() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: dotSprite() }, uScale: { value: 600 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  points = new THREE.Points(geo, mat); points.frustumCulled = false; points.layers.set(LAYER_FX); points.renderOrder = 8;
  G.scene.add(points);
}

const _c = new THREE.Color();
export function emit(p, v, o = {}) {
  if (P.length >= MAX) P.shift();
  P.push({ p: p.clone(), v: v.clone(), life: o.life || 0.8, max: o.life || 0.8, size: o.size || 0.08, c: _c.set(o.color ?? 0xffffff).clone().multiplyScalar(o.bright || 2), g: o.g ?? 0, drag: o.drag ?? 1.5, fade: o.fade ?? 1 });
}
const rnd = (s = 1) => (Math.random() * 2 - 1) * s;
const rvec = (s = 1) => new THREE.Vector3(rnd(s), rnd(s), rnd(s));

// Named effects. n = surface normal where relevant.
export function fx(kind, p, n, extra) {
  n = n || new THREE.Vector3(0, 1, 0);
  switch (kind) {
    case 'gateOpen': { // extra = gate
      const g = extra, color = extra.color;
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2, e = g.c.clone().addScaledVector(g.r, Math.cos(a) * g.a).addScaledVector(g.u, Math.sin(a) * g.b);
        const out = new THREE.Vector3().addScaledVector(g.r, Math.cos(a) / g.a).addScaledVector(g.u, Math.sin(a) / g.b).normalize();
        emit(e.addScaledVector(g.n, 0.05), out.multiplyScalar(1 + Math.random() * 2.5).addScaledVector(g.n, Math.random() * 2), { color, life: 0.5 + Math.random() * 0.5, size: 0.05 + Math.random() * 0.05, bright: 3, g: -2, drag: 3 });
      }
      break;
    }
    case 'gateClose': {
      const g = extra, color = extra.color;
      for (let i = 0; i < 50; i++) {
        const a = Math.random() * Math.PI * 2, e = g.c.clone().addScaledVector(g.r, Math.cos(a) * g.a).addScaledVector(g.u, Math.sin(a) * g.b);
        emit(e.addScaledVector(g.n, 0.05), g.c.clone().sub(e).multiplyScalar(2.5).addScaledVector(g.n, 0.5), { color, life: 0.4, size: 0.06, bright: 2.5, drag: 2 });
      }
      break;
    }
    case 'fail': for (let i = 0; i < 26; i++) emit(p.clone().addScaledVector(n, 0.03), n.clone().multiplyScalar(2 + Math.random() * 2).add(rvec(2)), { color: extra ?? 0xffffff, life: 0.35 + Math.random() * 0.3, size: 0.03, bright: 3, g: 9, drag: 1 }); break;
    case 'tracer': { // p = from, extra = { to, color }
      const to = extra.to, d = to.clone().sub(p), L = d.length();
      for (let i = 0; i < Math.min(60, L * 3); i++) { const t = Math.random(); emit(p.clone().addScaledVector(d, t), rvec(0.3), { color: extra.color, life: 0.12 + t * 0.2, size: 0.05, bright: 3, drag: 4 }); }
      break;
    }
    case 'spark': for (let i = 0; i < 3; i++) emit(p.clone().addScaledVector(n, 0.02), n.clone().multiplyScalar(1.5 + Math.random() * 2.5).add(rvec(1.6)), { color: 0xff4a5a, life: 0.25 + Math.random() * 0.25, size: 0.03, bright: 3.5, g: 9, drag: 0.5 }); break;
    case 'fizzle': for (let i = 0; i < 70; i++) emit(p.clone().add(rvec(0.4)), new THREE.Vector3(rnd(0.3), 0.6 + Math.random() * 1.2, rnd(0.3)), { color: 0xcfefff, life: 0.8 + Math.random() * 0.8, size: 0.04, bright: 2.5, g: -0.5, drag: 1 }); break;
    case 'bubble': emit(p.clone().add(new THREE.Vector3(0, 0.02, 0)), new THREE.Vector3(rnd(0.1), 0.25 + Math.random() * 0.3, rnd(0.1)), { color: 0x9ccf28, life: 0.9, size: 0.09, bright: 0.9, drag: 0.5 }); break;
    case 'plate': for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28; emit(p.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, 0.15, Math.sin(a) * 0.8)), new THREE.Vector3(Math.cos(a) * 2, 0.5 + Math.random(), Math.sin(a) * 2), { color: 0xffc46b, life: 0.5, size: 0.05, bright: 2, drag: 3 }); } break;
    case 'gel': { const c = extra === 'speed' ? 0xffb81a : 0x8b5cff; for (let i = 0; i < 5; i++) emit(p.clone().addScaledVector(n, 0.05), n.clone().multiplyScalar(1 + Math.random() * 1.5).add(rvec(1)), { color: c, life: 0.35, size: 0.06, bright: 1.4, g: 12, drag: 1 }); break; }
    case 'land': for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28; emit(p.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3)), new THREE.Vector3(Math.cos(a) * 1.5, 0.3, Math.sin(a) * 1.5), { color: 0xbfc4c8, life: 0.4, size: 0.07, bright: 0.5, drag: 4 }); } break;
    case 'mote': emit(p, n.clone().multiplyScalar(0.3 + Math.random() * 0.4).add(rvec(0.1)), { color: extra, life: 1.2, size: 0.035, bright: 2.2, drag: 0.3 }); break;
  }
}

export function updateEffects(dt, camera) {
  if (!points) return;
  let n = 0;
  for (let i = P.length - 1; i >= 0; i--) {
    const q = P[i]; q.life -= dt; if (q.life <= 0) { P.splice(i, 1); continue; }
    q.v.y -= q.g * dt; q.v.multiplyScalar(Math.exp(-q.drag * dt)); q.p.addScaledVector(q.v, dt);
  }
  for (const q of P) {
    pos[n * 3] = q.p.x; pos[n * 3 + 1] = q.p.y; pos[n * 3 + 2] = q.p.z;
    col[n * 3] = q.c.r; col[n * 3 + 1] = q.c.g; col[n * 3 + 2] = q.c.b;
    const k = q.life / q.max; size[n] = q.size * (0.5 + 0.5 * k); alpha[n] = Math.min(1, k * 2.5 * q.fade);
    n++;
  }
  const g = points.geometry; g.setDrawRange(0, n);
  for (const a of ['position', 'color', 'size', 'alpha']) g.attributes[a].needsUpdate = true;
  points.material.uniforms.uScale.value = G.renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360) * 0.5;
}
export function clearEffects() { P.length = 0; }
