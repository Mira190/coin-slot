// A knitted scarf: a wrap that follows the neck, and two verlet-cloth tails pinned at the knot.
// The tails feel gravity, the air stream from riding (per-triangle aerodynamic force), gusts,
// and collide with spheres fitted to the pelican's neck and back.
import { THREE, V3, clamp, canvas, normalFromHeight, TAU, mesh, reduceMotion } from './core.js';

function knitTextures() {
  const W = 128, H = 256, c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data, hts = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // stockinette "V" stitches: 8 columns across, rows 8 px
    const cx = (x % 16) / 16, row = y % 8 / 8, v = Math.abs(cx - 0.5) * 2;
    const st = Math.max(0, 1 - Math.abs((v - row) * 3.2)) * 0.8 + 0.2;
    const band = Math.floor(y / 32) % 4; // cream stripes
    const red = band === 1 ? [238, 226, 200] : [178, 26, 38];
    const fringeEnd = y > H - 20;
    const i = (y * W + x) * 4, k = 0.62 + 0.38 * st;
    d[i] = red[0] * k; d[i + 1] = red[1] * k; d[i + 2] = red[2] * k;
    d[i + 3] = fringeEnd ? ((x % 6) < 3 ? 255 : 0) : 255;
    hts[y * W + x] = st;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  return { map, normal: normalFromHeight(hts, W, H, 2.5) };
}

