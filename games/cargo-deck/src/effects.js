// Visual effects: GPU point particles (additive sparks / alpha dust+smoke+blood), tracers, decals
// (bullet holes, blood), ejected casings, explosions, smoke-grenade clouds, water splashes, and a fixed
// pool of flash lights (light count never changes, so no shader recompiles mid-fight).
import * as THREE from 'three';
import { bulletHole, softDot, smokePuff } from './textures.js';
import { WATER_Y } from './sea.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);

class Particles {
  // quads = camera-facing instanced quads (no GPU point-size cap: big smoke puffs stay big up close)
  constructor(scene, n, additive, tex, quads = false) {
    this.n = n; this.i = 0;
    const g = quads ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.grow = new Float32Array(n); this.a0 = new Float32Array(n); this.fade = new Float32Array(n);
    const A = (arr, k) => (quads ? new THREE.InstancedBufferAttribute(arr, k) : new THREE.BufferAttribute(arr, k)).setUsage(THREE.DynamicDrawUsage);
    if (quads) {
      const q = new THREE.PlaneGeometry(1, 1);
      g.setIndex(q.index); g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
      g.setAttribute('ipos', A(this.pos, 3)); g.setAttribute('icolor', A(this.col, 3)); g.setAttribute('isize', A(this.size, 1)); g.setAttribute('ialpha', A(this.alpha, 1));
      g.instanceCount = n;
      this.names = ['ipos', 'icolor', 'isize', 'ialpha'];
    } else {
      g.setAttribute('position', A(this.pos, 3)); g.setAttribute('color', A(this.col, 3)); g.setAttribute('size', A(this.size, 1)); g.setAttribute('alpha', A(this.alpha, 1));
      this.names = ['position', 'color', 'size', 'alpha'];
    }
    const mat = quads ? new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 400 } },
      vertexShader: `attribute vec3 ipos; attribute vec3 icolor; attribute float isize; attribute float ialpha; varying float vA; varying vec3 vC; varying vec2 vUv;
        void main(){ vA = ialpha; vC = icolor; vUv = uv; vec4 mv = modelViewMatrix * vec4(ipos, 1.0);
          mv.xy += position.xy * isize * step(0.0001, ialpha); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA; varying vec3 vC; varying vec2 vUv;
        void main(){ vec4 t = texture2D(uTex, vUv); if (vA <= 0.0) discard; gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }) : new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 400 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC;
        uniform float uScale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / max(0.1, -mv.z); }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); if (vA <= 0.0) discard; gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mat = mat;
    this.points = quads ? new THREE.Mesh(g, mat) : new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
    this.geo = g;
  }
  emit(p, v, color, size, life, o = {}) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
    this.size[i] = size; this.life[i] = life; this.max[i] = life;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 1; this.grow[i] = o.grow ?? 0; this.a0[i] = o.alpha ?? 1; this.fade[i] = o.fadeIn ?? 0;
    this.alpha[i] = this.a0[i];
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const u = this.life[i] / this.max[i];
      const fin = this.fade[i] > 0 ? Math.min(1, (1 - u) / this.fade[i]) : 1;
      this.alpha[i] = Math.max(0, this.a0[i] * Math.min(1, u * 2.2) * fin);
    }
    for (const k of this.names) this.geo.attributes[k].needsUpdate = true;
  }
}

export class Effects {
  constructor(R, coll, audio) {
    this.R = R; this.scene = R.scene; this.coll = coll; this.audio = audio;
    const dot = softDot(64), puff = smokePuff(7);
    this.spark = new Particles(this.scene, 1200, true, dot);
    this.dust = new Particles(this.scene, 1400, false, puff, true);
    this.smoke = new Particles(this.scene, 900, false, puff, true);
    // tracers
    this.tracers = [];
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 2.6, 1.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const tg = new THREE.BoxGeometry(0.018, 0.018, 1); tg.translate(0, 0, -0.5);
    for (let i = 0; i < 32; i++) { const m = new THREE.Mesh(tg, tm); m.visible = false; m.frustumCulled = false; this.scene.add(m); this.tracers.push({ m, from: V(), dir: V(), len: 0, t: 0, dist: 0 }); }
    // decals
    const holeM = new THREE.MeshStandardMaterial({ map: bulletHole(false), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 });
    const holeW = new THREE.MeshStandardMaterial({ map: bulletHole(true), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 });
    const bloodM = new THREE.MeshStandardMaterial({ map: this._bloodTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.35 });
    this.decals = []; this.di = 0;
    const dg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 160; i++) { const m = new THREE.Mesh(dg, holeM); m.visible = false; m.renderOrder = 2; this.scene.add(m); this.decals.push(m); }
    this.holeM = holeM; this.holeW = holeW; this.bloodM = bloodM;
    this.bloods = []; this.bi = 0;
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(dg, bloodM); m.visible = false; m.renderOrder = 1; this.scene.add(m); this.bloods.push(m); }
    // casings
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.3, metalness: 1 });
    const red = new THREE.MeshStandardMaterial({ color: 0xa82a20, roughness: 0.5 });
    this.shellGeo = { rifle: new THREE.CylinderGeometry(0.005, 0.006, 0.045, 6), pistol: new THREE.CylinderGeometry(0.005, 0.005, 0.022, 6), shotgun: new THREE.CylinderGeometry(0.01, 0.01, 0.065, 8) };
    this.shells = []; this.si = 0;
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(this.shellGeo.rifle, brass); m.visible = false; m.castShadow = false; this.scene.add(m); this.shells.push({ m, v: V(), w: V(), t: 0, bounced: 0 }); }
    this.brass = brass; this.redShell = red;
    // flash lights (fixed count)
    this.lights = [];
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffb45a, 0, 9, 2); this.scene.add(l); this.lights.push({ l, t: 0, max: 1, peak: 0 }); }
    this.li = 0;
    // explosion fireball sprites + shock rings
    const fbTex = softDot(128, 'rgba(255,240,200,1)', 'rgba(255,120,20,0)');
    this.fireballs = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fbTex, color: new THREE.Color(4, 2.4, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; this.scene.add(s); this.fireballs.push({ s, t: 0, max: 0.5, size: 1 });
    }
    this.rings = [];
    const rg = new THREE.RingGeometry(0.9, 1, 32); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; this.scene.add(m); this.rings.push({ m, t: 0 }); }
    this.smokes = []; // live smoke volumes: { p, r, t, life }
    // third-person muzzle flashes (pooled additive sprites)
    const mf = softDot(64, 'rgba(255,245,210,1)', 'rgba(255,150,40,0)');
    this.mflash = [];
    for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mf, color: new THREE.Color(5, 3.6, 2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.visible = false; this.scene.add(s); this.mflash.push({ s, t: 0 }); }
    this.mfi = 0;
    this.clock = 0;
  }
  _bloodTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    for (let i = 0; i < 16; i++) {
      const r = 8 + Math.random() * 24, a = Math.random() * 6.28, d = Math.random() * 30;
      const g = x.createRadialGradient(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r);
      g.addColorStop(0, 'rgba(90,6,6,0.95)'); g.addColorStop(0.7, 'rgba(70,4,4,0.8)'); g.addColorStop(1, 'rgba(60,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  flash(p, intensity = 18, dur = 0.06, color = 0xffb45a, dist = 9) {
    const L = this.lights[this.li]; this.li = (this.li + 1) % this.lights.length;
    L.l.position.copy(p); L.l.color.set(color); L.l.distance = dist; L.t = dur; L.max = dur; L.peak = intensity;
  }
  tracer(from, to, bright = 1) {
    const d = to.clone().sub(from), dist = d.length();
    if (dist < 2) return;
    const T = this.tracers.find((t) => t.t <= 0) || this.tracers[0];
    T.from.copy(from); T.dir.copy(d.divideScalar(dist)); T.dist = dist; T.t = 1; T.pos = 0; T.len = Math.min(dist * 0.5, 3.5 * bright);
    T.m.visible = true; T.m.scale.set(bright, bright, T.len);
    T.m.lookAt(from.clone().add(T.dir)); T.m.position.copy(from);
  }
  decal(p, n, wood) {
    const m = this.decals[this.di]; this.di = (this.di + 1) % this.decals.length;
    m.material = wood ? this.holeW : this.holeM;
    m.position.copy(p).addScaledVector(n, 0.006);
    m.lookAt(p.clone().add(n)); m.rotateZ(Math.random() * 6.28);
    const s = wood ? 0.1 : 0.075; m.scale.set(s, s, s); m.visible = true;
  }
  bloodDecal(p, n, size = 0.7) {
    const m = this.bloods[this.bi]; this.bi = (this.bi + 1) % this.bloods.length;
    m.position.copy(p).addScaledVector(n, 0.012); m.lookAt(p.clone().add(n)); m.rotateZ(Math.random() * 6.28);
    m.scale.setScalar(size * (0.7 + Math.random() * 0.6)); m.visible = true;
  }
  // bullet impact on world geometry
  impact(p, n, mat, exit = false) {
    const wood = mat === 'wood';
    if (mat === 'water') { this.splash(p); return; }
    this.decal(p, n, wood);
    const k = exit ? 0.6 : 1;
    if (wood) {
      for (let i = 0; i < 6 * k; i++) this.dust.emit(p, V(n.x * rand(1, 3) + rand(-1, 1), n.y * rand(1, 3) + rand(0, 2), n.z * rand(1, 3) + rand(-1, 1)), [0.62, 0.46, 0.28], rand(0.025, 0.05), rand(0.5, 1), { grav: 9, drag: 1.5 });
      for (let i = 0; i < 2; i++) this.dust.emit(p, V(n.x * 0.6, 0.3, n.z * 0.6), [0.55, 0.48, 0.38], rand(0.2, 0.35), rand(0.6, 1.1), { drag: 3, grow: 0.5, alpha: 0.5 });
    } else {
      for (let i = 0; i < 8 * k; i++) this.spark.emit(p, V(n.x * rand(2, 6) + rand(-2, 2), n.y * rand(2, 6) + rand(-1, 3), n.z * rand(2, 6) + rand(-2, 2)), [1, 0.75, 0.4], rand(0.02, 0.04), rand(0.12, 0.35), { grav: 12, drag: 2 });
      for (let i = 0; i < 2; i++) this.dust.emit(p, V(n.x * 0.8 + rand(-0.2, 0.2), 0.4, n.z * 0.8 + rand(-0.2, 0.2)), [0.5, 0.5, 0.5], rand(0.14, 0.26), rand(0.5, 0.9), { drag: 3, grow: 0.6, alpha: 0.45 });
    }
  }
  blood(p, dir, big = false) {
    for (let i = 0; i < (big ? 18 : 9); i++) this.dust.emit(p, V(dir.x * rand(1, 4) + rand(-1, 1), dir.y * rand(1, 3) + rand(-0.5, 1.5), dir.z * rand(1, 4) + rand(-1, 1)), [0.42, 0.02, 0.02], rand(0.04, 0.09), rand(0.3, 0.7), { grav: 9, drag: 2, alpha: 0.9 });
    for (let i = 0; i < (big ? 3 : 1); i++) this.dust.emit(p, V(dir.x, dir.y * 0.5, dir.z), [0.35, 0.02, 0.02], rand(0.15, 0.3), 0.5, { drag: 4, grow: 0.6, alpha: 0.55 });
    // splatter on whatever is behind the victim
    const h = this.coll.raycast(p.x, p.y, p.z, dir.x, dir.y - 0.3, dir.z, 2.2);
    if (h) this.bloodDecal(V(p.x + dir.x * h.t, p.y + (dir.y - 0.3) * h.t, p.z + dir.z * h.t), V(h.nx, h.ny, h.nz), 0.5);
  }
  splash(p) {
    for (let i = 0; i < 14; i++) this.dust.emit(V(p.x, WATER_Y + 0.05, p.z), V(rand(-1, 1), rand(2, 5), rand(-1, 1)), [0.85, 0.9, 0.92], rand(0.05, 0.12), rand(0.4, 0.8), { grav: 10, drag: 0.8, alpha: 0.8 });
  }
  muzzle(p, dir, big = 1, sprite = false) {
    this.flash(p, 12 * big, 0.05);
    if (sprite) { const M = this.mflash[this.mfi]; this.mfi = (this.mfi + 1) % this.mflash.length; M.s.position.copy(p).addScaledVector(dir, 0.08); M.s.scale.setScalar(0.35 * big * (0.8 + Math.random() * 0.5)); M.s.material.rotation = Math.random() * 6.28; M.t = 0.05; M.s.visible = true; }
    for (let i = 0; i < 3; i++) this.dust.emit(p.clone().addScaledVector(dir, 0.1), V(dir.x * rand(0.5, 1.5), dir.y + 0.3, dir.z * rand(0.5, 1.5)), [0.7, 0.7, 0.7], rand(0.06, 0.12) * big, rand(0.4, 0.7), { drag: 2.5, grow: 0.5 * big, alpha: 0.3 });
  }
  shell(p, right, kind = 'rifle') {
    const S = this.shells[this.si]; this.si = (this.si + 1) % this.shells.length;
    S.m.geometry = this.shellGeo[kind] || this.shellGeo.rifle;
    S.m.material = kind === 'shotgun' ? this.redShell : this.brass;
    S.m.position.copy(p); S.m.visible = true;
    S.v.copy(right).multiplyScalar(rand(1.6, 2.6)).add(V(rand(-0.3, 0.3), rand(1.2, 2.2), rand(-0.3, 0.3)));
    S.w.set(rand(-20, 20), rand(-20, 20), rand(-20, 20)); S.t = 2.5; S.bounced = 0; S.kind = kind;
  }
  explosion(p) {
    this.flash(p.clone().add(V(0, 0.5, 0)), 400, 0.35, 0xffa050, 26);
    const F = this.fireballs.find((f) => f.t <= 0) || this.fireballs[0];
    F.s.position.copy(p).add(V(0, 0.6, 0)); F.t = F.max = 0.45; F.size = 5; F.s.visible = true;
    const Rg = this.rings.find((r) => r.t <= 0) || this.rings[0];
    Rg.m.position.copy(p).add(V(0, 0.05, 0)); Rg.t = 0.4; Rg.m.visible = true;
    for (let i = 0; i < 60; i++) { const d = V(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).normalize(); this.spark.emit(p.clone().add(V(0, 0.2, 0)), d.multiplyScalar(rand(6, 18)), [1, 0.62, 0.28], rand(0.03, 0.07), rand(0.3, 0.9), { grav: 12, drag: 1.2 }); }
    for (let i = 0; i < 26; i++) { const d = V(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize(); this.smoke.emit(p.clone().add(V(0, 0.4, 0)), d.multiplyScalar(rand(1, 4)), [0.28, 0.26, 0.24], rand(0.8, 1.6), rand(2, 4), { drag: 1.6, grow: 1.2, alpha: 0.75 }); }
    for (let i = 0; i < 20; i++) { const d = V(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)); this.dust.emit(p, d.multiplyScalar(rand(3, 8)), [0.2, 0.18, 0.16], rand(0.03, 0.06), rand(0.8, 1.4), { grav: 14, drag: 0.5 }); }
    this.bloodDecal(p.clone().add(V(0, 0.02, 0)), V(0, 1, 0), 1.6); // scorch (dark)
  }
  flashbang(p) {
    this.flash(p.clone().add(V(0, 0.3, 0)), 900, 0.25, 0xffffff, 30);
    for (let i = 0; i < 30; i++) this.spark.emit(p, V(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(rand(2, 7)), [1, 1, 0.95], rand(0.03, 0.06), rand(0.2, 0.5), { grav: 6, drag: 2 });
    for (let i = 0; i < 6; i++) this.smoke.emit(p, V(rand(-0.5, 0.5), rand(0.2, 0.8), rand(-0.5, 0.5)), [0.8, 0.8, 0.8], rand(0.4, 0.8), rand(1.5, 2.5), { drag: 1, grow: 0.5, alpha: 0.4 });
  }
  smokeCloud(p, life, radius) {
    this.smokes.push({ p: p.clone(), r: 0.5, R: radius, t: 0, life, emit: 0 });
  }
  // true if the segment a-b passes through any live smoke volume
  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      if (s.t < 1.2 || s.t > s.life - 1) continue;
      const ab = _ab.subVectors(b, a), L = ab.length(); ab.divideScalar(L);
      const t = Math.max(0, Math.min(L, _ac.subVectors(s.p, a).dot(ab)));
      if (_ac.copy(a).addScaledVector(ab, t).distanceTo(s.p) < s.r * 0.85) return true;
    }
    return false;
  }
  update(dt, cam) {
    this.clock += dt;
    this.spark.update(dt); this.dust.update(dt); this.smoke.update(dt);
    const h = this.R.renderer.domElement.height;
    const sc = h / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.spark.mat.uniforms.uScale.value = this.dust.mat.uniforms.uScale.value = this.smoke.mat.uniforms.uScale.value = sc;
    for (const T of this.tracers) {
      if (T.t <= 0) continue;
      T.pos += dt * 420;
      if (T.pos - T.len > T.dist) { T.t = 0; T.m.visible = false; continue; }
      const head = Math.min(T.pos, T.dist), tail = Math.max(0, T.pos - T.len);
      T.m.position.copy(T.from).addScaledVector(T.dir, head);
      T.m.scale.z = Math.max(0.01, head - tail);
    }
    for (const M of this.mflash) if (M.t > 0) { M.t -= dt; if (M.t <= 0) M.s.visible = false; }
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = L.peak * Math.max(0, L.t / L.max); } else L.l.intensity = 0; }
    for (const F of this.fireballs) {
      if (F.t <= 0) { F.s.visible = false; continue; }
      F.t -= dt; const u = 1 - F.t / F.max;
      F.s.scale.setScalar(F.size * (0.4 + u * 0.9)); F.s.material.opacity = 1 - u;
    }
    for (const Rg of this.rings) {
      if (Rg.t <= 0) { Rg.m.visible = false; continue; }
      Rg.t -= dt; const u = 1 - Rg.t / 0.4;
      Rg.m.scale.setScalar(0.5 + u * 9); Rg.m.material.opacity = 0.5 * (1 - u);
    }
    for (const S of this.shells) {
      if (S.t <= 0) continue;
      S.t -= dt;
      if (S.t <= 0) { S.m.visible = false; continue; }
      S.v.y -= 16 * dt;
      S.m.position.addScaledVector(S.v, dt);
      S.m.rotation.x += S.w.x * dt; S.m.rotation.y += S.w.y * dt; S.m.rotation.z += S.w.z * dt;
      const g = this.coll.groundAt(S.m.position.x, S.m.position.z, 0.01, S.m.position.y - 1, S.m.position.y + 0.05);
      if (g && S.m.position.y < g.y + 0.006 && S.v.y < 0) {
        S.m.position.y = g.y + 0.006; S.v.y *= -0.35; S.v.x *= 0.5; S.v.z *= 0.5; S.w.multiplyScalar(0.5);
        if (S.bounced++ === 0 && this.audio) this.audio.shell(S.m.position, S.kind);
        if (Math.abs(S.v.y) < 0.3) { S.v.set(0, 0, 0); S.w.set(0, 0, 0); S.m.rotation.x = Math.PI / 2; }
      }
    }
    // smoke grenades: grow, keep emitting big puffs while alive
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt; s.r = Math.min(s.R, 0.5 + s.t * 2.2);
      if (s.t > s.life) { this.smokes.splice(i, 1); continue; }
      s.emit -= dt;
      if (s.emit <= 0 && s.t < s.life - 2.5) {
        s.emit = 0.045;
        const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * s.r * 0.85;
        const g = 0.72 + Math.random() * 0.12;
        this.smoke.emit(V(s.p.x + Math.cos(a) * rr, s.p.y + 0.4 + Math.random() * Math.min(3.2, s.r * 0.8), s.p.z + Math.sin(a) * rr), V(rand(-0.25, 0.25), rand(0.02, 0.12), rand(-0.25, 0.25)), [g, g + 0.02, g + 0.02], rand(3.0, 4.6), rand(5, 7), { drag: 0.6, grow: 0.3, alpha: 0.85, fadeIn: 0.12 });
      }
    }
  }
}
const _ab = V(), _ac = V();
