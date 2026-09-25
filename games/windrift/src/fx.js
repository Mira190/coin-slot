// Visual effects: pooled CPU particles (additive sparks/glows and normal smoke/dust), skid marks, boost and
// landing bursts, explosions, item projectiles/drops/clouds, confetti, and weather (snowfall, blowing sand).
import * as THREE from 'three';
import { TIERS } from './data.js';
import { GLOW } from './themes.js';
import { softTex, canvasTex } from './gfx.js';
import { angDiff } from './physics.js';

// points: world-sized sprites, capped on screen and faded out right in front of the lens
const PV = `attribute float size; attribute vec4 col; varying vec4 vCol; uniform float uScale;
  void main(){ vCol = col; vec4 mv = modelViewMatrix * vec4(position, 1.0); float z = max(0.1, -mv.z);
    vCol.a *= smoothstep(1.5, 6.0, z); gl_PointSize = min(size * uScale / z, 140.0); gl_Position = projectionMatrix * mv; }`;
const PF = `uniform sampler2D map; varying vec4 vCol; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vCol.rgb, t.a * vCol.a); }`;

class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.c = new Float32Array(max * 4);
    this.s = new Float32Array(max); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max); this.g = new Float32Array(max); this.drag = new Float32Array(max); this.a0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage);
    this.sa = new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pa); geo.setAttribute('col', this.ca); geo.setAttribute('size', this.sa);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softTex() }, uScale: { value: 400 } }, vertexShader: PV, fragmentShader: PF,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.pts = new THREE.Points(geo, this.mat);
    this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 6 : 4;
    this.pts.userData.dynamic = true;
    scene.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, o = {}) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max); else this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a; this.a0[i] = a;
    this.s[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grow[i] = o.grow || 0; this.g[i] = o.g != null ? o.g : 0; this.drag[i] = o.drag != null ? o.drag : 1.5;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let q = 0; q < 3; q++) { this.p[i * 3 + q] = this.p[j * 3 + q]; this.v[i * 3 + q] = this.v[j * 3 + q]; }
          for (let q = 0; q < 4; q++) this.c[i * 4 + q] = this.c[j * 4 + q];
          this.s[i] = this.s[j]; this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.grow[i] = this.grow[j]; this.g[i] = this.g[j]; this.drag[i] = this.drag[j]; this.a0[i] = this.a0[j];
        }
        i--; continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3] *= d; this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.g[i] * dt; this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.s[i] += this.grow[i] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.c[i * 4 + 3] = this.a0[i] * Math.min(1, f * 2.2);
    }
    this.pts.geometry.setDrawRange(0, this.n);
    this.pa.needsUpdate = this.ca.needsUpdate = this.sa.needsUpdate = true;
  }
  clear() { this.n = 0; }
}

// additive line streaks for sparks: each spark is a short segment stretched along its velocity
class Streaks {
  constructor(scene, max) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.g = new Float32Array(max);
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 6);
    const geo = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pa); geo.setAttribute('color', this.ca);
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 7; this.lines.userData.dynamic = true;
    scene.add(this.lines);
  }
  emit(x, y, z, vx, vy, vz, r, g, b, life, grav = 16) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max); else this.n++;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.c.set([r * GLOW.spark, g * GLOW.spark, b * GLOW.spark], i * 3);
    this.life[i] = this.maxLife[i] = life; this.g[i] = grav;
  }
  update(dt) {
    const P = this.p, V = this.v;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) { for (let q = 0; q < 3; q++) { P[i * 3 + q] = P[j * 3 + q]; V[i * 3 + q] = V[j * 3 + q]; this.c[i * 3 + q] = this.c[j * 3 + q]; } this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.g[i] = this.g[j]; }
        i--; continue;
      }
      V[i * 3 + 1] -= this.g[i] * dt;
      const d = 1 - 1.2 * dt; V[i * 3] *= d; V[i * 3 + 2] *= d;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < this.floor(i) && V[i * 3 + 1] < 0) V[i * 3 + 1] *= -0.4;
      const f = this.life[i] / this.maxLife[i], o = i * 6;
      this.pos[o] = P[i * 3]; this.pos[o + 1] = P[i * 3 + 1]; this.pos[o + 2] = P[i * 3 + 2];
      this.pos[o + 3] = P[i * 3] - V[i * 3] * 0.035; this.pos[o + 4] = P[i * 3 + 1] - V[i * 3 + 1] * 0.035; this.pos[o + 5] = P[i * 3 + 2] - V[i * 3 + 2] * 0.035;
      for (let q = 0; q < 3; q++) { this.col[o + q] = this.c[i * 3 + q] * f; this.col[o + 3 + q] = this.c[i * 3 + q] * f * 0.15; }
    }
    this.lines.geometry.setDrawRange(0, this.n * 2);
    this.pa.needsUpdate = this.ca.needsUpdate = true;
  }
  floor() { return -1e9; }
  clear() { this.n = 0; }
}