export class Scarf {
  constructor(pel) {
    this.pel = pel;
    const k = knitTextures();
    this.mat = new THREE.MeshPhysicalMaterial({ map: k.map, normalMap: k.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xff8080), side: THREE.DoubleSide, alphaTest: 0.5 });
    // --- wrap (in pelican-local space, rebuilt each frame around the neck)
    this.RA = 28; this.RB = 4;
    const wg = new THREE.BufferGeometry(), wn = (this.RA + 1) * this.RB;
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wn * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const wuv = new Float32Array(wn * 2); for (let i = 0; i <= this.RA; i++) for (let j = 0; j < this.RB; j++) { wuv[(i * this.RB + j) * 2] = j / (this.RB - 1) * 0.5; wuv[(i * this.RB + j) * 2 + 1] = i / this.RA * 1.4; }
    wg.setAttribute('uv', new THREE.BufferAttribute(wuv, 2));
    const wi = []; for (let i = 0; i < this.RA; i++) for (let j = 0; j < this.RB - 1; j++) { const a = i * this.RB + j, b = a + this.RB; wi.push(a, b, a + 1, b, b + 1, a + 1); }
    wg.setIndex(wi); this.wrap = mesh(wg, this.mat); this.wrap.frustumCulled = false; pel.root.add(this.wrap);
    // --- tails: W x H particles each, simulated in world space
    this.W = 5; this.H = 20; this.len = 0.52; this.wid = 0.09;
    this.tails = [0, 1].map((ti) => this.makeTail(ti));
    this.t = 0; this.gust = 0; this.inited = false;
    this.spheres = [{ c: new V3(), r: 0 }, { c: new V3(), r: 0 }, { c: new V3(), r: 0 }, { c: new V3(), r: 0 }];
  }
  makeTail(ti) {
    const W = this.W, H = this.H, n = W * H;
    const P = new Float32Array(n * 3), O = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { uv[(y * W + x) * 2] = x / (W - 1) * 0.5 + ti * 0.5; uv[(y * W + x) * 2 + 1] = 1 - y / (H - 1); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = []; for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const a = y * W + x, b = a + W; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setIndex(idx);
    const m = mesh(g, this.mat); m.frustumCulled = false; m.name = 'scarf';
    // constraints: structural, shear, bend
    const C = [];
    const dx = this.wid / (W - 1), dy = this.len / (H - 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x < W - 1) C.push(i, i + 1, dx);
      if (y < H - 1) C.push(i, i + W, dy);
      if (x < W - 1 && y < H - 1) { C.push(i, i + W + 1, Math.hypot(dx, dy)); C.push(i + 1, i + W, Math.hypot(dx, dy)); }
      if (y < H - 2) C.push(i, i + 2 * W, dy * 2);
    }
    return { P, O, g, m, C, ti, anchor: [] };
  }
  addTo(sceneRoot) { for (const T of this.tails) sceneRoot.add(T.m); }
  // knot points (pelican-local) for tail ti
  anchors(ti, out) {
    const pel = this.pel, jf = 6.15, ang = ti === 0 ? 2.6 : 2.35; // front-left side of the neck
    const P = new V3(), Tn = new V3(), N = new V3();
    for (let x = 0; x < this.W; x++) {
      const a = ang + (x / (this.W - 1) - 0.5) * 0.5;
      pel.body.frameAt(jf + (ti ? -0.25 : 0.05), -Math.cos(a), Math.sin(a), P, Tn, N);
      out[x] = (out[x] || new V3()).copy(P).addScaledVector(N, 0.018 + ti * 0.006);
    }
    return out;
  }
  update(dt, vel, wind) {
    if (!(dt > 1e-5)) return;
    this.t += dt;
    const pel = this.pel; pel.root.updateWorldMatrix(true, false);
    const M = pel.root.matrixWorld;
    // wrap around the neck
    {
      const pos = this.wrap.geometry.attributes.position.array, P = new V3(), Tn = new V3(), N = new V3();
      for (let i = 0; i <= this.RA; i++) {
        const a = i / this.RA * TAU;
        for (let j = 0; j < this.RB; j++) {
          const jf = 5.75 + j / (this.RB - 1) * 0.75;
          pel.body.frameAt(jf, -Math.cos(a), Math.sin(a), P, Tn, N);
          const bulge = 0.013 + Math.sin(j / (this.RB - 1) * Math.PI) * 0.01;
          P.addScaledVector(N, bulge);
          const k = (i * this.RB + j) * 3; pos[k] = P.x; pos[k + 1] = P.y; pos[k + 2] = P.z;
        }
      }
      this.wrap.geometry.attributes.position.needsUpdate = true; this.wrap.geometry.computeVertexNormals();
    }
    // collision spheres (world): neck segments and the back
    const J = pel.joints, S = this.spheres;
    const put = (s, j, r) => { s.c.copy(J[j].p).applyMatrix4(M); s.r = r; };
    put(S[0], 5, 0.1); put(S[1], 7, 0.06); put(S[2], 3, 0.19); put(S[3], 2, 0.17);
    // air relative to the scarf: riding creates a headwind, plus gusts
    this.gust += (Math.random() - 0.5) * dt * 3; this.gust *= Math.exp(-dt * 0.8);
    const air = new V3().copy(wind).sub(vel);
    const steps = 2, h = Math.min(dt, 1 / 30) / steps;
    for (const T of this.tails) {
      const an = this.anchors(T.ti, T.anchor).map((v) => v.clone().applyMatrix4(M));
      if (!this.inited || !T.ready) {
        // lay the tail out behind the knot
        const back = new V3(0, 0, -1).transformDirection(M), down = new V3(0, -1, 0);
        for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
          const p = an[x].clone().addScaledVector(back, y / (this.H - 1) * this.len * 0.7).addScaledVector(down, y / (this.H - 1) * this.len * 0.5), i = (y * this.W + x) * 3;
          T.P[i] = T.O[i] = p.x; T.P[i + 1] = T.O[i + 1] = p.y; T.P[i + 2] = T.O[i + 2] = p.z;
        }
        T.ready = true;
      }
      for (let s = 0; s < steps; s++) this.step(T, an, h, air);
      // self-heal: if anything ever went non-finite, lay the tail out again next frame
      if (!Number.isFinite(T.P[T.P.length - 1]) || !Number.isFinite(T.P[0])) { T.ready = false; continue; }
      const pos = T.g.attributes.position.array; pos.set(T.P); T.g.attributes.position.needsUpdate = true; T.g.computeVertexNormals();
    }
    this.inited = true;
  }
  step(T, an, h, air) {
    const P = T.P, O = T.O, W = this.W, H = this.H, n = W * H;
    const acc = new Float32Array(n * 3);
    // gravity
    for (let i = 0; i < n; i++) acc[i * 3 + 1] = -9.8;
    // aerodynamic force per triangle: pushes along the normal by the normal component of the relative air
    const turb = reduceMotion ? 0.3 : 1;
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const a = y * W + x, b = a + 1, c = a + W;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const area = Math.hypot(nx, ny, nz) || 1e-6; nx /= area; ny /= area; nz /= area;
      // particle velocity (verlet)
      const pvx = (ax - O[a * 3]) / h, pvy = (ay - O[a * 3 + 1]) / h, pvz = (az - O[a * 3 + 2]) / h;
      const wob = Math.sin(this.t * 17 + y * 0.9) * 1.2 * turb + this.gust;
      const rx = air.x - pvx + wob * 0.6, ry = air.y - pvy + wob * 0.4, rz = air.z - pvz;
      const f = (nx * rx + ny * ry + nz * rz) * 9;
      for (const i of [a, b, c]) { acc[i * 3] += nx * f; acc[i * 3 + 1] += ny * f; acc[i * 3 + 2] += nz * f; }
    }
    // integrate
    const damp = 0.985;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      for (let d = 0; d < 3; d++) { const p = P[k + d], v = (p - O[k + d]) * damp; O[k + d] = p; P[k + d] = p + v + acc[k + d] * h * h; }
    }
    // constraints
    const C = T.C;
    for (let it = 0; it < 6; it++) {
      for (let x = 0; x < W; x++) { const k = x * 3; P[k] = an[x].x; P[k + 1] = an[x].y; P[k + 2] = an[x].z; }
      for (let c = 0; c < C.length; c += 3) {
        const i = C[c] * 3, j = C[c + 1] * 3, rest = C[c + 2];
        const dx = P[j] - P[i], dy = P[j + 1] - P[i + 1], dz = P[j + 2] - P[i + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
        const k = (d - rest) / d * 0.5, pinI = i < W * 3, pinJ = j < W * 3;
        const wi = pinI ? 0 : pinJ ? 1 : 0.5, wj = pinJ ? 0 : pinI ? 1 : 0.5;
        P[i] += dx * k * 2 * wi; P[i + 1] += dy * k * 2 * wi; P[i + 2] += dz * k * 2 * wi;
        P[j] -= dx * k * 2 * wj; P[j + 1] -= dy * k * 2 * wj; P[j + 2] -= dz * k * 2 * wj;
      }
      // spheres
      for (const s of this.spheres) for (let i = W; i < n; i++) {
        const k = i * 3, dx = P[k] - s.c.x, dy = P[k + 1] - s.c.y, dz = P[k + 2] - s.c.z, d = Math.hypot(dx, dy, dz);
        if (d < s.r && d > 1e-5) { const f = s.r / d; P[k] = s.c.x + dx * f; P[k + 1] = s.c.y + dy * f; P[k + 2] = s.c.z + dz * f; }
      }
    }
  }
}
