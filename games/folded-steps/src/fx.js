// Folded Steps: particles and markers. Drifting motes, sparkle bursts, splashes, the tap ring and path beads.
import * as THREE from 'three';
import { mat } from './deco.js';

const PT_VS = `attribute float aSize; attribute float aAlpha; attribute vec3 aCol; varying float vA; varying vec3 vC; uniform float uPx;
  void main(){ vA = aAlpha; vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx; }`;
const PT_FS = `varying float vA; varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.0, r); a *= a; gl_FragColor = vec4(vC * (1.0 + a), a * vA); }`;

class Pool {
  constructor(scene, n, blending = THREE.AdditiveBlending) {
    this.n = n;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    this.u = { uPx: { value: 1 } };
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending }));
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 5;
    scene.add(this.pts);
    this.p = Array.from({ length: n }, () => ({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1, col: new THREE.Color(), grav: 0, drag: 0 }));
    this.next = 0;
  }
  emit(pos, vel, o) {
    const q = this.p[this.next++ % this.n];
    q.pos.copy(pos); q.vel.copy(vel); q.life = q.max = o.life; q.size = o.size; q.col.set(o.col); q.grav = o.grav || 0; q.drag = o.drag || 0; q.fade = o.fade ?? 1;
  }
  update(dt, px) {
    this.u.uPx.value = px;
    const g = this.pts.geometry, P = g.attributes.position, S = g.attributes.aSize, A = g.attributes.aAlpha, C = g.attributes.aCol;
    this.p.forEach((q, i) => {
      if (q.life > 0) {
        q.life -= dt;
        q.vel.y -= q.grav * dt;
        q.vel.multiplyScalar(1 - q.drag * dt);
        q.pos.addScaledVector(q.vel, dt);
      }
      const k = Math.max(0, q.life / q.max);
      P.setXYZ(i, q.pos.x, q.pos.y, q.pos.z);
      S.setX(i, q.life > 0 ? q.size * (0.4 + 0.6 * k) : 0);
      A.setX(i, q.life > 0 ? Math.min(1, k * 3) * (q.fade ? k : 1) : 0);
      C.setXYZ(i, q.col.r, q.col.g, q.col.b);
    });
    P.needsUpdate = S.needsUpdate = A.needsUpdate = C.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.burst = new Pool(scene, 420);
    this.motes = new Pool(scene, 110);
    this.box = null;
    this.reduce = false;
    // tap ring + path beads
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    this.ring.renderOrder = 6;
    scene.add(this.ring);
    this.ringT = 1;
    this.beads = [];
    this.hint = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 48), new THREE.MeshBasicMaterial({ color: '#ffe38a', transparent: true, opacity: 0, depthWrite: false }));
    this.hint.renderOrder = 6;
    scene.add(this.hint);
    this.hintOn = false;
  }
  setPalette(P) { this.P = P; this.ring.material.color.set(P.glow).lerp(new THREE.Color('#ffffff'), 0.4); this.hint.material.color.set(P.glow); }
  // ambient motes fill a box above the level
  setBox(center, size) { this.box = { c: center.clone(), s: size.clone() }; this.motes.p.forEach((q) => (q.life = 0)); }
  sparkle(pos, n = 30, col, spread = 1.2, up = 1.4) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * up + 0.2, (Math.random() - 0.5) * spread);
      this.burst.emit(pos, v, { life: 0.7 + Math.random() * 0.9, size: 5 + Math.random() * 7, col: col || this.P.glow, grav: 0.6, drag: 1.2 });
    }
  }
  splash(pos, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.5;
      const v = new THREE.Vector3(Math.cos(a) * r, 1.5 + Math.random() * 2.2, Math.sin(a) * r);
      this.burst.emit(pos, v, { life: 0.6 + Math.random() * 0.5, size: 4 + Math.random() * 5, col: '#ffffff', grav: 6, drag: 0.4 });
    }
  }
  tap(c, n, bad) {
    this.ring.position.copy(c).addScaledVector(n, 0.02);
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.ring.material.color.set(bad ? '#e8837a' : this.P.glow).lerp(new THREE.Color('#ffffff'), bad ? 0.1 : 0.35);
    this.ringT = 0;
  }
  path(points) {
    for (const b of this.beads) this.scene.remove(b);
    this.beads = points.map((p, i) => {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), new THREE.MeshBasicMaterial({ color: this.P.glow, transparent: true, opacity: 0, depthWrite: false }));
      b.position.copy(p.c).addScaledVector(p.n, 0.03);
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.n);
      b.userData.t = -i * 0.05;
      b.renderOrder = 6;
      this.scene.add(b);
      return b;
    });
  }
  eatBead(i) { const b = this.beads[i]; if (b) b.userData.dead = true; }
  showHint(c, n) { this.hint.position.copy(c).addScaledVector(n, 0.03); this.hint.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); this.hintOn = true; }
  clearHint() { this.hintOn = false; }
  update(dt, t, px) {
    // motes: slow upward drift with a sideways sway, recycled when they die
    if (this.box) {
      const want = this.reduce ? 25 : 110;
      for (let i = 0; i < want; i++) {
        const q = this.motes.p[i];
        if (q.life <= 0) {
          const b = this.box;
          q.pos.set(b.c.x + (Math.random() - 0.5) * b.s.x, b.c.y + (Math.random() - 0.5) * b.s.y, b.c.z + (Math.random() - 0.5) * b.s.z);
          q.vel.set((Math.random() - 0.5) * 0.12, 0.08 + Math.random() * 0.18, (Math.random() - 0.5) * 0.12);
          q.max = q.life = 5 + Math.random() * 6;
          q.size = 2.5 + Math.random() * 3.5;
          q.col.set(Math.random() < 0.7 ? this.P.glow : '#ffffff');
          q.fade = 0; q.grav = 0; q.drag = 0;
        }
        q.vel.x += Math.sin(t * 0.7 + i) * 0.002;
      }
    }
    this.motes.update(dt * (this.reduce ? 0.4 : 1), px);
    this.burst.update(dt, px);
    this.ringT = Math.min(1, this.ringT + dt * 1.6);
    this.ring.material.opacity = (1 - this.ringT) * 0.85;
    this.ring.scale.setScalar(0.6 + this.ringT * 0.8);
    for (const b of this.beads) {
      b.userData.t += dt;
      const target = b.userData.dead ? 0 : 0.8;
      b.material.opacity += (Math.min(target, Math.max(0, b.userData.t * 4)) - b.material.opacity) * Math.min(1, dt * 12);
    }
    const ho = this.hintOn ? 0.55 + Math.sin(t * 5) * 0.35 : 0;
    this.hint.material.opacity += (ho - this.hint.material.opacity) * Math.min(1, dt * 8);
    this.hint.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
  }
}
export { mat };
