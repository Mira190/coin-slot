// The pelican: a great white pelican (Pelecanus onocrotalus) in breeding blush.
// Body, neck and head are one lofted surface along an animated spine; bill, pouch, eyes, legs,
// feet and wings are procedural meshes rebuilt or re-posed every frame. Pelican-local space:
// +z forward, +y up, +x left, origin on the saddle.
import {
  THREE, V3, clamp, lerp, damp, smooth, hash, rng, TAU, canvas, dataTex, normalFromHeight,
  mesh, placeLimb, ik2, basisQuat, reduceMotion,
} from './core.js';
import { G } from './bike.js';
// rear wheel in pelican space (the pelican sits on the saddle): the fender is G.R + 14 mm, plus 6 mm to spare
const REAR = G.RA.clone().sub(G.saddle), REAR_R = G.R + 0.02;

// ================================================================ textures
// Overlapping contour feathers as a tiling height field: rounded tips point to -u (towards
// the tail); the most head-ward feather is on top, like roof tiles. Returns normal + albedo.
function featherTile(N = 512, cols = 8, rows = 8) {
  const R = rng(11);
  const cw = N / cols, ch = N / rows, L = 1.55 * cw, hw = 0.64 * ch;
  const cells = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    cells.push({ i, j, cx: (i + 0.5) * cw + (R() - 0.5) * cw * 0.22, cy: (j + 0.5 + (i & 1) * 0.5) * ch + (R() - 0.5) * ch * 0.2, tone: R(), warm: R() });
  }
  const cell = (i, j) => cells[(((i % cols) + cols) % cols) * rows + (((j % rows) + rows) % rows)];
  const wrap = (d) => d - Math.round(d / N) * N;
  const hts = new Float32Array(N * N), alb = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let best = -1e9, A = 0, B = 0, P = 1, C = null;
    const ix = Math.floor(x / cw), jy = Math.floor(y / ch);
    for (let di = -1; di <= 2; di++) for (let dj = -2; dj <= 1; dj++) {
      const c = cell(ix + di, jy + dj);
      const dx = wrap(c.cx + 0.42 * cw - x), dy = wrap(y - c.cy);
      const a = dx / L; if (a < -0.06 || a > 1) continue;
      const b = dy / hw, prof = Math.sqrt(Math.max(0, 1 - ((a - 0.46) / 0.54) ** 2));
      if (Math.abs(b) > prof) continue;
      if (dx > best) { best = dx; A = a; B = b; P = prof; C = c; }
    }
    const i4 = (y * N + x) * 4;
    if (!C) { hts[y * N + x] = 0; alb[i4] = alb[i4 + 1] = alb[i4 + 2] = 170; alb[i4 + 3] = 255; continue; }
    const edge = 1 - Math.abs(B) / Math.max(P, 1e-3);
    let h = 0.18 + 0.62 * A;
    h -= 0.22 * (1 - smooth(0, 0.4, edge));
    h -= 0.05 * Math.exp(-(((B * hw) / 1.3) ** 2)) * (A < 0.93 ? 1 : 0);
    h += 0.028 * Math.sin(((1 - A) * L * 0.85 + Math.abs(B) * hw * 0.75) * 2.1);
    hts[y * N + x] = h;
    const ao = 0.84 + 0.16 * smooth(0.0, 0.55, A);
    const v = (0.86 + 0.14 * C.tone) * ao * (0.93 + 0.07 * smooth(0, 0.3, edge)) + 0.05 * Math.exp(-(((B * hw) / 1.3) ** 2));
    alb[i4] = clamp(v * (1.0 + (C.warm - 0.5) * 0.05), 0, 1) * 255;
    alb[i4 + 1] = clamp(v, 0, 1) * 255;
    alb[i4 + 2] = clamp(v * (1.0 - (C.warm - 0.5) * 0.06), 0, 1) * 255;
    alb[i4 + 3] = 255;
  }
  return { normal: normalFromHeight(hts, N, N, 2.3), albedo: dataTex(alb, N, N, { srgb: true }) };
}

