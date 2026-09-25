// Particles: sea spray and splashes, golden sparkles, sand dust, and loose feathers that
// flutter down when the pelican bumps something.
import { THREE, V3, clamp, canvas, scene, TAU, noReflect } from './core.js';

function dotTex() {
  const S = 64, c = canvas(S, S), g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S); return new THREE.CanvasTexture(c);
}

class Pool {
  constructor(n, additive) {
    this.n = n; this.i = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.size = new Float32Array(n); this.g = new Float32Array(n); this.drag = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sa = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pa); geo.setAttribute('pcol', this.ca); geo.setAttribute('size', this.sa);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dotTex() }, uScale: { value: innerHeight / 2 } }, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute float size; attribute vec4 pcol; varying vec4 vC; uniform float uScale; void main(){ vC = pcol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); }',
    });
    this.mat = mat; this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; scene.add(noReflect(this.points));
  }
  emit(p, v, col, size, life, g = 9.8, drag = 0.5) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.p.set([p.x, p.y, p.z], i * 3); this.v.set([v.x, v.y, v.z], i * 3); this.c.set([col.r, col.g, col.b], i * 3);
    this.life[i] = this.max[i] = life; this.size[i] = size; this.g[i] = g; this.drag[i] = drag;
  }
  update(dt) {
    const P = this.pa.array, C = this.ca.array, S = this.sa.array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { S[i] = 0; continue; }
      this.life[i] -= dt; const k = i * 3, dr = Math.exp(-this.drag[i] * dt);
      this.v[k + 1] -= this.g[i] * dt; for (let d = 0; d < 3; d++) { this.v[k + d] *= dr; this.p[k + d] += this.v[k + d] * dt; }
      P[k] = this.p[k]; P[k + 1] = this.p[k + 1]; P[k + 2] = this.p[k + 2];
      const a = clamp(this.life[i] / this.max[i], 0, 1);
      C[i * 4] = this.c[k]; C[i * 4 + 1] = this.c[k + 1]; C[i * 4 + 2] = this.c[k + 2]; C[i * 4 + 3] = Math.min(1, a * 2) * 0.9;
      S[i] = this.size[i] * (0.6 + 0.4 * a);
    }
    this.pa.needsUpdate = this.ca.needsUpdate = this.sa.needsUpdate = true;
    this.mat.uniforms.uScale.value = innerHeight * 0.9;
  }
}

export class FX {
  constructor(cardMat) {
    this.spray = new Pool(600, false); this.glow = new Pool(300, true);
    // loose feathers
    const n = 24; this.fe = [];
    const g = new THREE.PlaneGeometry(0.03, 0.09).translate(0, 0.045, 0);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * 0.9, uv.getY(i));
    this.feathers = new THREE.InstancedMesh(g, cardMat, n); this.feathers.frustumCulled = false; this.feathers.castShadow = true;
    const white = new THREE.Color(0xf4efe8); for (let i = 0; i < n; i++) { this.feathers.setColorAt(i, white); this.fe.push({ p: new V3(), v: new V3(), r: new THREE.Euler(), w: new V3(), life: 0 }); }
    scene.add(noReflect(this.feathers)); this.fi = 0; this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.zero = new V3(0, 0, 0);
    this.col = new THREE.Color();
  }
  splash(p, n = 30, scale = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (0.5 + Math.random() * 2.5) * scale;
      this.spray.emit(p, new V3(Math.cos(a) * s, (2 + Math.random() * 4) * scale, Math.sin(a) * s), this.col.setRGB(0.85, 0.93, 1), 0.07 + Math.random() * 0.1, 0.7 + Math.random() * 0.6, 9.8, 0.8);
    }
  }
  trail(p, v) { this.spray.emit(p, v, this.col.setRGB(0.8, 0.9, 1), 0.04, 0.5, 6, 1.5); }
  sparkle(p, n = 20) {
    for (let i = 0; i < n; i++) {
      const d = new V3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(0.5 + Math.random() * 1.5);
      this.glow.emit(p, d, this.col.setRGB(1, 0.8 + Math.random() * 0.2, 0.35), 0.05 + Math.random() * 0.06, 0.6 + Math.random() * 0.8, -0.3, 1.2);
    }
  }
  dust(p, v, sand) {
    this.spray.emit(p, new V3(v.x * 0.2 + (Math.random() - 0.5), 0.4 + Math.random() * 0.6, v.z * 0.2 + (Math.random() - 0.5)), sand ? this.col.setRGB(0.85, 0.75, 0.55) : this.col.setRGB(0.6, 0.58, 0.55), 0.12 + Math.random() * 0.12, 0.8, 1.5, 2.5);
  }
  puff(p, n = 8) {
    for (let k = 0; k < n; k++) {
      const f = this.fe[this.fi]; this.fi = (this.fi + 1) % this.fe.length;
      f.p.copy(p).add(new V3((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3));
      f.v.set((Math.random() - 0.5) * 2.5, 1 + Math.random() * 2, (Math.random() - 0.5) * 2.5); f.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      f.w.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8); f.life = 3 + Math.random() * 2;
    }
  }
  update(dt, t) {
    this.spray.update(dt); this.glow.update(dt);
    for (let i = 0; i < this.fe.length; i++) {
      const f = this.fe[i];
      if (f.life <= 0) { this.m.makeScale(0, 0, 0); this.feathers.setMatrixAt(i, this.m); continue; }
      f.life -= dt; f.v.y = Math.max(f.v.y - 3 * dt, -0.45 + Math.sin(t * 6 + i) * 0.2); f.v.x *= Math.exp(-dt); f.v.z *= Math.exp(-dt);
      f.p.addScaledVector(f.v, dt); f.r.x += f.w.x * dt * 0.3; f.r.y += f.w.y * dt; f.r.z = Math.sin(t * 5 + i) * 0.8;
      const s = Math.min(1, f.life); this.m.compose(f.p, this.q.setFromEuler(f.r), new V3(s, s, s)); this.feathers.setMatrixAt(i, this.m);
    }
    this.feathers.instanceMatrix.needsUpdate = true;
  }
}
