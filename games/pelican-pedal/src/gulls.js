// A flock of gulls (boids): separation, alignment, cohesion, a wandering goal near the rider
// or the lighthouse, and terrain avoidance. Wings flap in the vertex shader.
import { THREE, V3, clamp, lerp, rng, TAU, scene } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LIGHTHOUSE } from './layout.js';

function gullGeometry() {
  const parts = [];
  const col = (g, c, wing = 0) => {
    const n = g.attributes.position.count, cc = new Float32Array(n * 3), w = new Float32Array(n), cl = new THREE.Color(c);
    for (let i = 0; i < n; i++) { cc[i * 3] = cl.r; cc[i * 3 + 1] = cl.g; cc[i * 3 + 2] = cl.b; w[i] = wing; }
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); g.setAttribute('wing', new THREE.BufferAttribute(w, 1));
    return g.index ? g.toNonIndexed() : g;
  };
  parts.push(col(new THREE.SphereGeometry(1, 10, 8).scale(0.075, 0.07, 0.22), 0xf4f4f2));
  parts.push(col(new THREE.SphereGeometry(0.055, 8, 6).translate(0, 0.03, 0.2), 0xf6f6f4));
  parts.push(col(new THREE.ConeGeometry(0.014, 0.06, 6).rotateX(Math.PI / 2).translate(0, 0.02, 0.28), 0xf0c030));
  parts.push(col(new THREE.ConeGeometry(0.06, 0.14, 4).rotateX(-Math.PI / 2).scale(1, 0.3, 1).translate(0, 0.01, -0.26), 0xeeeeec));
  // wings: grey upper, black-tipped, bent at the wrist; attribute `wing` = distance from body (0..1)
  for (const sd of [1, -1]) {
    const pos = [], cols = [], wing = [], S = 6;
    for (let i = 0; i <= S; i++) {
      const t = i / S, x = sd * (0.05 + t * 0.58), chord = lerp(0.2, 0.06, t * t), sweep = -t * t * 0.18;
      const c = t > 0.78 ? [0.08, 0.08, 0.09] : [0.62, 0.66, 0.7];
      pos.push(x, 0, 0.06 + sweep, x, 0, 0.06 + sweep - chord); cols.push(...c, ...c); wing.push(t, t);
    }
    const idx = []; for (let i = 0; i < S; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.setAttribute('wing', new THREE.Float32BufferAttribute(wing, 1));
    g.setIndex(idx); g.computeVertexNormals(); parts.push(g.toNonIndexed());
  }
  const merged = mergeGeometries(parts.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'wing'].includes(k)) g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); return g; }));
  return merged;
}