// A single flight/contour feather for the instanced cards: base at v=0, tip at v=1, rachis at u=0.5.
function featherCardTex() {
  const W = 128, H = 512, c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  const R = rng(5); const notch = []; for (let i = 0; i < 40; i++) notch.push(R());
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H;
    const wv = 0.46 * Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * Math.min(1, v * 1.02))), 0.42) * (1 - 0.3 * v);
    for (let x = 0; x < W; x++) {
      const u = x / W, dx = u - 0.5, ax = Math.abs(dx);
      const i = (y * W + x) * 4;
      // barbs run from the rachis towards the tip; small splits make the fringe ragged
      const barb = 0.5 + 0.5 * Math.sin((v * 90 - ax * 64)); // ~6 px a barb: finer aliases into moiré bands
      const split = notch[Math.floor(v * 39)] > 0.85 && ax > wv * 0.55 ? 0.8 : 1;
      const inside = ax < wv * split * (0.97 + 0.03 * barb);
      const rachis = Math.exp(-((dx / 0.012) ** 2)) * (v < 0.97 ? 1 : 0);
      const down = v < 0.12 ? 0.75 + v * 2 : 1;
      let l = (0.82 + 0.1 * barb) * (0.92 + 0.08 * (1 - ax / 0.5)) * down;
      l = l * (1 - rachis) + 1.0 * rachis;
      d[i] = d[i + 1] = d[i + 2] = clamp(l, 0, 1) * 255;
      d[i + 3] = inside || rachis > 0.3 ? 255 : 0;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// pouch: yolk-yellow skin with branching red-orange veins (uv: s along bill, t across)
function pouchTex() {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#e8862e'); grd.addColorStop(0.35, '#f1a93e'); grd.addColorStop(1, '#f5c25a');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // mottling
  const R = rng(3);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${200 + R() * 55},${120 + R() * 60},${40 + R() * 30},${0.05 + R() * 0.06})`; g.beginPath(); g.arc(R() * W, R() * H, 2 + R() * 9, 0, TAU); g.fill(); }
  g.lineCap = 'round';
  const vein = (x, y, a, w, len, depth) => {
    g.strokeStyle = `rgba(${160 + depth * 14},${34 + depth * 12},${30},${0.75 - depth * 0.1})`;
    let px = x, py = y;
    for (let k = 0; k < len; k++) {
      a += (R() - 0.5) * 0.5; const nx = px + Math.cos(a) * 6, ny = py + Math.sin(a) * 6;
      g.lineWidth = w * (1 - k / len * 0.6); g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      px = nx; py = ny;
      if (depth < 4 && R() < 0.12) vein(px, py, a + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), w * 0.6, len * 0.55, depth + 1);
    }
  };
  // main vessels run from the throat (s=0, left) along the pouch; mirrored across t
  for (let k = 0; k < 7; k++) { const y = H * (0.12 + k * 0.126); vein(0, y, (R() - 0.5) * 0.3, 3.2, 70, 0); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function irisTex() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#e7b8a0'; g.fillRect(0, 0, S, S); // periocular skin at the back
  const cx = S / 2, R0 = S * 0.47;
  const gr = g.createRadialGradient(cx, cx, S * 0.1, cx, cx, R0);
  gr.addColorStop(0, '#5a1a12'); gr.addColorStop(0.55, '#7a2c1a'); gr.addColorStop(0.85, '#4a140e'); gr.addColorStop(1, '#1a0806');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, R0, 0, TAU); g.fill();
  const R = rng(9);
  for (let i = 0; i < 220; i++) { // radial fibres
    const a = R() * TAU, r1 = S * (0.14 + R() * 0.05), r2 = R0 * (0.7 + R() * 0.3);
    g.strokeStyle = `rgba(${150 + R() * 70},${60 + R() * 40},${30},${0.18 + R() * 0.2})`; g.lineWidth = 0.6 + R() * 1.2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a + (R() - 0.5) * 0.1) * r2, cx + Math.sin(a) * r2); g.stroke();
  }
  g.fillStyle = '#050303'; g.beginPath(); g.arc(cx, cx, S * 0.16, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ================================================================ materials
let MATS = null;
function materials() {
  if (MATS) return MATS;
  const tile = featherTile();
  const feather = new THREE.MeshPhysicalMaterial({
    vertexColors: true, map: tile.albedo, normalMap: tile.normal, normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.8, metalness: 0, sheen: 0.7, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffffff), specularIntensity: 0.3,
  });
  // per-vertex feather mask: bare facial / gular skin gets no feather normals and less sheen,
  // and a soft back-scatter rim makes the white plumage glow at golden hour
  feather.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float fmask;\nvarying float vFm;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFm = fmask;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFm;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(nonPerturbedNormal, normal, vFm));')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n vec4 tcol = texture2D( map, vMapUv );\n diffuseColor.rgb *= mix(vec3(1.0), tcol.rgb, vFm);\n#endif')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\n material.sheenColor *= diffuseColor.rgb * mix(1.6, 0.4, 1.0 - vFm);\n#endif')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);\n  reflectedLight.indirectDiffuse += rim * vFm * 0.35 * diffuseColor.rgb * (iblIrradiance + irradiance) * RECIPROCAL_PI; }');
  };
  const cardTex = featherCardTex();
  // the cards answer light like the body plumage: sheen tinted by the (instance) feather colour, so white
  // coverts glow warm like the body and black remiges stay sooty instead of mirroring the blue sky
  const card = new THREE.MeshPhysicalMaterial({
    map: cardTex, bumpMap: cardTex, bumpScale: 0.45, alphaTest: 0.5, side: THREE.DoubleSide,
    roughness: 0.8, sheen: 0.7, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffffff), specularIntensity: 0.3,
  });
  card.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\n material.sheenColor *= diffuseColor.rgb * 1.6;\n#endif')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ float rim = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0);\n  reflectedLight.indirectDiffuse += rim * 0.35 * diffuseColor.rgb * (iblIrradiance + irradiance) * RECIPROCAL_PI; }');
  };
  const bill = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.35, specularIntensity: 0.45 });
  const pouch = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: pouchTex(), roughness: 0.4, transmission: 0.38, thickness: 0.014, ior: 1.36,
    attenuationColor: new THREE.Color(0xff5a20), attenuationDistance: 0.022, side: THREE.DoubleSide,
    sheen: 0.35, sheenColor: new THREE.Color(0xffd9a0), clearcoat: 0.25, clearcoatRoughness: 0.3, specularIntensity: 0.5,
  });
  // inside of the pouch reads as mouth lining (redder, darker) on its back faces
  pouch.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb *= vec3(0.78, 0.4, 0.36);');
  };
  const gape = new THREE.MeshPhysicalMaterial({ color: 0xe99b7a, roughness: 0.5, sheen: 0.5, sheenColor: new THREE.Color(0xffc8a8), side: THREE.DoubleSide });
  const eye = new THREE.MeshPhysicalMaterial({ map: irisTex(), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1 });
  const lid = new THREE.MeshPhysicalMaterial({ color: 0xf1ae8c, roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color(0xffd0b0) });
  const nict = new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false, clearcoat: 1 });
  MATS = { feather, card, bill, pouch, gape, eye, lid, nict };
  return MATS;
}

// ================================================================ loft
// Catmull-Rom spine through joints {p, w, ht, hb, e, fs}; each ring is a superellipse with
// separate dorsal (ht) and ventral (hb) radii; frames by parallel transport from B0 (lateral).
const crs = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
class Loft {
  constructor(joints, N, density, colorFn, mat, tile = 0.3) {
    this.J = joints; this.N = N;
    this.rps = [];
    for (let i = 0; i < joints.length - 1; i++) this.rps.push(Math.max(2, Math.round(joints[i].p.distanceTo(joints[i + 1].p) * density)));
    this.K = this.rps.reduce((a, b) => a + b, 0) + 1;
    const K = this.K, M = N + 1, n = K * M + 2; // + a centre vertex for each end cap
    this.pos = new Float32Array(n * 3); this.nrm = new Float32Array(n * 3);
    this.C = []; this.T = []; this.B = []; this.D = []; this.prof = [];
    for (let k = 0; k < K; k++) { this.C.push(new V3()); this.T.push(new V3()); this.B.push(new V3()); this.D.push(new V3()); this.prof.push({ w: 0, ht: 0, hb: 0, e: 1, fs: 1, jf: 0 }); }
    this.bulge = null; // optional (jf) => [scale, ventral bias]
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let k = 0; k < K - 1; k++) for (let j = 0; j < N; j++) { const a = k * M + j, b = a + M; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    // end caps: the loft is a closed surface (no hollow rings at the tail or at the bill base)
    const cS = K * M, cE = K * M + 1, last = (K - 1) * M;
    for (let j = 0; j < N; j++) { idx.push(cS, j + 1, j); idx.push(cE, last + j, last + j + 1); }
    g.setIndex(idx);
    this.geo = g; this.mesh = mesh(g, mat); this.mesh.frustumCulled = false;
    this.sample();
    // static attributes from the rest pose: uv in feather-tile units, colours, feather mask
    const uv = new Float32Array(n * 2), col = new Float32Array(n * 3), fm = new Float32Array(n), cc = new THREE.Color();
    let u = 0;
    for (let k = 0; k < K; k++) {
      const P = this.prof[k];
      if (k > 0) u += this.C[k].distanceTo(this.C[k - 1]) / (tile * P.fs);
      const a = P.w, b = (P.ht + P.hb) / 2, circ = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      const vs = circ / (tile * P.fs);
      for (let j = 0; j <= N; j++) {
        const th = j / N * TAU, i = k * M + j;
        uv[i * 2] = u; uv[i * 2 + 1] = j / N * Math.max(1, Math.round(vs));
        fm[i] = colorFn(cc, P.jf, -Math.cos(th), Math.sin(th));
        col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      }
    }
    // caps take the colour of their ring (averaged round it)
    for (const [ci, k] of [[K * M, 0], [K * M + 1, K - 1]]) {
      let r = 0, gg = 0, b = 0, f = 0; for (let j = 0; j < N; j++) { const i = k * M + j; r += col[i * 3]; gg += col[i * 3 + 1]; b += col[i * 3 + 2]; f += fm[i]; }
      col[ci * 3] = r / N; col[ci * 3 + 1] = gg / N; col[ci * 3 + 2] = b / N; fm[ci] = f / N; uv[ci * 2] = uv[k * M * 2]; uv[ci * 2 + 1] = 0.5;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('fmask', new THREE.BufferAttribute(fm, 1));
    this.update(new V3(1, 0, 0));
  }
  sample() {
    const J = this.J, n = J.length;
    let k = 0;
    for (let i = 0; i < n - 1; i++) {
      const j0 = J[Math.max(0, i - 1)], j1 = J[i], j2 = J[i + 1], j3 = J[Math.min(n - 1, i + 2)];
      const r = this.rps[i];
      for (let s = 0; s < r || (i === n - 2 && s === r); s++) {
        const t = s / r, C = this.C[k], P = this.prof[k];
        C.set(crs(j0.p.x, j1.p.x, j2.p.x, j3.p.x, t), crs(j0.p.y, j1.p.y, j2.p.y, j3.p.y, t), crs(j0.p.z, j1.p.z, j2.p.z, j3.p.z, t));
        const tt = t * t * (3 - 2 * t);
        P.w = Math.max(0.001, crs(j0.w, j1.w, j2.w, j3.w, t)); P.ht = Math.max(0.001, crs(j0.ht, j1.ht, j2.ht, j3.ht, t)); P.hb = Math.max(0.001, crs(j0.hb, j1.hb, j2.hb, j3.hb, t));
        P.e = lerp(j1.e, j2.e, tt); P.fs = lerp(j1.fs, j2.fs, tt); P.jf = i + t;
        k++;
      }
    }
  }
  update(B0) {
    this.sample();
    const K = this.K, N = this.N, M = N + 1, C = this.C, T = this.T, B = this.B, D = this.D, pos = this.pos, nrm = this.nrm;
    for (let k = 0; k < K; k++) T[k].subVectors(C[Math.min(K - 1, k + 1)], C[Math.max(0, k - 1)]).normalize();
    B[0].copy(B0).addScaledVector(T[0], -B0.dot(T[0])).normalize();
    for (let k = 1; k < K; k++) B[k].copy(B[k - 1]).addScaledVector(T[k], -B[k - 1].dot(T[k])).normalize();
    for (let k = 0; k < K; k++) D[k].crossVectors(T[k], B[k]);
    for (let k = 0; k < K; k++) {
      const P = this.prof[k]; let w = P.w, ht = P.ht, hb = P.hb;
      if (this.bulge) { const g = this.bulge(P.jf); if (g) { w *= g[0]; ht *= lerp(1, g[0], 0.4); hb *= lerp(1, g[0], 1.4); } }
      for (let j = 0; j <= N; j++) {
        const th = j / N * TAU, c = -Math.cos(th), s = Math.sin(th);
        const dv = spow(c, P.e) * (c > 0 ? ht : hb), lv = spow(s, P.e) * w, i = (k * M + j) * 3;
        pos[i] = C[k].x + D[k].x * dv + B[k].x * lv; pos[i + 1] = C[k].y + D[k].y * dv + B[k].y * lv; pos[i + 2] = C[k].z + D[k].z * dv + B[k].z * lv;
      }
    }
    // normals: cross(d/dθ, d/du) with wrap-around on θ (no seam)
    for (let k = 0; k < K; k++) {
      const k0 = Math.max(0, k - 1), k1 = Math.min(K - 1, k + 1);
      for (let j = 0; j <= N; j++) {
        const jm = (j + N - 1) % N, jp = (j + 1) % N, i = (k * M + j) * 3;
        const a = (k * M + jm) * 3, b = (k * M + jp) * 3, c = (k0 * M + (j % N)) * 3, d = (k1 * M + (j % N)) * 3;
        const tx = pos[b] - pos[a], ty = pos[b + 1] - pos[a + 1], tz = pos[b + 2] - pos[a + 2];
        let ux = pos[d] - pos[c], uy = pos[d + 1] - pos[c + 1], uz = pos[d + 2] - pos[c + 2];
        if (ux * ux + uy * uy + uz * uz < 1e-12) { ux = T[k].x; uy = T[k].y; uz = T[k].z; }
        let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux;
        const l = Math.hypot(nx, ny, nz) || 1; nrm[i] = nx / l; nrm[i + 1] = ny / l; nrm[i + 2] = nz / l;
      }
    }
    // cap centres sit on the spine ends, facing out along it
    const cS = K * M * 3, cE = (K * M + 1) * 3;
    pos[cS] = C[0].x; pos[cS + 1] = C[0].y; pos[cS + 2] = C[0].z; nrm[cS] = -T[0].x; nrm[cS + 1] = -T[0].y; nrm[cS + 2] = -T[0].z;
    pos[cE] = C[K - 1].x; pos[cE + 1] = C[K - 1].y; pos[cE + 2] = C[K - 1].z; nrm[cE] = T[K - 1].x; nrm[cE + 1] = T[K - 1].y; nrm[cE + 2] = T[K - 1].z;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
  }
  // surface point, spine tangent and outward normal at spine param jf and angle (c: dorsal, s: lateral)
  frameAt(jf, c, s, P, Tn, Nn) {
    let k = 0; while (k < this.K - 1 && this.prof[k + 1].jf <= jf) k++;
    const pr = this.prof[k], h = c > 0 ? pr.ht : pr.hb;
    P.copy(this.C[k]).addScaledVector(this.D[k], c * h).addScaledVector(this.B[k], s * pr.w);
    Tn.copy(this.T[k]); Nn.copy(this.D[k]).multiplyScalar(c / h).addScaledVector(this.B[k], s / pr.w).normalize();
    return P;
  }
  // world-independent point on the surface at spine param jf and angle (c: dorsal, s: lateral)
  pointAt(jf, c, s, out) {
    let k = 0; while (k < this.K - 1 && this.prof[k + 1].jf <= jf) k++;
    const P = this.prof[k];
    return out.copy(this.C[k]).addScaledVector(this.D[k], c * (c > 0 ? P.ht : P.hb)).addScaledVector(this.B[k], s * P.w);
  }
}

// ================================================================ feather card geometry
function cardGeometry() {
  const segs = 10, across = [-0.5, -0.25, 0, 0.25, 0.5], pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const v = i / segs, prof = Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * Math.min(1, v * 1.02))), 0.42) * (1 - 0.3 * v) * 1.02 + 0.04;
    for (let j = 0; j < across.length; j++) {
      const x = across[j] * prof;
      pos.push(x, -0.06 * v * v + 0.05 * x * x, v); uv.push(0.5 + x, v);
    }
  }
  const A = across.length;
  for (let i = 0; i < segs; i++) for (let j = 0; j < A - 1; j++) { const a = i * A + j, b = a + A; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

// ================================================================ the rig
// rest joints of the body/neck/head loft (pelican-local, sagittal plane)
const REST = [
  // z,     y,     w,     ht,    hb,    e,    fs
  [-0.370, 0.040, 0.030, 0.012, 0.012, 1.0, 0.45], // 0 tail base
  [-0.270, 0.075, 0.095, 0.065, 0.070, 0.9, 0.75], // 1 rump
  [-0.120, 0.150, 0.150, 0.120, 0.140, 0.85, 0.6], // 2 lower body
  [0.020, 0.265, 0.165, 0.135, 0.155, 0.85, 0.6],  // 3 mid body
  [0.115, 0.380, 0.150, 0.110, 0.150, 0.9, 0.55],  // 4 chest
  [0.160, 0.500, 0.084, 0.064, 0.090, 0.95, 0.5],  // 5 neck base
  [0.158, 0.610, 0.052, 0.044, 0.055, 1.0, 0.4],  // 6
  [0.122, 0.710, 0.042, 0.039, 0.044, 1.0, 0.34],  // 7
  [0.112, 0.800, 0.042, 0.039, 0.045, 1.0, 0.36],  // 8
  [0.148, 0.878, 0.043, 0.041, 0.046, 1.0, 0.34],  // 9
  [0.198, 0.922, 0.047, 0.047, 0.044, 1.0, 0.3],   // 10 occiput
  [0.243, 0.938, 0.045, 0.046, 0.041, 1.0, 0.28],  // 11 crown
  [0.283, 0.930, 0.037, 0.038, 0.034, 1.05, 0.28], // 12 forehead
  [0.314, 0.914, 0.025, 0.021, 0.025, 1.1, 0.28],  // 13 bill base
];
const HEAD_J = [10, 11, 12, 13];
const BILL_L = 0.38;
// upper-mandible profile along t (0 base .. 1 tip): half-width, top/bottom thickness, culmen ridge, hook
const bkey = (t, arr) => { for (let i = 0; i < arr.length - 1; i++) if (t <= arr[i + 1][0]) { const u = (t - arr[i][0]) / (arr[i + 1][0] - arr[i][0]); return lerp(arr[i][1], arr[i + 1][1], u * u * (3 - 2 * u)); } return arr[arr.length - 1][1]; };
const BW = [[0, 0.025], [0.12, 0.021], [0.5, 0.0185], [0.86, 0.0188], [0.93, 0.016], [0.975, 0.009], [1, 0.0015]];
const BHT = [[0, 0.019], [0.14, 0.0075], [0.8, 0.0058], [0.93, 0.009], [0.98, 0.006], [1, 0.0015]];
const BHB = [[0, 0.016], [0.16, 0.0045], [0.88, 0.0035], [0.95, 0.0075], [1, 0.0015]];
const BRID = [[0, 0.004], [0.8, 0.0034], [0.92, 0.0012], [1, 0]];
const billYc = (t) => -0.017 * Math.pow(smooth(0.9, 1.0, t), 1.6) - 0.004 * t;
const HEAD_PITCH = 0.42; // bill points ~24° below horizontal at rest

const COL = {
  white: new THREE.Color(0xebe5dc), blush: new THREE.Color(0xf0cdbf), breast: new THREE.Color(0xe6b45c),
  grey: new THREE.Color(0xd6d2cc), face: new THREE.Color(0xeb9a76), gular: new THREE.Color(0xf0b040),
};

export class Pelican {
  constructor() {
    const M = materials(); this.M = M;
    this.root = new THREE.Group(); this.root.name = 'pelican';
    // ---------------- body loft
    this.joints = REST.map(([z, y, w, ht, hb, e, fs]) => ({ p: new V3(0, y, z), rest: new V3(0, y, z), w, ht, hb, e, fs, vel: new V3(), off: new V3() }));
    this.body = new Loft(this.joints, 40, 85, bodyColor, M.feather, 0.22);
    this.body.mesh.name = 'pelican-body';
    this.root.add(this.body.mesh);
    // ---------------- head frame (position + orientation), bill, jaw, pouch, eyes
    this.head = new THREE.Group(); this.root.add(this.head);
    this.headRestPos = new V3(0, REST[11][1], REST[11][0]);
    this.headOffsets = HEAD_J.map((j) => new V3(0, REST[j][1] - REST[11][1], REST[j][0] - REST[11][0]).applyAxisAngle(new V3(1, 0, 0), -HEAD_PITCH));
    this.buildBill(); this.buildPouch(); this.buildEyes();
    // ---------------- legs & feet
    this.legs = [1, -1].map((sd) => this.buildLeg(sd));
    // ---------------- wings & feather cards
    this.cards = []; this.cardMesh = null;
    this.wings = [1, -1].map((sd) => this.buildWing(sd));
    this.buildTail(); this.buildCrest(); this.buildCape();
    this.finishCards();
    // ---------------- state
    this.t = 0; this.blinkT = 2; this.blink = 0; this.nictT = 7; this.nict = 0;
    this.look = new V3(0, 0.6, 3); this.lookW = 0; this.headYaw = 0; this.headPitch = 0; this.headRoll = 0;
    this.headPos = this.headRestPos.clone(); this.headVel = new V3();
    this.jig = new V3(); this.jigV = new V3(); // pouch jiggle (x lateral, y vertical, z fore-aft)
    this.open = 0; this.openTarget = 0; this.spread = 0; this.flap = 0; this.flapT = 0;
    this.bulge = null; this.gulpT = -1; this.fishInPouch = 0;
    this.prevVel = null; this.accel = new V3();
    this.saccade = new V3(); this.saccT = 0; this.eyeTarget = null;
    this.body.bulge = (jf) => this.neckBulge(jf);
  }

  // ------------------------------------------------------------ bill
  buildBill() {
    const M = this.M;
    // upper mandible: loft with a raised culmen ridge, pink tomia and a red hooked nail; both ends capped
    const S = 34, A = 22, nR = (S + 1) * (A + 1), pos = new Float32Array((nR + 2) * 3), col = new Float32Array((nR + 2) * 3), idx = [];
    const cBase = new THREE.Color(0xe2a27c), cTop = new THREE.Color(0x7489a3), cRidge = new THREE.Color(0xcdbf9c), cEdge = new THREE.Color(0xd4666c), cNail = new THREE.Color(0xb82530), cc = new THREE.Color();
    for (let i = 0; i <= S; i++) {
      const t = i / S, z = t * BILL_L, w = bkey(t, BW), ht = bkey(t, BHT), hb = bkey(t, BHB), rid = bkey(t, BRID);
      const yc = billYc(t);
      for (let j = 0; j <= A; j++) {
        const ph = j / A * TAU, x = w * Math.cos(ph), xn = x / w;
        let y = Math.sin(ph) >= 0 ? ht * Math.pow(Math.max(0, 1 - xn * xn), 0.55) + rid * Math.exp(-((xn / 0.2) ** 2)) : -hb * Math.pow(Math.max(0, 1 - xn * xn), 0.8);
        const k = (i * (A + 1) + j) * 3; pos[k] = x; pos[k + 1] = y + yc; pos[k + 2] = z;
        // colour
        const top = Math.sin(ph) >= 0;
        cc.copy(cTop);
        if (top) cc.lerp(cRidge, Math.exp(-((xn / 0.16) ** 2)) * 0.8);
        cc.lerp(cEdge, smooth(0.6, 1.0, Math.abs(xn)) * (top ? 0.9 : 1));
        if (!top) cc.lerp(cEdge, 0.5);
        cc.lerp(cBase, 1 - smooth(0.0, 0.14, t));
        cc.lerp(cNail, smooth(0.9, 0.95, t));
        col[k] = cc.r; col[k + 1] = cc.g; col[k + 2] = cc.b;
      }
    }
    for (let i = 0; i < S; i++) for (let j = 0; j < A; j++) { const a = i * (A + 1) + j, b = a + A + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    // caps: the base (inside the face, but visible from the POV camera) and the tip
    for (const [ci, ring, out] of [[nR, 0, -1], [nR + 1, S, 1]]) {
      let x = 0, y = 0, z = 0; for (let j = 0; j < A; j++) { const k = (ring * (A + 1) + j) * 3; x += pos[k]; y += pos[k + 1]; z += pos[k + 2]; }
      pos[ci * 3] = x / A; pos[ci * 3 + 1] = y / A; pos[ci * 3 + 2] = z / A;
      (out < 0 ? cBase : cNail).toArray(col, ci * 3);
      for (let j = 0; j < A; j++) { const a = ring * (A + 1) + j; if (out < 0) idx.push(ci, a + 1, a); else idx.push(ci, a, a + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.upper = mesh(g, M.bill); this.upper.name = 'bill';
    this.billGroup = new THREE.Group(); this.head.add(this.billGroup);
    this.billGroup.position.copy(this.headOffsets[3]).add(new V3(0, 0.004, -0.02));
    this.billGroup.add(this.upper);
    // jaw hinge: lower mandible rami + pouch rotate about x here
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.012, 0.0); this.billGroup.add(this.jaw);
    this.rami = [1, -1].map(() => {
      const RS = 30, RA = 8, g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RS + 1) * (RA + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const c2 = new Float32Array((RS + 1) * (RA + 1) * 3), cm = new THREE.Color(0xe7a07a), cn = new THREE.Color(0xd24a40);
      for (let i = 0; i <= RS; i++) for (let j = 0; j <= RA; j++) { const k = (i * (RA + 1) + j) * 3; cc.copy(cm).lerp(cn, smooth(0.9, 0.97, i / RS)); c2[k] = cc.r; c2[k + 1] = cc.g; c2[k + 2] = cc.b; }
      g2.setAttribute('color', new THREE.BufferAttribute(c2, 3));
      const id2 = []; for (let i = 0; i < RS; i++) for (let j = 0; j < RA; j++) { const a = i * (RA + 1) + j, b = a + RA + 1; id2.push(a, a + 1, b, b, a + 1, b + 1); }
      g2.setIndex(id2);
      const m = mesh(g2, M.bill, false); m.frustumCulled = false; this.jaw.add(m);
      return { g: g2, RS, RA };
    });
    // the gape: a fleshy web at each corner of the mouth, joining the upper mandible's edge to the ramus.
    // It stretches as the jaw opens, so the side of the mouth is never an open slot to the outside.
    this.gapes = [1, -1].map((sd) => {
      const R = 10, Cn = 6, g3 = new THREE.BufferGeometry();
      g3.setAttribute('position', new THREE.BufferAttribute(new Float32Array(R * Cn * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const id3 = []; for (let r = 0; r < R - 1; r++) for (let c = 0; c < Cn - 1; c++) { const a = r * Cn + c, b = a + Cn; id3.push(a, b, a + 1, b, b + 1, a + 1); }
      g3.setIndex(id3);
      const m = mesh(g3, M.gape, false); m.frustumCulled = false; m.name = 'gape'; this.billGroup.add(m);
      return { sd, g: g3, R, Cn };
    });
  }
  // ramus centre-line at param t (0 hinge .. 1 tip), side sd, bow 0..1
  ramus(t, sd, bow, out) {
    const w = lerp(0.021, 0.017, t) * (1 - smooth(0.9, 1.0, t) * 0.8) + bow * 0.052 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.9);
    const yc = -0.017 * Math.pow(smooth(0.9, 1.0, t), 1.6) - 0.004 * t - 0.004;
    return out.set(sd * w, yc, t * BILL_L * 0.985);
  }
  updateRami(bow) {
    const p = new V3(), q = new V3();
    for (let r = 0; r < 2; r++) {
      const sd = r === 0 ? 1 : -1, R = this.rami[r], pos = R.g.attributes.position.array;
      for (let i = 0; i <= R.RS; i++) {
        const t = i / R.RS; this.ramus(t, sd, bow, p); this.ramus(Math.min(1, t + 0.01), sd, bow, q);
        const end = smooth(0, 0.035, t) * (1 - smooth(0.965, 1, t)); // closed at both ends
        const rw = 0.0042 * (1 - 0.6 * smooth(0.85, 1, t)) * end, rh = 0.0026 * end;
        for (let j = 0; j <= R.RA; j++) {
          const a = j / R.RA * TAU, k = (i * (R.RA + 1) + j) * 3;
          pos[k] = p.x + Math.cos(a) * rw; pos[k + 1] = p.y + Math.sin(a) * rh; pos[k + 2] = p.z;
        }
      }
      R.g.attributes.position.needsUpdate = true; R.g.computeVertexNormals();
    }
  }

  updateGapes(bow) {
    const U = new V3(), Lw = new V3(), P = new V3();
    this.jaw.updateMatrix();
    const open = this.jaw.rotation.x;
    for (const G of this.gapes) {
      const pos = G.g.attributes.position.array, sd = G.sd;
      for (let r = 0; r < G.R; r++) {
        const t = lerp(-0.05, 0.16, r / (G.R - 1)), tc = Math.max(0, t);
        // upper edge: the mandible's tomium (its lateral rim), running back into the face for t < 0
        U.set(sd * bkey(tc, BW) * 0.97, billYc(tc) - 0.001, t * BILL_L);
        // lower edge: the top-outer side of the ramus, carried by the jaw
        this.ramus(tc, sd, bow, Lw); Lw.z += Math.min(0, t) * BILL_L; Lw.x += sd * 0.002; Lw.y += 0.002; Lw.applyMatrix4(this.jaw.matrix);
        for (let c = 0; c < G.Cn; c++) {
          const f = c / (G.Cn - 1), bulge = Math.sin(Math.PI * f);
          P.lerpVectors(U, Lw, f);
          P.x += sd * bulge * (0.004 + open * 0.004);                 // fleshy, bulging outwards
          P.z -= bulge * open * 0.05 * smooth(-0.05, 0.16, t);        // the web curves back when the mouth gapes
          const k = (r * G.Cn + c) * 3; pos[k] = P.x; pos[k + 1] = P.y; pos[k + 2] = P.z;
        }
      }
      G.g.attributes.position.needsUpdate = true; G.g.computeVertexNormals();
    }
  }

  // ------------------------------------------------------------ pouch
  buildPouch() {
    const S = 26, T = 16, g = new THREE.BufferGeometry(), n = (S + 1) * (T + 1);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2);
    for (let i = 0; i <= S; i++) for (let j = 0; j <= T; j++) { const k = i * (T + 1) + j; uv[k * 2] = i / S; uv[k * 2 + 1] = j / T; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = []; for (let i = 0; i < S; i++) for (let j = 0; j < T; j++) { const a = i * (T + 1) + j, b = a + T + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setIndex(idx);
    this.pouch = mesh(g, this.M.pouch, true, true); this.pouch.frustumCulled = false; this.pouch.name = 'pouch';
    this.pouch.renderOrder = 2;
    this.jaw.add(this.pouch);
    this.pouchS = S; this.pouchT = T;
  }
  // depth of the pouch below the rami at (s,t); s: 0 throat .. 1 tip
  pouchDepth(s, t) {
    const shape = Math.pow(Math.sin(Math.PI * t), 0.85);
    let D = 0.1 * Math.pow(1 - s, 1.1) + 0.075 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 1.3) * Math.pow(1 - s, 0.25);
    D *= 1 + 1.1 * this.open;
    if (this.bulge) D += this.bulge.amt * Math.exp(-(((s - this.bulge.s) / 0.16) ** 2)) * 0.9;
    return D * shape;
  }
  updatePouch(dt) {
    const S = this.pouchS, T = this.pouchT, pos = this.pouch.geometry.attributes.position.array;
    const L = new V3(), R = new V3(), P = new V3();
    // gravity in jaw space so the pouch always hangs down, blended with the jaw's own down
    const gdir = new V3(0, -1, 0); this.jaw.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix3().setFromMatrix4(this.jaw.matrixWorld).invert(); gdir.applyMatrix3(inv).normalize();
    const down = new V3(0, -1, 0).lerp(gdir, 0.65).normalize();
    const back = new V3(0, 0, -1);
    const bow = 0.12 + this.open * 0.85 + (this.bulge ? this.bulge.amt * 3 : 0);
    // the back of the pouch is sewn onto the throat skin: a U round the underside of the head/neck,
    // from one corner of the mouth, down the throat and up to the other corner (in jaw space)
    const toJaw = new THREE.Matrix4().copy(this.jaw.matrixWorld).invert().multiply(this.root.matrixWorld);
    const throat = this._throat || (this._throat = Array.from({ length: T + 1 }, () => new V3()));
    const tp = new V3(), tt = new V3(), tn = new V3();
    for (let j = 0; j <= T; j++) {
      const t = j / T, th = lerp(1.35, -1.35, t), jf = 12.55 - 1.4 * Math.pow(Math.sin(Math.PI * t), 0.8);
      this.body.frameAt(jf, -Math.cos(th), Math.sin(th), tp, tt, tn);
      throat[j].copy(tp).addScaledVector(tn, -0.002).applyMatrix4(toJaw);
    }
    const SEW = 0.28;
    for (let i = 0; i <= S; i++) {
      const s = i / S; this.ramus(s, 1, bow, L); this.ramus(s, -1, bow, R);
      for (let j = 0; j <= T; j++) {
        const t = j / T, k = (i * (T + 1) + j) * 3, D = this.pouchDepth(s, t);
        P.lerpVectors(L, R, t).addScaledVector(down, D).addScaledVector(back, D * 0.22 * (1 - s));
        // jiggle is strongest where the pouch hangs deepest
        const jw = D / 0.09;
        P.x += this.jig.x * jw; P.y += this.jig.y * jw; P.z += this.jig.z * jw * 0.5;
        // tuck the inner edge just inside the rami
        const edge = Math.min(t, 1 - t) < 0.02 ? 1 : 0; P.y += edge * 0.001;
        if (s < SEW) P.lerp(throat[j], 1 - smooth(0, SEW, s));
        pos[k] = P.x; pos[k + 1] = P.y; pos[k + 2] = P.z;
      }
    }
    this.pouch.geometry.attributes.position.needsUpdate = true; this.pouch.geometry.computeVertexNormals();
  }

  // ------------------------------------------------------------ eyes
  buildEyes() {
    const M = this.M, r = 0.0095;
    const eg = new THREE.SphereGeometry(r, 28, 18);
    // planar front projection: iris texture on the +z hemisphere
    const p = eg.attributes.position, uv = eg.attributes.uv;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) / r, y = p.getY(i) / r, z = p.getZ(i) / r; if (z > 0) uv.setXY(i, 0.5 + x * 0.5, 0.5 + y * 0.5); else uv.setXY(i, 0.02, 0.02); }
    const lidG = new THREE.SphereGeometry(r * 1.13, 20, 10, 0, TAU, 0, Math.PI / 2);
    const nictG = new THREE.SphereGeometry(r * 1.04, 20, 12, 0, Math.PI, 0, Math.PI);
    const ringG = new THREE.TorusGeometry(r * 1.02, r * 0.28, 8, 24);
    this.eyes = [1, -1].map((sd) => {
      const g = new THREE.Group();
      g.position.set(sd * 0.0355, 0.0045, 0.030);
      // default gaze: lateral and a little forward/down, the way pelicans sight along the bill
      g.userData.base = new V3(sd * 0.82, -0.08, 0.58).normalize();
      this.head.add(g);
      const ball = mesh(eg, M.eye, false); g.add(ball);
      const ring = mesh(ringG, M.lid, false); g.add(ring);
      const up = mesh(lidG, M.lid, false), lo = mesh(lidG, M.lid, false); lo.rotation.z = Math.PI;
      const upP = new THREE.Group(), loP = new THREE.Group(); upP.add(up); loP.add(lo); g.add(upP, loP);
      const nict = mesh(nictG, M.nict, false); const nP = new THREE.Group(); nP.add(nict); g.add(nP);
      return { g, ball, ring, upP, loP, nP, sd };
    });
  }

  // ------------------------------------------------------------ legs & feet
  // One continuous, closed skin per leg: a tube swept hip -> rounded heel -> ball of the foot, whose
  // cross-section then morphs from a circle into the flat webbed paddle of the foot (four toe ridges
  // joined by web, a scalloped free edge, dark claws). Feathered at the top, bare orange skin below.
  buildLeg(sd) {
    const NL = 28, NF = 18, N = 24, K = NL + NF, M1 = N + 1, n = K * M1 + 1;
    const g = new THREE.BufferGeometry();
    const attr = (k, size) => { const a = new THREE.BufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); return a.array; };
    const L = { sd, NL, NF, N, K, M1, g, pos: attr('position', 3), nrm: attr('normal', 3), uv: attr('uv', 2), col: attr('color', 3), fm: attr('fmask', 1) };
    const idx = [];
    for (let k = 0; k < K - 1; k++) for (let j = 0; j < N; j++) { const a = k * M1 + j, b = a + M1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const cap = K * M1; for (let j = 0; j < N; j++) idx.push(cap, j + 1, j); // hip end, facing -T
    g.setIndex(idx);
    L.mesh = mesh(g, this.M.feather); L.mesh.frustumCulled = false; L.mesh.name = 'leg';
    this.root.add(L.mesh);
    L.C = []; L.T = []; L.B = []; L.D = []; L.W = new Float32Array(K); L.Hh = new Float32Array(K); L.arc = new Float32Array(K);
    for (let k = 0; k < K; k++) { L.C.push(new V3()); L.T.push(new V3()); L.B.push(new V3()); L.D.push(new V3()); }
    Object.assign(L, { hip: new V3(sd * 0.078, 0.095, 0.02), knee: new V3(), ballP: new V3(), la: 0.27, lb: 0.23, pedal: new V3(), pedalQ: new THREE.Quaternion() });
    return L;
  }
  patchFeatherAttrs(g, color) {
    const n = g.attributes.position.count, c = new Float32Array(n * 3), f = new Float32Array(n).fill(1), uv = g.attributes.uv;
    for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * 0.6); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('fmask', new THREE.BufferAttribute(f, 1));
  }
  updateLeg(L, effort) {
    const q = L.pedalQ, fwd = new V3(0, 0, 1).applyQuaternion(q), up = new V3(0, 1, 0).applyQuaternion(q), lat = new V3(1, 0, 0).applyQuaternion(q);
    // ball of the foot sits on the rear half of the pedal; the toes wrap its front edge
    L.ballP.copy(L.pedal).addScaledVector(fwd, -0.036).addScaledVector(up, 0.019);
    ik2(L.hip, L.ballP, L.la, L.lb, new V3(L.sd * 0.25, 0.1, -1).normalize(), L.knee);
    const { NL, NF, N, K, M1, C, T, B, D, W, Hh, pos, col, fm, uv } = L;
    // --- centre-line: straight thigh, a rounded heel (quadratic arc), straight tarsus
    const H = L.hip, Kn = L.knee, Bp = L.ballP;
    const dA = Kn.clone().sub(H), lA = dA.length() || 1e-4; dA.divideScalar(lA);
    const dB = Bp.clone().sub(Kn), lB = dB.length() || 1e-4; dB.divideScalar(lB);
    const rr = Math.min(0.045, 0.35 * Math.min(lA, lB));
    const P1 = Kn.clone().addScaledVector(dA, -rr), P2 = Kn.clone().addScaledVector(dB, rr), poly = [];
    for (let i = 0; i <= 12; i++) poly.push(H.clone().lerp(P1, i / 12));
    for (let i = 1; i <= 10; i++) { const t = i / 10; poly.push(P1.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(Kn, 2 * t * (1 - t)).addScaledVector(P2, t * t)); }
    for (let i = 1; i <= 12; i++) poly.push(P2.clone().lerp(Bp, i / 12));
    const cum = [0]; for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + poly[i].distanceTo(poly[i - 1]));
    const total = cum[cum.length - 1], heel = (cum[12] + cum[22]) / 2;
    const at = (a, out) => { let i = 1; while (i < cum.length - 1 && cum[i] < a) i++; return out.lerpVectors(poly[i - 1], poly[i], clamp((a - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), 0, 1)); };
    for (let k = 0; k < NL; k++) {
      const a = k / (NL - 1) * total; at(a, C[k]); L.arc[k] = a;
      // radius: thick feathered thigh -> slim shank, a knobbly heel, slim tarsus swelling into the ball
      let r;
      if (a < heel) r = lerp(0.047, 0.019, smooth(0, 1, a / heel));
      else { const f = (a - heel) / Math.max(1e-4, total - heel); r = lerp(0.019, 0.0155, smooth(0, 0.5, f)) + 0.004 * smooth(0.7, 1, f); }
      r += 0.0055 * Math.exp(-(((a - heel) / 0.02) ** 2));
      Hh[k] = r; W[k] = a > heel ? r * 0.84 : r; // the tarsus is a little flattened side to side
    }
    // --- toe paths (hallux medial-forward; all four joined by web), curling over the pedal's front edge
    const spreads = [-0.8, -0.34, 0.04, 0.42], lens = [0.07, 0.1, 0.125, 0.115], R6 = 6, grip = 0.55 + 0.45 * effort, toes = [];
    for (let t = 0; t < 4; t++) {
      const d = fwd.clone().applyAxisAngle(up, spreads[t] * L.sd).normalize(), side = new V3().crossVectors(up, d).normalize();
      const p = Bp.clone().addScaledVector(lat, L.sd * (t - 1.5) * 0.008).addScaledVector(up, -0.009), pts = [p.clone()];
      for (let r = 1; r < R6; r++) {
        const along = p.clone().sub(L.pedal).dot(fwd);
        if (along > 0.037) d.applyAxisAngle(side, 0.36 * grip); else if (r > 1) d.applyAxisAngle(side, 0.03);
        p.addScaledVector(d, lens[t] / (R6 - 1)); pts.push(p.clone());
      }
      toes.push(pts);
    }
    const onToe = (pts, v, out) => { const f = clamp(v, 0, 1) * (R6 - 1), i = Math.min(R6 - 2, Math.floor(f)); return out.lerpVectors(pts[i], pts[i + 1], f - i); };
    // foot ring centres follow the middle toe
    for (let k = NL; k < K; k++) { const v = (k - NL + 1) / NF; onToe(toes[2], v, C[k]).lerp(onToe(toes[1], v, new V3()), 0.5); }
    // --- frames by parallel transport (lateral axis starts along the pelican's x)
    for (let k = 0; k < K; k++) T[k].subVectors(C[Math.min(K - 1, k + 1)], C[Math.max(0, k - 1)]).normalize();
    B[0].set(1, 0, 0).addScaledVector(T[0], -T[0].x).normalize();
    for (let k = 1; k < K; k++) B[k].copy(B[k - 1]).addScaledVector(T[k], -B[k - 1].dot(T[k])).normalize();
    for (let k = 0; k < K; k++) D[k].crossVectors(T[k], B[k]);
    // --- skin colours
    const cWhite = COL.white, cSkin = new THREE.Color(0xf0864f), cKnee = new THREE.Color(0xd9714a), cWeb = new THREE.Color(0xf49a70), cClaw = new THREE.Color(0x3a2a24), cc = new THREE.Color();
    const P = new V3(), circ = new V3(), pa = new V3(), pb = new V3(), dirMid = new V3(), upL = new V3();
    const kE = NL - 1;
    for (let k = 0; k < K; k++) {
      const foot = k >= NL, v = foot ? (k - NL + 1) / NF : 0;
      if (foot) { onToe(toes[2], Math.min(1, v + 0.05), dirMid).sub(onToe(toes[2], Math.max(0, v - 0.05), pa)).normalize(); upL.crossVectors(dirMid, lat).normalize(); }
      for (let j = 0; j <= N; j++) {
        const th = j / N * TAU, c = -Math.cos(th), s = Math.sin(th), i3 = (k * M1 + j) * 3;
        if (!foot) {
          P.copy(C[k]).addScaledVector(D[k], c * Hh[k]).addScaledVector(B[k], s * W[k]);
          const fe = 1 - smooth(0.42 * heel, 0.72 * heel, L.arc[k]);
          cc.copy(cSkin).lerp(cKnee, Math.exp(-(((L.arc[k] - heel) / 0.025) ** 2)) * 0.6).lerp(cWhite, fe);
          fm[k * M1 + j] = fe;
        } else {
          // across the foot: s = -1..1 maps onto toes (hallux on the medial side)
          const xi = clamp(L.sd > 0 ? (s + 1) * 1.5 : 3 - (s + 1) * 1.5, 0, 2.9999), a = Math.floor(xi), fr = xi - a;
          const vv = v * (1 - 0.16 * Math.sin(Math.PI * fr) * smooth(0.55, 1, v)); // the web stops a little short of the tips
          onToe(toes[a], vv, pa); onToe(toes[a + 1], vv, pb); P.lerpVectors(pa, pb, fr);
          let ridge = 0; for (let q = 0; q < 4; q++) ridge = Math.max(ridge, Math.exp(-(((xi - q) / 0.3) ** 2)));
          const thick = lerp(0.0024, lerp(0.0088, 0.0045, v), ridge) * (1 - 0.8 * smooth(0.93, 1, v));
          P.addScaledVector(upL, c * thick);
          // blend out of the tarsus' end ring so the ankle is one surface
          const wb = smooth(0, 0.32, v);
          if (wb < 1) { circ.copy(C[kE]).addScaledVector(D[kE], c * Hh[kE]).addScaledVector(B[kE], s * W[kE]); P.lerpVectors(circ, P, wb); }
          cc.copy(cSkin).lerp(cWeb, (1 - ridge) * 0.7).lerp(cClaw, ridge > 0.55 ? smooth(0.88, 0.97, v) : 0);
          fm[k * M1 + j] = 0;
        }
        pos[i3] = P.x; pos[i3 + 1] = P.y; pos[i3 + 2] = P.z;
        col[i3] = cc.r; col[i3 + 1] = cc.g; col[i3 + 2] = cc.b;
        uv[(k * M1 + j) * 2] = (foot ? total + v * 0.12 : L.arc[k]) / 0.09; uv[(k * M1 + j) * 2 + 1] = j / N * 2;
      }
    }
    // hip cap
    const c3 = K * M1 * 3; pos[c3] = C[0].x; pos[c3 + 1] = C[0].y; pos[c3 + 2] = C[0].z; col[c3] = cWhite.r; col[c3 + 1] = cWhite.g; col[c3 + 2] = cWhite.b; fm[K * M1] = 1;
    // normals: cross(d/dθ, d/du) with θ wrap-around (no seam), one-sided at the ends
    const nr = L.nrm;
    for (let k = 0; k < K; k++) {
      const k0 = Math.max(0, k - 1), k1 = Math.min(K - 1, k + 1);
      for (let j = 0; j <= N; j++) {
        const jm = (j + N - 1) % N, jp = (j + 1) % N, i = (k * M1 + j) * 3, a = (k * M1 + jm) * 3, b = (k * M1 + jp) * 3, cI = (k0 * M1 + (j % N)) * 3, dI = (k1 * M1 + (j % N)) * 3;
        const tx = pos[b] - pos[a], ty = pos[b + 1] - pos[a + 1], tz = pos[b + 2] - pos[a + 2];
        let ux = pos[dI] - pos[cI], uy = pos[dI + 1] - pos[cI + 1], uz = pos[dI + 2] - pos[cI + 2];
        if (ux * ux + uy * uy + uz * uz < 1e-12) { ux = T[k].x; uy = T[k].y; uz = T[k].z; }
        let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux; const l = Math.hypot(nx, ny, nz) || 1;
        nr[i] = nx / l; nr[i + 1] = ny / l; nr[i + 2] = nz / l;
      }
    }
    nr[c3] = -T[0].x; nr[c3 + 1] = -T[0].y; nr[c3 + 2] = -T[0].z;
    const A = L.g.attributes; A.position.needsUpdate = A.normal.needsUpdate = A.color.needsUpdate = A.fmask.needsUpdate = A.uv.needsUpdate = true;
  }

  // ------------------------------------------------------------ wings
  buildWing(sd) {
    const M = this.M;
    // feathered arm: shoulder -> elbow -> wrist -> hand tip (a small loft with lateral frames)
    const joints = [
      { p: new V3(), w: 0.058, ht: 0.05, hb: 0.05, e: 0.9, fs: 0.6 },
      { p: new V3(), w: 0.036, ht: 0.03, hb: 0.03, e: 0.9, fs: 0.5 },
      { p: new V3(), w: 0.026, ht: 0.022, hb: 0.024, e: 0.9, fs: 0.4 },
      { p: new V3(), w: 0.018, ht: 0.014, hb: 0.014, e: 0.9, fs: 0.35 },
      { p: new V3(), w: 0.008, ht: 0.006, hb: 0.006, e: 1, fs: 0.3 },
    ];
    const W = { sd, joints, S: new V3(sd * 0.118, 0.425, 0.025), E: new V3(), Wr: new V3(), H: new V3(), n: new V3(), grip: new V3(), l1: 0.26, l2: 0.3, l3: 0.13, cards: [] };
    // rest positions so the loft can compute rings
    joints[0].p.set(sd * 0.12, 0.42, 0.02); joints[1].p.set(sd * 0.2, 0.3, -0.05); joints[2].p.set(sd * 0.22, 0.25, 0.2); joints[3].p.set(sd * 0.21, 0.28, 0.1); joints[4].p.set(sd * 0.2, 0.3, 0.02);
    W.loft = new Loft(joints, 14, 60, (c) => { c.copy(COL.white); return 1; }, M.feather, 0.2);
    this.root.add(W.loft.mesh);
    // feather layout: [bone, count, u0, u1, len0, len1, width, colour, layer]
    // great white pelican: sooty brown-black remiges and primary coverts; white coverts and tertials with
    // the same faint pink blush as the body. Each flight feather gets its own tone so the black isn't one slab.
    const R = rng(sd > 0 ? 41 : 43), tone = (c, k) => c.clone().multiplyScalar(1 - k / 2 + R() * k);
    const black = new THREE.Color(0x2a221f), white = COL.white.clone().lerp(COL.blush, 0.3), grey = COL.white.clone().lerp(COL.grey, 0.5);
    const add = (bone, i, n, u, len, width, color, layer, kind) => W.cards.push(this.addCard({ bone, i, n, u, len, width, color, layer, kind, wing: W }));
    for (let i = 0; i < 10; i++) add('hand', i, 10, lerp(0.05, 1.0, i / 9), lerp(0.3, 0.4, Math.pow(i / 9, 0.7)), 0.062, tone(black, 0.35), 0, 'primary');
    for (let i = 0; i < 16; i++) add('fore', i, 16, lerp(0.02, 0.98, i / 15), 0.25, 0.075, tone(black, 0.35), 0, 'secondary');
    for (let i = 0; i < 7; i++) add('hand', i, 7, lerp(0.02, 0.8, i / 6), 0.14, 0.05, tone(black, 0.2), 1, 'pcovert');
    for (let i = 0; i < 12; i++) add('fore', i, 12, lerp(0.0, 1.0, i / 11), 0.15, 0.09, tone(white, 0.06), 1, 'covert');
    for (let i = 0; i < 12; i++) add('fore', i, 12, lerp(0.03, 0.97, i / 11), 0.085, 0.05, tone(white, 0.06), 2, 'lesser');
    // underwing coverts: white from below too, so the black shows as a trailing edge, not a sheet
    for (let i = 0; i < 12; i++) add('fore', i, 12, lerp(0.0, 1.0, i / 11), 0.15, 0.09, tone(white, 0.06), -1, 'undercovert');
    for (let i = 0; i < 5; i++) add('hum', i, 5, lerp(0.3, 1.0, i / 4), lerp(0.2, 0.24, i / 4), 0.075, tone(grey, 0.05), 1, 'tertial');
    return W;
  }
  addCard(o) { o.m = new THREE.Matrix4(); this.cards.push(o); return o; }
  buildTail() {
    const white = new THREE.Color(0xf2eee8);
    this.tail = [];
    for (let i = 0; i < 14; i++) this.tail.push(this.addCard({ kind: 'tail', i, n: 14, len: lerp(0.15, 0.19, 1 - Math.abs(i - 6.5) / 6.5), width: 0.06, color: white, layer: i % 2 }));
    for (let i = 0; i < 9; i++) this.tail.push(this.addCard({ kind: 'uppertail', i, n: 9, len: 0.11, width: 0.055, color: white, layer: 2 }));
  }
  buildCrest() {
    const white = new THREE.Color(0xfaf6f0), R = rng(21);
    this.crest = [];
    for (let i = 0; i < 11; i++) this.crest.push(this.addCard({ kind: 'crest', i, n: 11, len: 0.045 + R() * 0.035, width: 0.02, color: white, layer: 0, jit: R() }));
  }
  finishCards() {
    const n = this.cards.length;
    this.cardMesh = new THREE.InstancedMesh(cardGeometry(), this.M.card, n);
    this.cardMesh.castShadow = true; this.cardMesh.receiveShadow = true; this.cardMesh.frustumCulled = false; this.cardMesh.name = 'feather-cards';
    this.cards.forEach((c, i) => this.cardMesh.setColorAt(i, c.color));
    this.root.add(this.cardMesh);
  }
  // write a card's matrix: base at p, pointing along dir, card normal ~nrm
  setCard(c, p, dir, nrm, lenScale = 1) {
    const z = dir.clone().normalize(), x = new V3().crossVectors(nrm, z).normalize(), y = new V3().crossVectors(z, x);
    c.m.makeBasis(x.multiplyScalar(c.width), y.multiplyScalar(c.len * 0.7), z.multiplyScalar(c.len * lenScale)).setPosition(p);
  }
  updateWing(W, spread, flap, t, gripOn) {
    const sd = W.sd, out = new V3(sd, 0, 0), up = new V3(0, 1, 0), back = new V3(0, 0, -1);
    // --- handlebar pose (wrist on the grip) vs spread pose (soaring V with fingered primaries)
    const Eb = new V3(), Wb = new V3().copy(W.grip), Hb = new V3();
    // the grip sits right at the arm's full reach (±1 cm as the torso bobs); solved exactly, every dip inside it
    // snapped the elbow 1-2 cm bent and back, jerking the black trailing edge. The folded arm stays at full stretch.
    const reach = new V3().subVectors(Wb, W.S); reach.setLength(Math.max(reach.length(), W.l1 + W.l2)).add(W.S);
    ik2(W.S, reach, W.l1, W.l2, new V3(sd * 0.6, -0.5, -0.65).normalize(), Eb);
    // folded hand lies back along the underside of the forearm
    const handB = new V3().subVectors(Eb, Wb).normalize().add(new V3(sd * 0.08, -0.3, 0)).normalize();
    Hb.copy(Wb).addScaledVector(handB, W.l3);
    const lift = 0.35 + Math.sin(flap) * 0.55;
    const e1 = new V3(sd, lift * 0.9, -0.12).normalize(), e2 = new V3(sd, lift * 0.35 - 0.05, 0.12).normalize(), e3 = new V3(sd, lift * 0.1 - 0.08, -0.12).normalize();
    const Es = W.S.clone().addScaledVector(e1, W.l1), Ws = Es.clone().addScaledVector(e2, W.l2), Hs = Ws.clone().addScaledVector(e3, W.l3 * 1.15);
    const k = spread;
    W.E.lerpVectors(Eb, Es, k); W.Wr.lerpVectors(Wb, Ws, k); W.H.lerpVectors(Hb, Hs, k);
    // wing dorsal normal
    const nb = new V3(sd, 0.28, -0.05).normalize(), ns = new V3(-sd * (0.25 + lift * 0.3), 1, 0.05).normalize();
    W.n.lerpVectors(nb, ns, k).normalize();
    const J = W.joints;
    J[0].p.copy(W.S).addScaledVector(out, -0.03); J[1].p.copy(W.E); J[2].p.copy(W.Wr); J[3].p.lerpVectors(W.Wr, W.H, 0.55); J[4].p.copy(W.H);
    W.loft.update(W.n.clone().cross(new V3().subVectors(W.E, W.S).normalize()).normalize());
    // --- feathers
    const bones = {
      hum: [W.S, W.E], fore: [W.E, W.Wr], hand: [W.Wr, W.H],
    };
    // folded feathers droop a little under their own weight and flutter in the wind. Every card on a bone lies in
    // one plane square to the bone and droops with it, so the layer offsets hold along whole feathers: tilted one
    // by one, cards crossed at shallow angles and black remiges flickered through the white coverts as the arm moved
    const droop = 0.12 + 0.02 * Math.sin(t * 17 + sd);
    for (const c of W.cards) {
      const [A, Bp] = bones[c.bone];
      const b = new V3().subVectors(Bp, A).normalize();
      const nb = W.n.clone().addScaledVector(b, -W.n.dot(b)).normalize(), tr0 = new V3().crossVectors(nb, b).multiplyScalar(sd);
      const tr = tr0.clone().multiplyScalar(Math.cos(droop)).addScaledVector(nb, -Math.sin(droop)); // towards the trailing edge
      const nrm = nb.multiplyScalar(Math.cos(droop)).addScaledVector(tr0, Math.sin(droop));
      // folded, the hand's feathers tuck under the secondaries (above the underwing coverts), so only
      // the black primary tips show, back by the flank
      const hand = c.kind === 'primary' || c.kind === 'pcovert';
      const p = new V3().lerpVectors(A, Bp, c.u).addScaledVector(nrm, hand ? lerp(-0.008, 0.004 + c.layer * 0.006, k) : 0.004 + c.layer * 0.006);
      const f = c.i / Math.max(1, c.n - 1);
      let ang;
      if (c.kind === 'primary' || c.kind === 'pcovert') ang = lerp(lerp(1.3, 1.52, f), lerp(0.2, 1.3, f), k);
      else if (c.kind === 'tertial') ang = lerp(-1.25, -0.7, k);
      else ang = lerp(lerp(-1.15, -0.62, f), lerp(-0.15, 0.1, f), k);
      const cov = c.kind === 'covert' || c.kind === 'undercovert';
      if (cov || c.kind === 'lesser') p.addScaledVector(tr, -0.012);
      const dir = tr.clone().multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang)).normalize();
      if (c.kind === 'tertial') dir.lerp(back, 0.6 * (1 - k)).normalize();
      // folded, the greater coverts hide most of the black secondaries (a dark trailing edge is left);
      // spread, they shorten back so the whole trailing half of the wing reads black, as in flight
      this.setCard(c, p, dir, nrm, cov ? lerp(1.4, 1, k) : hand ? lerp(0.8, 1, k) : 1);
    }
  }
  updateTail(t, lean) {
    const tb = this.joints[0].p, rump = this.joints[1].p;
    const axis = new V3().subVectors(tb, rump).normalize();
    const dors = new V3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const lat = new V3().crossVectors(dors, axis).normalize();
    // a seated pelican carries its short tail about level, cocked a little above the drooping body line;
    // that also keeps it clear of the rear wheel right under the rump. It flicks up on landings.
    const cock = 0.42 + clamp(-this.accel.y * 0.008, -0.1, 0.3);
    for (const c of this.tail) {
      const f = c.i / (c.n - 1) - 0.5;
      // at rest the tail is half-folded and gently domed (outer feathers a little lower)
      const fan = c.kind === 'tail' ? f * 0.95 : f * 0.8;
      const dir = axis.clone().multiplyScalar(Math.cos(fan)).addScaledVector(lat, Math.sin(fan)).addScaledVector(dors, cock - 0.3 * Math.abs(f) + 0.02 * Math.sin(t * 9 + c.i)).normalize();
      dir.y = Math.max(dir.y, -0.05); dir.normalize(); // whatever the torso does, it never droops into the fender
      const p = rump.clone().lerp(tb, c.kind === 'tail' ? 0.75 : 0.35).addScaledVector(lat, f * 0.07).addScaledVector(dors, c.kind === 'tail' ? 0.005 + c.layer * 0.004 : 0.03);
      this.setCard(c, p, dir, dors);
    }
  }
  updateCrest(t, speed) {
    const P = new V3(), T = new V3(), N = new V3();
    for (const c of this.crest) {
      const f = c.i / (c.n - 1) - 0.5, ph = f * 1.1;
      this.body.frameAt(10.1 + c.jit * 0.9, Math.cos(ph), Math.sin(ph), P, T, N);
      const flutter = Math.sin(t * (13 + c.jit * 5) + c.i) * (0.08 + speed * 0.01);
      const dir = T.clone().negate().addScaledVector(N, 0.35 + flutter).normalize();
      this.setCard(c, P.addScaledVector(N, -0.004), dir, N);
    }
  }
  // long scapulars and tertials drape over the back and flanks like a cape
  buildCape() {
    const white = new THREE.Color(0xf1ece4), R = rng(33);
    this.cape = [];
    const rows = [4.1, 3.5, 2.9, 2.35, 1.8, 1.35], angs = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35];
    rows.forEach((jf, r) => angs.forEach((a, j) => {
      if (Math.abs(a) > 0.5 * (r + 1)) return;
      this.cape.push(this.addCard({ kind: 'cape', jf, a, len: lerp(0.12, 0.2, r / 5) * (1 - Math.abs(a) * 0.12), width: 0.085, color: white.clone().multiplyScalar(0.96 + R() * 0.06), layer: r, jit: R() }));
    }));
  }
  updateCape(t) {
    const P = new V3(), T = new V3(), N = new V3();
    for (const c of this.cape) {
      this.body.frameAt(c.jf + c.jit * 0.2, Math.cos(c.a), Math.sin(c.a), P, T, N);
      const dir = T.clone().negate(); dir.addScaledVector(N, -dir.dot(N) + 0.1 + 0.015 * Math.sin(t * 7 + c.jit * 9)).normalize();
      this.setCard(c, P.addScaledVector(N, 0.003 + c.layer * 0.001), dir, N);
    }
  }

  // ------------------------------------------------------------ neck bulge (the gulp)
  neckBulge(jf) {
    if (this.gulpT < 0) return null;
    const pos = lerp(12.5, 4.8, smooth(0, 1, this.gulpT)); // travels from throat to chest
    const g = Math.exp(-(((jf - pos) / 0.7) ** 2)) * 0.55 * (1 - smooth(0.85, 1, this.gulpT));
    return g > 0.01 ? [1 + g, 1] : null;
  }

  // ------------------------------------------------------------ public API
  // each fish drops into the pouch: it sags a little more and wobbles; gulp() swallows the lot
  catchFish(golden) {
    const amt = Math.min(0.06, (this.bulge && this.gulpT < 0 ? this.bulge.amt : 0) + (golden ? 0.016 : 0.011));
    this.bulge = { s: 0.75, amt }; this.fishInPouch = 1;
    this.jigV.y -= 0.7; this.jigV.x += (Math.random() - 0.5) * 0.5;
  }
  gulp() { this.gulpQueued = 0.3; }
  // world-space helpers for cameras & effects
  worldOf(v, out = new V3()) { return out.copy(v).applyMatrix4(this.root.matrixWorld); }
  headWorld(out = new V3()) { return this.head.getWorldPosition(out); }
  pouchWorld(out = new V3()) { return this.pouch.localToWorld(out.set(0, -0.06, BILL_L * 0.45)); }
  billTipWorld(out = new V3()) { return this.billGroup.localToWorld(out.set(0, -0.015, BILL_L)); }
  eyeWorld(sd = 1, out = new V3()) { return this.eyes[sd > 0 ? 0 : 1].g.getWorldPosition(out); }
  // neck surface point for the scarf pins (pelican-local)
  neckPoint(jf, angle, out) { return this.body.pointAt(jf, -Math.cos(angle), Math.sin(angle), out); }

  // ctx: { dt, t, crank, effort, speed, steer, lean, trick, flap, look (world V3|null), lookW, cam (world V3), pedals[2]{p,q} (root-space), grips[2] (root-space), vel (world V3), bump }
  update(ctx) {
    const dt = Math.min(ctx.dt, 1 / 30); this.t += dt; const t = this.t;
    // ---- body acceleration in pelican space (drives the secondary motion)
    if (ctx.vel) {
      if (!this.prevVel) this.prevVel = ctx.vel.clone();
      const a = ctx.vel.clone().sub(this.prevVel).divideScalar(Math.max(dt, 1e-3)); this.prevVel.copy(ctx.vel);
      a.y += (ctx.bump || 0);
      const qi = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.accel.lerp(a.applyQuaternion(qi), 0.5);
    }
    const acc = this.accel;
    // ---- torso: pedal-stroke rock, effort lean, breathing
    const crank = ctx.crank || 0, eff = ctx.effort || 0;
    const rock = Math.sin(crank) * 0.035 * (0.4 + eff), bob = Math.abs(Math.sin(crank)) * 0.006 * (0.5 + eff);
    const pitch = -0.06 * eff + 0.03 * Math.sin(t * 1.3) * 0.2 + ctx.trick * -0.18;
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, rock - (ctx.lean || 0) * 0.25));
    const breath = 1 + Math.sin(t * 2.1) * 0.012;
    for (let i = 0; i <= 5; i++) {
      const J = this.joints[i];
      J.p.copy(J.rest).applyQuaternion(tq); J.p.y += bob;
      J.w = REST[i][2] * (i >= 2 && i <= 4 ? breath : 1);
    }
    // the rump overhangs the rear wheel: leaning back (effort, the wheelie) rests it on the fender
    // instead of sinking it, and the tail with it, into the tyre
    for (let i = 0; i <= 1; i++) {
      const J = this.joints[i], dz = J.p.z - REAR.z;
      if (Math.abs(dz) < REAR_R) J.p.y = Math.max(J.p.y, REAR.y + Math.sqrt(REAR_R * REAR_R - dz * dz) + J.hb);
    }
    // ---- head: stabilised in space, looks at points of interest, gulps
    this.updateHead(ctx, dt, tq, bob);
    // neck joints between the torso and the head, with spring lag
    const nb = this.joints[5].p, occ = this.joints[10].p;
    const restNb = this.joints[5].rest, restOcc = new V3(0, REST[10][1], REST[10][0]);
    const dNb = nb.clone().sub(restNb), dOcc = occ.clone().sub(restOcc);
    const wts = [0.8, 0.6, 0.4, 0.2];
    for (let k = 0; k < 4; k++) {
      const J = this.joints[6 + k];
      const target = J.rest.clone().addScaledVector(dNb, wts[k]).addScaledVector(dOcc, 1 - wts[k]);
      // spring on the offset from target, pushed by body acceleration (inertia)
      const f = J.off.clone().multiplyScalar(-160).addScaledVector(J.vel, -14).addScaledVector(acc, -0.35 * (1 - wts[k]));
      J.vel.addScaledVector(f, dt); J.off.addScaledVector(J.vel, dt);
      J.off.clampLength(0, 0.04);
      J.p.copy(target).add(J.off);
    }
    const B0 = new V3(1, 0, 0).applyQuaternion(tq);
    this.body.update(B0);
    // ---- jaw / pouch
    if (this.gulpQueued > 0) { this.gulpQueued -= dt; if (this.gulpQueued <= 0) { this.gulpT = 0; } }
    if (this.bulge) {
      // the fish slides from the pouch into the throat while the head tips back
      if (this.gulpT >= 0) { this.bulge.s = lerp(this.bulge.s, -0.2, 1 - Math.exp(-6 * dt)); this.bulge.amt *= Math.exp(-3 * dt); if (this.bulge.amt < 0.004) this.bulge = null; }
      else this.bulge.s = 0.75 + Math.sin(t * 20) * 0.03; // fish wriggles
    }
    if (this.gulpT >= 0) { this.gulpT += dt / 1.1; if (this.gulpT >= 1) { this.gulpT = -1; this.fishInPouch = 0; } }
    this.open = damp(this.open, clamp(ctx.scoop || 0, 0, 1), 14, dt);
    this.jaw.rotation.x = this.open * 0.38 + (this.gulpT >= 0 ? Math.sin(this.gulpT * Math.PI) * 0.1 : 0);
    // pouch jiggle: underdamped spring driven by head acceleration
    const ha = acc.clone().multiplyScalar(-0.006);
    const jf = this.jig.clone().multiplyScalar(-(reduceMotion ? 260 : 190)).addScaledVector(this.jigV, -(reduceMotion ? 18 : 5)).add(ha);
    jf.y += Math.sin(crank * 2) * 0.35 * (0.3 + eff);
    this.jigV.addScaledVector(jf, dt); this.jig.addScaledVector(this.jigV, dt); this.jig.clampLength(0, 0.03);
    this.updateRami(0.12 + this.open * 0.85);
    this.updateGapes(0.12 + this.open * 0.85);
    this.updatePouch(dt);
    // ---- eyes
    this.updateEyes(ctx, dt);
    // ---- legs
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      if (ctx.pedals) { L.pedal.copy(ctx.pedals[i].p); L.pedalQ.copy(ctx.pedals[i].q); }
      L.hip.set(L.sd * 0.078, 0.095 + bob, 0.02).applyQuaternion(tq);
      this.updateLeg(L, clamp(eff + 0.3 * Math.max(0, Math.sin(crank + (i ? Math.PI : 0))), 0, 1));
    }
    // ---- wings
    const trick = ctx.trick || 0;
    this.spread = damp(this.spread, clamp(trick + (ctx.flare || 0), 0, 1), trick > this.spread ? 6 : 4, dt);
    this.flapT += dt * (ctx.flapping ? 9 : 2.2);
    for (let i = 0; i < 2; i++) {
      const W = this.wings[i];
      W.S.set(W.sd * 0.118, 0.425, 0.025).applyQuaternion(tq); W.S.y += bob;
      if (ctx.grips) W.grip.copy(ctx.grips[i]);
      const flap = ctx.flapping ? this.flapT : Math.sin(this.flapT) * 0.25;
      this.updateWing(W, this.spread, flap, t, true);
    }
    this.updateTail(t, ctx.lean || 0);
    this.updateCrest(t, ctx.speed || 0);
    this.updateCape(t);
    this.cards.forEach((c, i) => this.cardMesh.setMatrixAt(i, c.m));
    this.cardMesh.instanceMatrix.needsUpdate = true;
  }

  updateHead(ctx, dt, tq, bob) {
    const t = this.t;
    // desired look direction in pelican space
    let yaw = Math.sin(t * 0.31) * 0.12 + Math.sin(t * 0.73) * 0.05, pitch = 0;
    if (ctx.look && (ctx.lookW || 0) > 0) {
      const lp = this.root.worldToLocal(ctx.look.clone()).sub(this.headPos);
      const ty = Math.atan2(lp.x, lp.z), tp = Math.atan2(lp.y, Math.hypot(lp.x, lp.z)) + 0.2;
      yaw = lerp(yaw, clamp(ty, -1.2, 1.2), ctx.lookW); pitch = lerp(pitch, clamp(tp, -0.5, 0.6), ctx.lookW);
    }
    yaw += (ctx.steer || 0) * 0.25;
    // gulp: tip the bill skyward, then a satisfied head-shake
    let gulpPitch = 0, shake = 0;
    if (this.gulpT >= 0) { gulpPitch = Math.sin(Math.min(1, this.gulpT * 1.4) * Math.PI) * 0.95; shake = this.gulpT > 0.7 ? Math.sin(this.gulpT * 60) * 0.12 * (1 - this.gulpT) * 3 : 0; }
    this.headYaw = damp(this.headYaw, yaw + shake, 5, dt);
    this.headPitch = damp(this.headPitch, pitch + gulpPitch - (ctx.trick || 0) * 0.25, 5, dt);
    // position: stabilised against the pedal bob, drifts back when tipping the bill up
    const target = this.headRestPos.clone();
    target.y += bob * 0.3 - this.headPitch * 0.02;
    target.z += -Math.abs(this.headYaw) * 0.02 - Math.max(0, this.headPitch) * 0.05 + (ctx.effort || 0) * 0.012;
    target.x += Math.sin(this.headYaw) * 0.03;
    const f = target.sub(this.headPos).multiplyScalar(90).addScaledVector(this.headVel, -15).addScaledVector(this.accel, -0.25);
    this.headVel.addScaledVector(f, dt); this.headPos.addScaledVector(this.headVel, dt);
    this.head.position.copy(this.headPos);
    this.head.quaternion.setFromEuler(new THREE.Euler(HEAD_PITCH - this.headPitch, this.headYaw, 0, 'YXZ'));
    // head joints of the loft follow the head frame
    for (let k = 0; k < HEAD_J.length; k++) this.joints[HEAD_J[k]].p.copy(this.headOffsets[k]).applyQuaternion(this.head.quaternion).add(this.headPos);
  }

  updateEyes(ctx, dt) {
    // blinks (both eyes), and the odd sweep of the nictitating membrane
    this.blinkT -= dt; if (this.blinkT <= 0) { this.blinkT = 2.5 + Math.random() * 4; this.blink = 1; }
    this.blink = Math.max(0, this.blink - dt / 0.16);
    const close = Math.sin(this.blink * Math.PI);
    this.nictT -= dt; if (this.nictT <= 0) { this.nictT = 6 + Math.random() * 8; this.nict = 1; }
    this.nict = Math.max(0, this.nict - dt / 0.35);
    const nk = Math.sin(this.nict * Math.PI);
    // micro-saccades
    this.saccT -= dt; if (this.saccT <= 0) { this.saccT = 0.4 + Math.random() * 1.6; this.saccade.set((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.12, 0); }
    for (const E of this.eyes) {
      const base = E.g.userData.base;
      let dir = base.clone();
      if (ctx.eyeLook) {
        const lp = E.g.worldToLocal(ctx.eyeLook.clone()).normalize();
        if (lp.dot(base) > 0.35) dir.copy(lp); // only if it's inside this eye's field of view
      }
      dir.x += this.saccade.x * 0.3; dir.y += this.saccade.y; dir.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dir);
      E.ball.quaternion.slerp(q, 1 - Math.exp(-25 * dt));
      // lids ride on the gaze direction
      const lq = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), base);
      E.upP.quaternion.copy(lq).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), lerp(-1.35, 0.05, close)));
      E.loP.quaternion.copy(lq).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), lerp(1.2, -0.05, close)));
      E.nP.quaternion.copy(lq).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), E.sd * lerp(1.7, 0.1, nk)));
      E.nP.visible = nk > 0.01; E.upP.visible = E.loP.visible = close > 0.01 || this.lidsAlways;
      E.ring.quaternion.copy(lq);
    }
  }
}

// body colour: white with a rosy blush, ochre breast patch, bare pink facial skin and a yellow throat
function bodyColor(c, jf, dors, lat) {
  c.copy(COL.white);
  c.lerp(COL.blush, 0.35 + 0.25 * smooth(4, 9, jf) - 0.2 * smooth(10, 12, jf));
  if (jf < 1.2) c.lerp(COL.grey, 0.4 * (1 - jf / 1.2));
  // yellowish patch on the lower foreneck / upper breast
  const breast = Math.exp(-(((jf - 4.9) / 1.0) ** 2)) * smooth(-0.1, -0.7, dors);
  c.lerp(COL.breast, breast * 0.75);
  let fm = 1;
  // bare facial skin ring around the eye, running forward to the bill base
  const face = smooth(10.6, 11.6, jf) * smooth(0.35, 0.8, Math.abs(lat)) * (1 - smooth(0.35, 0.7, dors));
  // yellow gular skin on the throat just behind the pouch
  const gular = smooth(9.6, 10.8, jf) * smooth(-0.35, -0.8, dors);
  c.lerp(COL.face, face); c.lerp(COL.gular, gular * 0.9);
  // forehead / bill base: bare
  const base = smooth(12.3, 12.9, jf); c.lerp(COL.face, base * 0.6);
  fm = 1 - Math.max(face, gular, base * 0.8);
  // head and upper-neck feathers are tiny and silky: fade the tile relief there
  fm *= 1 - 0.6 * smooth(7.5, 10.2, jf);
  return fm;
}