class Skids {
  constructor(scene, max = 2400) {
    this.max = max; this.i = 0;
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), max);
    this.mesh.frustumCulled = false; this.mesh.userData.dynamic = true; this.mesh.renderOrder = 1;
    this.clear();
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
  }
  clear() { const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, z); this.mesh.instanceMatrix.needsUpdate = true; }
  add(x0, y0, z0, x1, y1, z1, w) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 0.05 || L > 4) return;
    this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
    this.v.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.045, (z0 + z1) / 2); this.s.set(w, 1, L + 0.05);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(this.i, this.m); this.i = (this.i + 1) % this.max;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const TIERC = TIERS.map((t) => new THREE.Color(t.color));

export class FX {
  constructor(scene, theme) {
    this.scene = scene; this.theme = theme;
    this.add = new Particles(scene, 2600, true);
    this.norm = new Particles(scene, 1800, false);
    this.skids = new Skids(scene);
    this.sparks = new Streaks(scene, 1600);
    this.itemMeshes = new Map();
    this.t = 0;
    this.tmp = new THREE.Vector3();
    this.weather = null;
    if (theme === 'snow') this.makeSnow();
    if (theme === 'desert') this.makeSand();
    // shock rings for explosions / boosts
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 40); this.ringGeo.rotateX(-Math.PI / 2);
  }
  setScale(h) { this.add.mat.uniforms.uScale.value = this.norm.mat.uniforms.uScale.value = h * 0.9; if (this.weather) this.weather.material.uniforms.uScale.value = h * 0.9; }
  dustColor() { return this.theme === 'snow' ? [0.95, 0.97, 1] : this.theme === 'desert' ? [0.86, 0.7, 0.48] : this.theme === 'coast' ? [0.85, 0.85, 0.82] : [0.36, 0.36, 0.42]; }

  // per-kart effects each frame
  kart(k, view, dt, onIce) {
    const h = view.root.rotation.y, s = view.shape;
    const sin = Math.sin(h), cos = Math.cos(h);
    const rear = -s.len / 2 + 0.55, side = s.wid / 2 + 0.05;
    const wx = (lx, lz) => view.pos.x + cos * lx + sin * lz, wz = (lx, lz) => view.pos.z - sin * lx + cos * lz;
    const y = view.pos.y;
    const slip = Math.abs(angDiff(k.h, k.vh));
    const sliding = k.grounded && (k.drift.on || slip > 0.18) && Math.abs(k.spd) > 8;
    for (const sd of [1, -1]) {
      const x = wx(sd * side, rear), z = wz(sd * side, rear);
      const key = sd > 0 ? 'skL' : 'skR';
      if (sliding) {
        if (view[key]) this.skids.add(view[key][0], view[key][1], view[key][2], x, y, z, 0.38);
        view[key] = [x, y, z];
      } else view[key] = null;
    }
    if (k.drift.on && k.grounded) {
      const tier = k.drift.tier, c = TIERC[tier];
      const n = tier === 0 ? 1 : 1 + tier * 2;
      for (let q = 0; q < n; q++) {
        const sd = k.drift.dir > 0 ? -1 : 1; // sparks from the outside rear wheel
        const x = wx(sd * side, rear - 0.2), z = wz(sd * side, rear - 0.2);
        const sp = 6 + Math.random() * 8;
        const a = h + Math.PI + sd * 0.5 + (Math.random() - 0.5) * 1.1;
        const vx = Math.sin(a) * sp + Math.sin(k.vh) * k.spd * 0.6, vy = 2 + Math.random() * 5, vz = Math.cos(a) * sp + Math.cos(k.vh) * k.spd * 0.6, life = 0.18 + Math.random() * 0.22;
        this.sparks.emit(x, y + 0.12, z, vx, vy, vz, c.r, c.g, c.b, life);
        // a small soft head on every other spark gives the spray body without needing bloom
        if (q % 2 === 0) this.add.emit(x, y + 0.12, z, vx, vy, vz, c.r, c.g, c.b, 0.85, 0.08 + tier * 0.012, life, { g: 16, drag: 1.2 });
      }
      if (tier > 0 && Math.random() < 0.7) {
        const x = wx(0, rear - 0.4), z = wz(0, rear - 0.4);
        this.add.emit(x, y + 0.25, z, 0, 0.5, 0, c.r, c.g, c.b, 0.35, 0.35 + tier * 0.08, 0.08, { drag: 0 });
      }
    }
    if (sliding && Math.random() < (onIce ? 0.12 : 0.3)) {
      const dc = this.dustColor();
      const sd = Math.random() < 0.5 ? 1 : -1;
      const x = wx(sd * side, rear), z = wz(sd * side, rear);
      this.norm.emit(x, y + 0.3, z, (Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2, dc[0], dc[1], dc[2], this.theme === 'snow' ? 0.13 : 0.18, 0.7, 0.6 + Math.random() * 0.4, { grow: 1.3, drag: 1.2, g: -0.3 });
    }
    // boost exhaust sparks
    const nitro = k.b.nitro > 0 || k.b.turbo > 0, micro = k.b.micro > 0 || k.b.start > 0;
    if (nitro || micro) {
      const col = nitro ? [0.4, 0.6, 1] : [1, 0.6, 0.2];
      for (let q = 0; q < (nitro ? 2 : 1); q++) {
        const x = wx((Math.random() - 0.5) * s.wid * 0.6, -s.len / 2 - 0.5), z = wz((Math.random() - 0.5) * s.wid * 0.6, -s.len / 2 - 0.5);
        const sp = 10 + Math.random() * 6;
        this.sparks.emit(x, y + 0.55, z, Math.sin(k.vh) * k.spd - sin * sp + (Math.random() - 0.5) * 3, Math.random() * 2, Math.cos(k.vh) * k.spd - cos * sp + (Math.random() - 0.5) * 3, col[0], col[1], col[2], 0.12 + Math.random() * 0.1, 2);
      }
    }
    // snow spray / sand kick-up at speed off the racing line
    if (k.grounded && Math.abs(k.spd) > 25 && (this.theme === 'snow' || this.theme === 'desert') && Math.random() < 0.05) {
      const dc = this.dustColor();
      const x = wx((Math.random() - 0.5) * s.wid, rear), z = wz((Math.random() - 0.5) * s.wid, rear);
      this.norm.emit(x, y + 0.2, z, -sin * 3, 1.5, -cos * 3, dc[0], dc[1], dc[2], 0.12, 0.6, 0.45, { grow: 1.4, drag: 1 });
    }
  }
  burst(x, y, z, color, n = 30, speed = 10, size = 0.35) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = speed * (0.5 + Math.random() * 0.8);
      this.sparks.emit(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, c.r, c.g, c.b, 0.3 + Math.random() * 0.4, 14);
    }
    if (size > 0.4) this.add.emit(x, y, z, 0, 0, 0, c.r, c.g, c.b, 0.8, size * 3, 0.15, { drag: 0 });
  }
  puff(x, y, z, n = 12, col) {
    const dc = col || this.dustColor();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      this.norm.emit(x, y + 0.2, z, Math.cos(a) * sp, 0.6 + Math.random() * 1.2, Math.sin(a) * sp, dc[0], dc[1], dc[2], 0.45, 1.2, 0.8 + Math.random() * 0.5, { grow: 2.5, drag: 2 });
    }
  }
  ring(x, y, z, color, size = 6, life = 0.45) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, y + 0.2, z); m.userData.dynamic = true; m.renderOrder = 7;
    this.scene.add(m); this.rings.push({ m, t: 0, life, size });
  }
  explosion(x, y, z) {
    this.burst(x, y + 0.5, z, 0xffb03a, 50, 16, 0.6);
    this.burst(x, y + 0.5, z, 0xff4020, 30, 10, 0.8);
    for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, sp = 2 + Math.random() * 5; this.norm.emit(x, y + 1, z, Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp, 0.25, 0.22, 0.22, 0.6, 2, 1.2, { grow: 3, drag: 1.5, g: -1 }); }
    this.add.emit(x, y + 1, z, 0, 0, 0, 1, 0.8, 0.5, 1, 9, 0.18, { drag: 0 });
    this.ring(x, y, z, 0xffa040, 12, 0.5);
  }
  confetti(x, y, z, n = 120) {
    const cols = [[1, 0.2, 0.4], [1, 0.85, 0.1], [0.1, 0.8, 1], [0.5, 1, 0.4], [0.7, 0.4, 1]];
    for (let i = 0; i < n; i++) {
      const c = cols[i % cols.length], a = Math.random() * 6.28, sp = 3 + Math.random() * 7;
      this.add.emit(x + (Math.random() - 0.5) * 6, y, z + (Math.random() - 0.5) * 6, Math.cos(a) * sp, 8 + Math.random() * 10, Math.sin(a) * sp, c[0], c[1], c[2], 1, 0.35, 2.5 + Math.random() * 1.5, { g: 6, drag: 1.2 });
    }
  }
  // item projectiles, bananas and fog clouds from race.items
  syncItems(I, t) {
    const live = new Set();
    const get = (id, make) => { let m = this.itemMeshes.get(id); if (!m) { m = make(); m.traverse((o) => { o.userData.dynamic = true; }); this.scene.add(m); this.itemMeshes.set(id, m); } live.add(id); return m; };
    if (I) {
      for (const s of I.shots) {
        const m = get(s.id, () => s.kind === 'missile' ? missileMesh() : s.kind === 'devil' ? devilMesh() : s.kind === 'tornado' ? tornadoMesh() : bubbleMesh());
        m.position.set(s.x, s.y, s.z); m.rotation.y = s.h;
        if (s.kind === 'missile') { m.rotation.z += 0.3; this.norm.emit(s.x, s.y, s.z, 0, 0.5, 0, 0.8, 0.8, 0.8, 0.5, 0.8, 0.6, { grow: 2 }); this.add.emit(s.x - Math.sin(s.h) * 0.8, s.y, s.z - Math.cos(s.h) * 0.8, 0, 0, 0, 1, 0.6, 0.2, 1, 0.8, 0.08); }
        else if (s.kind === 'bubble') { m.children[1].rotation.z = Math.sin(t * 40) * 0.6; m.children[2].rotation.z = -Math.sin(t * 40) * 0.6; }
        else if (s.kind === 'tornado') { m.rotation.y = t * 12; if (Math.random() < 0.6) this.norm.emit(s.x + (Math.random() - 0.5) * 3, s.y + Math.random() * 2, s.z + (Math.random() - 0.5) * 3, 0, 3, 0, 0.8, 0.85, 0.9, 0.35, 1, 0.6, { grow: 1.5 }); }
        else if (s.kind === 'devil') { m.position.y += Math.sin(t * 8) * 0.3; }
      }
      for (const d of I.drops) { const m = get(d.id, bananaMesh); m.position.set(d.x, d.y + 0.25, d.z); m.rotation.y = t * 0.5; }
      for (const c of I.clouds) {
        const m = get(c.id, cloudMesh);
        m.position.set(c.k.x, c.k.y + 3.2, c.k.z); m.rotation.y = t;
        m.scale.setScalar(Math.min(1, c.t * 2));
      }
    }
    for (const [id, m] of this.itemMeshes) if (!live.has(id)) {
      this.scene.remove(m); this.itemMeshes.delete(id);
      m.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
  }
  makeSnow() {
    const N = 1600, pos = new Float32Array(N * 3), col = new Float32Array(N * 4), size = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 50; pos[i * 3 + 2] = (Math.random() - 0.5) * 120; col.set([1, 1, 1, 0.7], i * 4); size[i] = 0.12 + Math.random() * 0.14; }
    this.mkWeather(pos, col, size, false);
    this.wv = (i, dt, t) => [Math.sin(t * 0.7 + i) * 0.8, -3.2 - (i % 7) * 0.2, Math.cos(t * 0.5 + i * 1.3) * 0.8];
  }
  makeSand() {
    // fine grains: at 0.25–0.65 u these read as big grey smudges on the lens near the camera
    const N = 1100, pos = new Float32Array(N * 3), col = new Float32Array(N * 4), size = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = (Math.random() - 0.5) * 120; col.set([0.92, 0.78, 0.55, 0.45], i * 4); size[i] = 0.07 + Math.random() * 0.12; }
    this.mkWeather(pos, col, size, false);
    this.wv = (i, dt, t) => [7 + (i % 5), Math.sin(t * 2 + i) * 0.5, 2.5];
  }
  mkWeather(pos, col, size) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('col', new THREE.BufferAttribute(col, 4)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({ uniforms: { map: { value: softTex() }, uScale: { value: 400 } }, vertexShader: PV, fragmentShader: PF, transparent: true, depthWrite: false });
    this.weather = new THREE.Points(g, m); this.weather.frustumCulled = false; this.weather.userData.dynamic = true;
    this.scene.add(this.weather);
  }
  update(dt, cam) {
    this.t += dt;
    this.add.update(dt); this.norm.update(dt); this.sparks.update(dt);
    for (const r of this.rings) {
      r.t += dt; const f = r.t / r.life;
      r.m.scale.setScalar(1 + f * r.size); r.m.material.opacity = 0.9 * (1 - f);
      if (f >= 1) { this.scene.remove(r.m); r.m.material.dispose(); r.dead = true; }
    }
    this.rings = this.rings.filter((r) => !r.dead);
    if (this.weather && cam) {
      const p = this.weather.geometry.attributes.position, a = p.array, n = p.count;
      for (let i = 0; i < n; i++) {
        const v = this.wv(i, dt, this.t);
        a[i * 3] += v[0] * dt; a[i * 3 + 1] += v[1] * dt; a[i * 3 + 2] += v[2] * dt;
        // wrap in a box around the camera
        for (let q = 0; q < 3; q++) {
          const c = [cam.x, cam.y + (this.theme === 'desert' ? -2 : 18), cam.z][q], half = q === 1 ? (this.theme === 'desert' ? 5 : 26) : 60;
          if (a[i * 3 + q] < c - half) a[i * 3 + q] += half * 2; else if (a[i * 3 + q] > c + half) a[i * 3 + q] -= half * 2;
        }
      }
      p.needsUpdate = true;
    }
  }
  clear() { this.add.clear(); this.norm.clear(); this.sparks.clear(); this.skids.clear(); this.syncItems(null, 0); }
}

function missileMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff3b3b, metalness: 0.4, roughness: 0.3 }));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.3 }));
  nose.position.z = 0.95;
  g.add(body, nose);
  for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.4), body.material); f.rotation.z = (k * Math.PI) / 2; f.position.z = -0.55; f.translateY(0.25); g.add(f); }
  return g;
}
function bubbleMesh() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), new THREE.MeshPhysicalMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.5, roughness: 0, clearcoat: 1 }));
  const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.4), new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  const w2 = w1.clone(); w1.position.x = 0.7; w2.position.x = -0.7;
  const fly = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0x1a4f8a }));
  g.add(s, w1, w2, fly);
  return g;
}
function devilMesh() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xe0245e, emissive: 0x6a0a2a, roughness: 0.4 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), m); g.add(head);
  for (const s of [1, -1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 8), m); h.position.set(s * 0.35, 0.6, 0); h.rotation.z = -s * 0.4; g.add(h); }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 6, 12, Math.PI), m); tail.position.set(0, -0.3, -0.6); tail.rotation.y = Math.PI / 2; g.add(tail);
  return g;
}
function tornadoMesh() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.45, roughness: 1, side: THREE.DoubleSide, depthWrite: false });
  for (let k = 0; k < 5; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.5 + k * 0.45, 0.14, 6, 18), m); r.rotation.x = Math.PI / 2; r.position.set(Math.sin(k) * 0.2, 0.5 + k * 0.8, Math.cos(k) * 0.2); g.add(r); }
  return g;
}
function bananaMesh() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.5 });
  const b = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.16, 8, 16, Math.PI * 1.1), m); b.rotation.x = Math.PI / 2; g.add(b);
  for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 6), m); p.rotation.z = Math.PI / 2 + (k - 1) * 0.8; p.position.set(Math.cos(k * 2.1) * 0.3, 0.05, Math.sin(k * 2.1) * 0.3); g.add(p); }
  return g;
}
function cloudMesh() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x3a2a5a, roughness: 1, transparent: true, opacity: 0.85 });
  for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.5, 10, 8), m); s.position.set(Math.cos(k) * 1.1, Math.random() * 0.4, Math.sin(k) * 1.1); g.add(s); }
  return g;
}