export class Gulls {
  constructor(n = 26) {
    const R = this.R = rng(7);
    const geo = gullGeometry();
    this.phase = new Float32Array(n * 2);
    geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(this.phase, 2).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    this.uT = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = this.uT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float wing; attribute vec2 aFlap; uniform float uT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fl = sin(uT * 10.0 + aFlap.x) * aFlap.y;
          float w = wing;
          transformed.y += (fl * 0.32 * w + fl * 0.2 * max(0.0, w - 0.55)) + w * w * 0.05 * (1.0 - aFlap.y);
          transformed.x *= 1.0 - abs(fl) * w * 0.12;`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, n); this.mesh.castShadow = true; this.mesh.frustumCulled = false; this.mesh.name = 'gulls';
    scene.add(this.mesh);
    this.b = [];
    for (let i = 0; i < n; i++) {
      const g = i < n * 0.6 ? 0 : 1; // 0: follows the rider, 1: circles the lighthouse
      this.b.push({ p: new V3((R() - 0.5) * 60, 18 + R() * 12, (R() - 0.5) * 60), v: new V3((R() - 0.5) * 8, 0, (R() - 0.5) * 8), g, ph: R() * TAU, flapT: 0, bank: 0, cry: R() * 10 });
    }
    this.goal = new V3(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.cries = [];
  }
  place(center) { for (const g of this.b) g.p.add(center).add(new V3(0, 0, 0)); }
  update(dt, t, rider, riderFwd, heightAt, camPos) {
    dt = Math.min(dt, 1 / 20); this.uT.value = t;
    const b = this.b, n = b.length;
    const lh = new V3(LIGHTHOUSE.x, LIGHTHOUSE.h + 18, LIGHTHOUSE.z);
    const sep = new V3(), ali = new V3(), coh = new V3(), acc = new V3(), goal = new V3(), tmp = new V3();
    this.cries.length = 0;
    for (let i = 0; i < n; i++) {
      const A = b[i]; sep.set(0, 0, 0); ali.set(0, 0, 0); coh.set(0, 0, 0); let cn = 0;
      for (let j = 0; j < n; j++) {
        if (i === j || b[j].g !== A.g) continue;
        tmp.subVectors(A.p, b[j].p); const d2 = tmp.lengthSq();
        if (d2 < 16) sep.addScaledVector(tmp, 1 / Math.max(d2, 0.2));
        if (d2 < 600) { ali.add(b[j].v); coh.add(b[j].p); cn++; }
      }
      acc.set(0, 0, 0).addScaledVector(sep, 6);
      if (cn) { ali.divideScalar(cn).sub(A.v).multiplyScalar(0.6); coh.divideScalar(cn).sub(A.p).multiplyScalar(0.05); acc.add(ali).add(coh); }
      // goals: a wandering point ahead of and above the rider, or a ring around the lighthouse
      if (A.g === 0) {
        const wob = t * 0.23 + i * 0.7;
        goal.copy(rider).addScaledVector(riderFwd, 14 + Math.sin(wob) * 10).add(tmp.set(Math.cos(wob * 1.3) * 12, 9 + Math.sin(wob * 0.7) * 4, Math.sin(wob * 1.1) * 12));
      } else {
        const a = t * 0.18 + i * 0.9; goal.copy(lh).add(tmp.set(Math.cos(a) * 28, Math.sin(a * 1.7) * 6, Math.sin(a) * 28));
      }
      acc.addScaledVector(tmp.subVectors(goal, A.p).clampLength(0, 30), 0.25);
      // keep above ground and the sea
      const floor = Math.max(heightAt(A.p.x, A.p.z), 0) + 5;
      if (A.p.y < floor + 3) acc.y += (floor + 3 - A.p.y) * 3;
      A.v.addScaledVector(acc, dt);
      const sp = A.v.length(), s = clamp(sp, 6, 12.5); A.v.multiplyScalar(s / Math.max(sp, 1e-3));
      A.p.addScaledVector(A.v, dt);
      // flap when climbing or slow, glide otherwise
      const climb = A.v.y / s;
      A.flapT = Math.max(0, A.flapT - dt);
      if (climb > 0.12 || (Math.random() < dt * 0.25)) A.flapT = 0.6 + Math.random();
      this.phase[i * 2] = A.ph; this.phase[i * 2 + 1] = lerp(this.phase[i * 2 + 1], A.flapT > 0 ? 1 : 0.08, 1 - Math.exp(-4 * dt));
      // orientation: heading + bank into turns
      const yaw = Math.atan2(A.v.x, A.v.z), pitch = -Math.asin(clamp(A.v.y / s, -1, 1));
      const lat = acc.x * Math.cos(yaw) - acc.z * Math.sin(yaw);
      A.bank = lerp(A.bank, clamp(-lat * 0.08, -0.8, 0.8), 1 - Math.exp(-3 * dt));
      this.e.set(pitch * 0.6, yaw, A.bank); this.q.setFromEuler(this.e);
      this.m.compose(A.p, this.q, tmp.set(1.25, 1.25, 1.25)); this.mesh.setMatrixAt(i, this.m);
      // occasional cries from gulls close to the camera
      A.cry -= dt;
      if (A.cry <= 0) { A.cry = 4 + Math.random() * 10; const d = A.p.distanceTo(camPos); if (d < 60) this.cries.push({ p: A.p.clone(), d }); }
    }
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.geometry.attributes.aFlap.needsUpdate = true;
  }
}
