// Builds the 3D circuit from track geometry: sky/env/lights, terrain, road ribbons, kerbs, barriers, tunnels,
// bridges, jump ramps, boost pads, item boxes, start gantry, corner signs; then scenery.js dresses the theme.
import * as THREE from 'three';
import { F, DS, wrap, nearestGlobal, lateral } from './track.js';
import { THEMES, GLOW, baseHeight } from './themes.js';
import { canvasTex, speckle, meshFromArrays, rng, fbm, softTex, textTex, FONT_ZH, FONT_EN, smoothstep } from './gfx.js';
import { makeSky } from './render.js';
import { buildScenery } from './scenery.js';

const UP = new THREE.Vector3(0, 1, 0);

// ---- textures ------------------------------------------------------------------------------------
function roadTexture(th, kind) {
  return canvasTex(256, 512, (c, w, h) => {
    const base = kind === 'ice' ? '#bfe6fb' : kind === 'alley' ? '#5b4e58' : kind === 'stairs' ? '#d9d2c4' : kind === 'tomb' ? '#8d7456' : th.road;
    speckle(c, w, h, base, 0.16, 5000, 7);
    if (kind === 'alley') { // cobbles
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2;
      for (let y = 0; y < h; y += 22) for (let x = (y / 22) % 2 ? 11 : 0; x < w; x += 22) { c.strokeRect(x + 1, y + 1, 20, 20); }
    } else if (kind === 'stairs') {
      for (let y = 0; y < h; y += 32) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, y, w, 5); c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(0, y + 5, w, 3); }
      c.fillStyle = '#2f6fd6'; c.fillRect(0, 0, 10, h); c.fillRect(w - 10, 0, 10, h);
    } else if (kind === 'tomb') {
      c.strokeStyle = 'rgba(40,20,0,.35)'; c.lineWidth = 3;
      for (let y = 0; y < h; y += 64) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); for (let x = (y / 64) % 2 ? 40 : 0; x < w; x += 80) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 64); c.stroke(); } }
    } else if (kind === 'ice') {
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.5; const r = rng(3);
      for (let i = 0; i < 40; i++) { c.beginPath(); let x = r() * w, y = r() * h; c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 70; y += (r() - 0.5) * 70; c.lineTo(x, y); } c.stroke(); }
    } else {
      // tyre-worn racing line and edge paint
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,.12)'); g.addColorStop(0.65, 'rgba(0,0,0,.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = th.roadLine; c.fillRect(8, 0, 7, h); c.fillRect(w - 15, 0, 7, h);
      c.globalAlpha = 0.55; for (let y = 0; y < h; y += 128) c.fillRect(w / 2 - 3, y, 6, 64); c.globalAlpha = 1;
    }
  }, { repeat: true });
}
function kerbTexture(th) {
  return canvasTex(64, 128, (c, w, h) => { c.fillStyle = th.kerb[0]; c.fillRect(0, 0, w, h / 2); c.fillStyle = th.kerb[1]; c.fillRect(0, h / 2, w, h / 2); }, { repeat: true });
}
function wallTexture(th) {
  const name = th.name;
  return canvasTex(256, 64, (c, w, h) => {
    if (name === 'city') { speckle(c, w, h, '#4c505f', 0.12, 800, 2); c.fillStyle = '#23252e'; c.fillRect(0, h - 14, w, 14); c.fillStyle = '#ffd21f'; for (let x = 0; x < w; x += 64) { c.beginPath(); c.moveTo(x, 14); c.lineTo(x + 24, 14); c.lineTo(x + 44, 32); c.lineTo(x + 24, 50); c.lineTo(x, 50); c.lineTo(x + 20, 32); c.fill(); } }
    else if (name === 'coast') { speckle(c, w, h, '#e2ded4', 0.08, 600, 3); c.fillStyle = '#1f6fe0'; c.fillRect(0, 0, w, 10); c.strokeStyle = 'rgba(0,0,0,.08)'; for (let x = 0; x < w; x += 32) c.strokeRect(x, 10, 32, 27); }
    else if (name === 'snow') { for (let x = 0; x < w; x += 64) { c.fillStyle = (x / 64) % 2 ? '#e0283c' : '#ffffff'; c.fillRect(x, 0, 64, h); } c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(0, 0, w, 8); }
    else { speckle(c, w, h, '#d6ae76', 0.14, 900, 4); c.strokeStyle = 'rgba(90,50,10,.35)'; c.lineWidth = 2; for (let y = 0; y < h; y += 21) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); for (let x = (y / 21) % 2 ? 32 : 0; x < w; x += 64) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 21); c.stroke(); } } }
  }, { repeat: true });
}
function chevronTexture() {
  return canvasTex(128, 256, (c, w, h) => {
    c.fillStyle = '#0a3a6a'; c.fillRect(0, 0, w, h);
    for (let y = -64; y < h; y += 64) {
      c.fillStyle = '#29e3ff'; c.beginPath(); c.moveTo(10, y + 60); c.lineTo(w / 2, y + 12); c.lineTo(w - 10, y + 60); c.lineTo(w - 10, y + 84); c.lineTo(w / 2, y + 36); c.lineTo(10, y + 84); c.fill();
    }
    c.strokeStyle = '#bff6ff'; c.lineWidth = 6; c.strokeRect(3, -10, w - 6, h + 20);
  }, { repeat: true });
}
function rampTexture() {
  return canvasTex(128, 128, (c, w, h) => { for (let x = -h; x < w; x += 32) { c.fillStyle = '#ffd21f'; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 16, 0); c.lineTo(x + 16 + h, h); c.lineTo(x + h, h); c.fill(); } c.globalCompositeOperation = 'destination-over'; c.fillStyle = '#1a1a1a'; c.fillRect(0, 0, w, h); }, { repeat: true });
}
function checkerTexture() {
  return canvasTex(256, 32, (c, w, h) => { const s = 16; for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { c.fillStyle = ((x + y) / s) % 2 ? '#111' : '#fff'; c.fillRect(x, y, s, s); } });
}
function boxTexture() {
  return canvasTex(128, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ff5fa2'); g.addColorStop(0.5, '#ffd21f'); g.addColorStop(1, '#29d3ff');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(8, 8, w - 16, h - 16);
    c.font = `bold 92px ${FONT_EN}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
    c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 8; c.fillText('?', w / 2, h / 2 + 6);
  });
}
function arrowTexture(dir) {
  return canvasTex(128, 64, (c, w, h) => {
    c.fillStyle = '#ffd21f'; c.fillRect(0, 0, w, h); c.fillStyle = '#12131a';
    for (let k = 0; k < 3; k++) {
      const x = 14 + k * 38;
      c.save(); if (dir < 0) { c.translate(w, 0); c.scale(-1, 1); }
      c.beginPath(); c.moveTo(x + 22, 8); c.lineTo(x + 6, 32); c.lineTo(x + 22, 56); c.lineTo(x + 32, 56); c.lineTo(x + 16, 32); c.lineTo(x + 32, 8); c.fill(); c.restore();
    }
  });
}
// tileable normal map for water
function waterNormals() {
  const S = 256, hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (let o = 0; o < 4; o++) { const f = 2 ** o * 4; v += Math.sin((x / S) * Math.PI * 2 * f + Math.cos((y / S) * Math.PI * 2 * (o + 1)) * 2) * Math.cos((y / S) * Math.PI * 2 * f * 0.7 + o) / (o + 1); }
    hgt[y * S + x] = v;
  }
  return canvasTex(S, S, (c) => {
    const img = c.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)], hy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
      const nx = -hx * 0.9, ny = -hy * 0.9, nz = 1, l = Math.hypot(nx, ny, nz), o = (y * S + x) * 4;
      img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }, { repeat: true, linear: true });
}

// ---- terrain features derived from the track: canal under a gap, gorge / pond / sea under bridges, lake basin
function runs(P, flag) {
  const out = [];
  for (let i = 0; i < P.n; i++) {
    if (!(P.fl[i] & flag) || (P.closed ? (P.fl[wrap(P, i - 1)] & flag) : i > 0 && (P.fl[i - 1] & flag))) continue;
    let e = i; while ((P.fl[wrap(P, e + 1)] & flag) && e - i < P.n) e++;
    out.push([i, e]);
  }
  return out;
}
export function trackFeatures(T, th) {
  const feats = [];
  for (const P of T.paths) {
    const mk = (a, e, kind) => {
      const m = wrap(P, Math.round((a + e) / 2));
      const len = Math.abs(P.s[wrap(P, e)] - P.s[wrap(P, a)]) || (e - a) * DS;
      feats.push({ kind, x: P.x[m], z: P.z[m], y: P.y[m], tx: P.tx[m], tz: P.tz[m], half: len / 2 });
    };
    for (const [a, e] of runs(P, F.GAP)) mk(a, e, 'canal');
    if (th.bridgeDip === 'gorge' || th.bridgeDip === 'pond') for (const [a, e] of runs(P, F.BRG)) if (e - a > 10) mk(a, e, th.bridgeDip);
    if (P.kind === 'lake') {
      let cx = 0, cz = 0; for (let i = 0; i < P.n; i++) { cx += P.x[i]; cz += P.z[i]; }
      feats.push({ kind: 'lake', x: cx / P.n, z: cz / P.n, P });
    }
  }
  return feats;
}
function carve(feats, x, z, h) {
  for (const f of feats) {
    const dx = x - f.x, dz = z - f.z;
    if (f.kind === 'lake') {
      if (dx * dx + dz * dz > 120 * 120) continue;
      let d = 1e9; const P = f.P; for (let i = 0; i < P.n; i += 2) d = Math.min(d, Math.hypot(x - P.x[i], z - P.z[i]));
      h = h + (-0.35 - h) * (1 - smoothstep(44, 64, d));
      continue;
    }
    const al = Math.abs(dx * f.tx + dz * f.tz), ac = Math.abs(dx * f.tz - dz * f.tx);
    if (f.kind === 'canal') { if (al < f.half + 4 && ac < 220) h = Math.min(h, -6); }
    else if (f.kind === 'gorge') { if (ac < 260) h = h + (-38 - h) * (1 - smoothstep(f.half - 16, f.half - 3, al)) * (1 - smoothstep(200, 260, ac)); }
    else if (f.kind === 'pond') { const r = Math.hypot(al / (f.half + 6), ac / 46); h = h + (-3.2 - h) * (1 - smoothstep(0.75, 1.05, r)); }
  }
  return h;
}

// ---- road distance field (splatted onto a grid) -----------------------------------------------------
function roadField(T, th, x0, z0, cell, nx, nz) {
  const N = (nx + 1) * (nz + 1);
  const D = new Float32Array(N).fill(1e9), Y = new Float32Array(N), FL = new Uint8Array(N), HUMP = new Float32Array(N).fill(-1e9);
  const R = 70;
  for (const P of T.paths) for (let i = 0; i < P.n; i++) {
    const fl = P.fl[i];
    if (fl & F.GAP) continue;
    const px = P.x[i], pz = P.z[i], py = P.y[i], hw = P.hw[i];
    const bridge = (fl & F.BRG) && py - baseHeight(th.name, px, pz, T) > 2.5;
    const tun = (fl & F.TUN) && th.hump;
    if (bridge && !tun) continue;
    const c0 = Math.max(0, Math.floor((px - R - x0) / cell)), c1 = Math.min(nx, Math.ceil((px + R - x0) / cell));
    const r0 = Math.max(0, Math.floor((pz - R - z0) / cell)), r1 = Math.min(nz, Math.ceil((pz + R - z0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const gx = x0 + c * cell, gz = z0 + r * cell, d = Math.hypot(gx - px, gz - pz) - hw, o = r * (nx + 1) + c;
      if (!bridge && d < D[o]) { D[o] = d; Y[o] = py; FL[o] = fl; }
      if (tun && d < 40) HUMP[o] = Math.max(HUMP[o], py + 12 - Math.max(0, d - 3) * 0.2);
    }
  }
  return { D, Y, FL, HUMP };
}

export function buildWorld(T, R3) {
  const th = THEMES[T.def.theme];
  const scene = new THREE.Scene();
  const W = { scene, T, th, anim: [], boxes: null, time: 0, hideInTube: [] };
  const b = T.bounds;

  // sky, env, fog, lights
  const sky = makeSky(th); scene.add(sky); W.sky = sky;
  scene.background = null;
  scene.fog = new THREE.Fog(th.fog.color, th.fog.near, th.fog.far);
  const extras = [];
  if (th.night) {
    // glowing panels so metals and paint pick up coloured reflections at night
    const cols = th.name === 'city' ? [0xff2e7e, 0x19d3ff, 0xffd21f, 0x8e4dff] : [0x3cffa0, 0x6d8cff];
    cols.forEach((c, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 180), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); const a = (i / cols.length) * Math.PI * 2; m.position.set(Math.cos(a) * 1500, 120, Math.sin(a) * 1500); m.lookAt(0, 120, 0); m.material.color.multiplyScalar(GLOW.envPanel * (th.name === 'city' ? 1 : 0.5)); extras.push(m); });
  }
  scene.environment = R3.envFrom(sky, extras);
  scene.environmentIntensity = th.envI ?? (th.night ? 0.55 : 0.12);
  const hemi = new THREE.HemisphereLight(th.hemi.sky, th.hemi.ground, th.hemi.intensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(th.sun.color, th.sun.intensity);
  const sd = new THREE.Vector3(...th.sun.dir).normalize();
  if (!th.night && sky.userData.sunDir) sd.copy(sky.userData.sunDir).normalize();
  W.sunDir = sd;
  sun.castShadow = true;
  sun.shadow.mapSize.set(R3.shadowSize, R3.shadowSize);
  const sc = sun.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 500;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5; sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  W.sun = sun;

  // ---- terrain ----
  const feats = W.features = trackFeatures(T, th);
  const cell = 6, pad = 420;
  const x0 = Math.floor((b.x0 - pad) / cell) * cell, z0 = Math.floor((b.z0 - pad) / cell) * cell;
  const nx = Math.ceil((b.x1 + pad - x0) / cell), nz = Math.ceil((b.z1 + pad - z0) / cell);
  const RF = roadField(T, th, x0, z0, cell, nx, nz);
  const tpos = [], tcol = [], tidx = [], tuv = [];
  const hAt = new Float32Array((nx + 1) * (nz + 1));
  for (let r = 0; r <= nz; r++) for (let c = 0; c <= nx; c++) {
    const o = r * (nx + 1) + c, x = x0 + c * cell, z = z0 + r * cell;
    let base = carve(feats, x, z, baseHeight(th.name, x, z, T));
    let h = base;
    const d = RF.D[o];
    // beside a tunnel the ground stays at road level for a full terrain cell past the tube wall: with the usual
    // 2.5 u the 6 u terrain facets rose straight through the tube (hillside rock and dunes showed inside tunnels)
    const flat = RF.FL[o] & F.TUN ? 0.6 + cell + 0.2 : 2.5;
    if (d < 1e8) {
      const ry = RF.Y[o] - 0.45;
      const blend = 10 + Math.min(40, Math.abs(base - ry) * 1.2);
      h = d < flat ? ry : ry + (base - ry) * smoothstep(flat, flat + blend, d);
      if (th.name === 'city') h = d < flat ? ry : Math.min(h, 0);
    }
    if (RF.HUMP[o] > h && d > Math.max(2.8, flat)) h = RF.HUMP[o];
    hAt[o] = h;
    tpos.push(x, h, z); tuv.push(x / 14, z / 14);
    const n = fbm(x * 0.03, z * 0.03, 3);
    let col;
    const g = th.ground, g2 = th.ground2;
    if (th.name === 'coast') {
      const zc = 300 + 35 * smoothstep(-170, -60, x) + 8 * Math.sin(x * 0.03);
      const sand = smoothstep(zc - 30, zc - 5, z) || (h < 1.5 ? 1 : 0);
      col = [g[0] + (g2[0] - g[0]) * sand, g[1] + (g2[1] - g[1]) * sand, g[2] + (g2[2] - g[2]) * sand];
      if (h < -1) col = [0.55, 0.62, 0.5].map((v) => v * 0.8);
      col = col.map((v) => v * (0.8 + n * 0.4));
      if (d < 3.5 && d > -30) col = [0.62, 0.6, 0.55];
    } else if (th.name === 'snow') {
      col = [g[0], g[1], g[2]].map((v) => v * (0.85 + n * 0.2));
    } else if (th.name === 'desert') {
      col = [g[0] + (g2[0] - g[0]) * n, g[1] + (g2[1] - g[1]) * n, g[2] + (g2[2] - g[2]) * n];
    } else {
      col = (Math.floor(x / 12) + Math.floor(z / 12)) % 2 ? g : g2;
      col = col.map((v) => v * (0.85 + n * 0.3));
      if (d < 5 && d > 2.5) col = [0.42, 0.42, 0.46];
    }
    tcol.push(...col);
  }
  // slope shading (rock on steep faces)
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
    const o = r * (nx + 1) + c;
    tidx.push(o, o + nx + 1, o + 1, o + 1, o + nx + 1, o + nx + 2);
  }
  for (let r = 1; r < nz; r++) for (let c = 1; c < nx; c++) {
    const o = r * (nx + 1) + c;
    const sl = Math.hypot(hAt[o + 1] - hAt[o - 1], hAt[o + nx + 1] - hAt[o - nx - 1]) / (2 * cell);
    if (sl > 0.7 && RF.D[o] > 3) {
      const rock = th.name === 'snow' ? [0.36, 0.38, 0.45] : th.name === 'desert' ? [0.62, 0.42, 0.26] : th.name === 'coast' ? [0.5, 0.46, 0.4] : [0.3, 0.3, 0.33];
      const t = smoothstep(0.7, 1.3, sl);
      for (let q = 0; q < 3; q++) tcol[o * 3 + q] = tcol[o * 3 + q] * (1 - t) + rock[q] * t;
    }
  }
  const tg = meshFromArrays(tpos, tidx, { color: tcol, uv: tuv });
  const detail = canvasTex(256, 256, (c, w, h) => speckle(c, w, h, '#ffffff', th.name === 'city' ? 0.25 : 0.35, 9000, 11), { repeat: true });
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: th.name === 'snow' ? 0.72 : 0.95, metalness: 0 }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  W.terrain = { x0, z0, cell, nx, nz, h: hAt, D: RF.D };
  W.groundAt = (x, z) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell, c = Math.max(0, Math.min(nx - 1, Math.floor(fx))), r = Math.max(0, Math.min(nz - 1, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - c)), v = Math.max(0, Math.min(1, fz - r)), o = r * (nx + 1) + c;
    return (hAt[o] * (1 - u) + hAt[o + 1] * u) * (1 - v) + (hAt[o + nx + 1] * (1 - u) + hAt[o + nx + 2] * u) * v;
  };
  W.roadDist = (x, z) => {
    const c = Math.round((x - x0) / cell), r = Math.round((z - z0) / cell);
    if (c < 0 || r < 0 || c > nx || r > nz) return 1e9;
    return RF.D[r * (nx + 1) + c];
  };
  // exact distance to any road centreline minus half width (for prop placement near bridges too)
  // distance to the nearest tunnel sample on any path: props with posts keep clear of tunnel mouths
  const tun = [];
  for (const P of T.paths) for (let i = 0; i < P.n; i++) if (P.fl[i] & F.TUN) tun.push(P.x[i], P.z[i]);
  W.nearTunnel = (x, z) => { let d = 1e9; for (let k = 0; k < tun.length; k += 2) d = Math.min(d, Math.hypot(x - tun[k], z - tun[k + 1])); return d; };
  W.roadDistAll = (x, z) => {
    let best = 1e9;
    for (const P of T.paths) for (let i = 0; i < P.n; i += 2) { const d = Math.hypot(x - P.x[i], z - P.z[i]) - P.hw[i]; if (d < best) best = d; }
    return best;
  };

  // ---- road surfaces ----
  const mats = {
    road: new THREE.MeshStandardMaterial({ map: roadTexture(th, 'road'), roughness: th.roadRough ?? 0.82, metalness: 0.05 }),
    ramp: new THREE.MeshStandardMaterial({ map: rampTexture(), roughness: 0.6, emissive: 0x332200, emissiveIntensity: 0.4 }),
    shoulder: new THREE.MeshStandardMaterial({ color: th.name === 'snow' ? 0xf2f6ff : th.name === 'desert' ? 0xcfa368 : th.name === 'coast' ? 0xd8d2c0 : 0x5a5d68, roughness: 0.9 }),
    kerb: new THREE.MeshStandardMaterial({ map: kerbTexture(th), roughness: 0.6 })
  };
  const branchKind = (P) => (P.kind === 'lake' ? 'ice' : P.kind);
  for (const P of T.paths) {
    const kind = P.id === 0 ? 'road' : branchKind(P);
    // shortcut roads lie on the loop road where they fork and rejoin: push them back in depth so the loop road
    // always wins there instead of the two surfaces flickering
    const mat = kind === 'road' ? mats.road : new THREE.MeshStandardMaterial({ map: roadTexture(th, kind), roughness: kind === 'ice' ? 0.12 : 0.85, metalness: kind === 'ice' ? 0.1 : 0, transparent: kind === 'ice', opacity: kind === 'ice' ? 0.92 : 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    const pos = [], uv = [], idxA = [], idxR = [], sh = [], shIdx = [];
    const iceMain = new THREE.MeshStandardMaterial({ map: roadTexture(th, 'ice'), roughness: 0.15, metalness: 0.1 });
    const idxI = [];
    for (let i = 0; i < P.n; i++) {
      const hw = P.hw[i], y = P.y[i] + 0.02;
      pos.push(P.x[i] + P.nx[i] * hw, y, P.z[i] + P.nz[i] * hw, P.x[i] - P.nx[i] * hw, y, P.z[i] - P.nz[i] * hw);
      uv.push(0, P.s[i] / 9, 1, P.s[i] / 9);
      // shoulders: a skirt outside each edge dropping below the road
      for (const s of [1, -1]) {
        sh.push(P.x[i] + P.nx[i] * s * hw, y - 0.01, P.z[i] + P.nz[i] * s * hw, P.x[i] + P.nx[i] * s * (hw + 1.6), y - 0.55, P.z[i] + P.nz[i] * s * (hw + 1.6));
      }
    }
    const last = P.closed ? P.n : P.n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % P.n;
      if ((P.fl[i] | P.fl[j]) & F.GAP) continue;
      if (Math.abs(P.y[j] - P.y[i]) > 1.2) continue;
      const a = i * 2, c = j * 2;
      // wrap: uv continuity at the seam is fine (texture repeats)
      const tri = [a, a + 1, c, a + 1, c + 1, c];
      if (P.fl[i] & F.RAMP) idxR.push(...tri); else if ((P.fl[i] & F.ICE) && P.id === 0) idxI.push(...tri); else idxA.push(...tri);
      for (const s of [0, 1]) { const o = i * 4 + s * 2, q = j * 4 + s * 2; shIdx.push(...(s === 0 ? [o, q, o + 1, o + 1, q, q + 1] : [o, o + 1, q, q, o + 1, q + 1])); }
    }
    const g = meshFromArrays(pos, [...idxA, ...idxR, ...idxI], { uv });
    g.addGroup(0, idxA.length, 0); g.addGroup(idxA.length, idxR.length, 1); g.addGroup(idxA.length + idxR.length, idxI.length, 2);
    const road = new THREE.Mesh(g, [mat, mats.ramp, iceMain]);
    road.receiveShadow = true;
    scene.add(road);
    const sg = meshFromArrays(sh, shIdx);
    const shoulder = new THREE.Mesh(sg, mats.shoulder); shoulder.receiveShadow = true; scene.add(shoulder);
  }

  // ---- kerbs on the inside of corners ----
  {
    const pos = [], uv = [], idx = [];
    const P = T.main;
    for (let i = 0; i < P.n; i++) {
      const k = P.kap[i];
      if (Math.abs(k) < 1 / 70 || P.fl[i] & (F.GAP | F.RAMP)) continue;
      const j = (i + 1) % P.n;
      if (Math.abs(P.kap[j]) < 1 / 70 || Math.abs(P.y[j] - P.y[i]) > 1.2) continue;
      const s = Math.sign(k); // inside of a left turn is the left side (+normal)
      const v = pos.length / 3;
      for (const q of [i, j]) {
        const hw = P.hw[q];
        pos.push(P.x[q] + P.nx[q] * s * hw, P.y[q] + 0.07, P.z[q] + P.nz[q] * s * hw, P.x[q] + P.nx[q] * s * (hw - 1.3), P.y[q] + 0.07, P.z[q] + P.nz[q] * s * (hw - 1.3));
        uv.push(0, P.s[q] / 3, 1, P.s[q] / 3);
      }
      idx.push(...(s > 0 ? [v, v + 1, v + 2, v + 1, v + 3, v + 2] : [v, v + 2, v + 1, v + 1, v + 2, v + 3]));
    }
    const m = new THREE.Mesh(meshFromArrays(pos, idx, { uv }), mats.kerb); m.receiveShadow = true; scene.add(m);
  }

  // ---- barriers ----
  const wallTex = wallTexture(th);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.05 });
  const trimMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: th.wall.trim, emissive: th.name === 'city' ? th.wall.trim : 0x000000, emissiveIntensity: th.name === 'city' ? GLOW.trim : 0, roughness: 0.4 });
  const trimMat2 = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: th.wall.trim2, emissive: th.name === 'city' ? th.wall.trim2 : 0x000000, emissiveIntensity: th.name === 'city' ? GLOW.trim : 0, roughness: 0.4 });
  // city: the neon trims spill coloured light onto the asphalt (additive strip, trim colour at the barrier → black)
  const spill = th.name === 'city' && new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true });
  const railMat = new THREE.MeshStandardMaterial({ color: th.name === 'snow' ? 0x7a4a26 : th.name === 'coast' ? 0xe0dcd2 : th.name === 'desert' ? 0xc9955a : 0xb8c0cc, roughness: 0.5, metalness: th.name === 'city' ? 0.6 : 0 });
  for (const P of T.paths) {
    for (const side of [1, -1]) {
      const open = side > 0 ? P.openL : P.openR;
      const pos = [], uv = [], idx = [], tpos = [], tidx = [], gpos = [], gcol = [], gidx = [];
      const glow = new THREE.Color(side > 0 ? th.wall.trim : th.wall.trim2).multiplyScalar(GLOW.neonSpill);
      const H = 1.15, t0 = 0.2, t1 = 0.8;
      let prev = -1;
      const last = P.closed ? P.n : P.n - 1;
      for (let s = 0; s <= last; s++) {
        const i = s % P.n;
        const skip = open[i] || (P.fl[i] & (F.GAP | F.TUN)) || (!P.closed && (i < 2 || i > P.n - 3));
        if (skip) { prev = -1; continue; }
        const hw = P.hw[i], y = P.y[i];
        const v = pos.length / 3;
        const ix = P.x[i] + P.nx[i] * side * (hw + t0), iz = P.z[i] + P.nz[i] * side * (hw + t0);
        const ox = P.x[i] + P.nx[i] * side * (hw + t1), oz = P.z[i] + P.nz[i] * side * (hw + t1);
        pos.push(ix, y - 0.4, iz, ix, y + H, iz, ox, y + H, oz, ox, y - 0.6, oz);
        uv.push(P.s[i] / 6, 0, P.s[i] / 6, 1, P.s[i] / 6 + 0.05, 1, P.s[i] / 6 + 0.1, 0);
        const tv = tpos.length / 3;
        tpos.push(ix, y + H, iz, ox, y + H, oz, ix, y + H + 0.14, iz, ox, y + H + 0.14, oz);
        if (spill) { const w = hw - 3.2; gpos.push(P.x[i] + P.nx[i] * side * hw, y + 0.1, P.z[i] + P.nz[i] * side * hw, P.x[i] + P.nx[i] * side * w, y + 0.1, P.z[i] + P.nz[i] * side * w); gcol.push(glow.r, glow.g, glow.b, 0, 0, 0); }
        if (prev >= 0 && Math.abs(P.y[i] - P.y[prev]) < 1.2) {
          const a = v - 4;
          // inner face, top, outer face (winding so faces point away from the wall body)
          const q = side < 0 ? [[a, a + 1, v], [v, a + 1, v + 1], [a + 1, a + 2, v + 1], [v + 1, a + 2, v + 2], [a + 2, a + 3, v + 2], [v + 2, a + 3, v + 3]]
            : [[a, v, a + 1], [v, v + 1, a + 1], [a + 1, v + 1, a + 2], [v + 1, v + 2, a + 2], [a + 2, v + 2, a + 3], [v + 2, v + 3, a + 3]];
          for (const t of q) idx.push(...t);
          const ta = tv - 4;
          tidx.push(...(side > 0 ? [ta, ta + 2, tv, tv, ta + 2, tv + 2, ta + 2, ta + 3, tv + 2, tv + 2, ta + 3, tv + 3] : [ta, tv, ta + 2, tv, tv + 2, ta + 2, ta + 2, tv + 2, ta + 3, tv + 2, tv + 3, ta + 3]));
          if (spill) { const gv = gpos.length / 3 - 2, ga = gv - 2; gidx.push(...(side > 0 ? [ga, ga + 1, gv, gv, ga + 1, gv + 1] : [ga, gv, ga + 1, gv, gv + 1, ga + 1])); }
        }
        prev = i;
      }
      if (!idx.length) continue;
      const m = new THREE.Mesh(meshFromArrays(pos, idx, { uv }), wallMat);
      m.castShadow = true; m.receiveShadow = true; scene.add(m);
      const tm = new THREE.Mesh(meshFromArrays(tpos, tidx), side > 0 ? trimMat : trimMat2); scene.add(tm);
      if (spill && gidx.length) { const gm = new THREE.Mesh(meshFromArrays(gpos, gidx, { color: gcol }), spill); gm.renderOrder = 1; scene.add(gm); }
    }
  }

  // ---- tunnels ----
  buildTunnels(W, mats);
  // ---- bridges ----
  buildBridges(W, railMat);
  // ---- ramps: lip faces ----
  {
    const m = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.8 });
    for (const j of T.jumps) {
      const P = T.paths[j.path], i = j.i, i2 = wrap(P, i + 1);
      const drop = P.y[i] - P.y[i2];
      if (drop < 0.3) continue;
      const g = new THREE.BoxGeometry(P.hw[i] * 2, drop + 0.4, 0.5);
      const box = new THREE.Mesh(g, m);
      box.position.set(P.x[i], P.y[i] - drop / 2 - 0.1, P.z[i]);
      box.rotation.y = Math.atan2(P.tx[i], P.tz[i]);
      box.castShadow = true; scene.add(box);
    }
  }

  // ---- boost pads ----
  {
    const tex = chevronTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, color: 0xffffff, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    mat.color.multiplyScalar(GLOW.pad);
    const pos = [], uv = [], idx = [];
    for (const p of T.pads) {
      const P = T.paths[p.path];
      for (let k = -2; k <= 1; k++) {
        const i = wrap(P, p.i + k), j = wrap(P, p.i + k + 1);
        const v = pos.length / 3;
        for (const q of [i, j]) {
          pos.push(P.x[q] + P.nx[q] * (p.lat + 2.6), P.y[q] + 0.06, P.z[q] + P.nz[q] * (p.lat + 2.6), P.x[q] + P.nx[q] * (p.lat - 2.6), P.y[q] + 0.06, P.z[q] + P.nz[q] * (p.lat - 2.6));
        }
        const v0 = (k + 2) / 4, v1 = (k + 3) / 4;
        uv.push(0, v0, 1, v0, 0, v1, 1, v1);
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
    const m = new THREE.Mesh(meshFromArrays(pos, idx, { uv }), mat);
    m.renderOrder = 2;
    scene.add(m);
    W.anim.push((dt) => { tex.offset.y -= dt * 1.6; });
  }

  // ---- start line + gantry ----
  buildGantry(W);

  // ---- corner arrow boards (outside of tight corners) ----
  {
    const texL = arrowTexture(1), texR = arrowTexture(-1);
    const mL = new THREE.MeshStandardMaterial({ map: texL, emissive: 0xffffff, emissiveMap: texL, emissiveIntensity: th.night ? GLOW.arrowBoard : 0.08, roughness: 0.5 });
    const mR = new THREE.MeshStandardMaterial({ map: texR, emissive: 0xffffff, emissiveMap: texR, emissiveIntensity: th.night ? GLOW.arrowBoard : 0.08, roughness: 0.5 });
    const geo = new THREE.PlaneGeometry(3.2, 1.6);
    const P = T.main, boards = [[], []], posts = [];
    const o3 = new THREE.Object3D();
    let lastI = -99;
    for (let i = 0; i < P.n; i++) {
      if (P.rad[i] > 34 || i - lastI < 14 || P.fl[i] & (F.TUN | F.GAP | F.BRG)) continue;
      const turn = Math.sign(P.kap[i]) || 1;
      const out = -turn; // outside of the corner
      if ((out > 0 ? P.openL : P.openR)[i]) continue;
      // the whole run of boards (and their posts) must stay well away from any tunnel mouth
      if ([0, 5, 10].some((o) => { const q = wrap(P, i + o); return (P.fl[q] & (F.TUN | F.GAP | F.BRG)) || W.nearTunnel(P.x[q], P.z[q]) < 14; })) continue;
      lastI = i;
      for (const off of [0, 5, 10]) {
        const q = wrap(P, i + off), hw = P.hw[q] + 0.9;
        o3.position.set(P.x[q] + P.nx[q] * out * hw, P.y[q] + 2.3, P.z[q] + P.nz[q] * out * hw);
        o3.lookAt(P.x[q], P.y[q] + 2.3, P.z[q]); o3.updateMatrix();
        boards[turn > 0 ? 0 : 1].push(o3.matrix.clone());
        posts.push(new THREE.Matrix4().makeTranslation(o3.position.x, P.y[q] + 0.9, o3.position.z));
      }
    }
    boards.forEach((list, s) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, s ? mR : mL, list.length); list.forEach((m, n) => im.setMatrixAt(n, m)); scene.add(im); });
    if (posts.length) { const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6), railMat, posts.length); posts.forEach((m, n) => im.setMatrixAt(n, m)); scene.add(im); }
  }

  // ---- item boxes (shown only in item mode) ----
  {
    const tex = boxTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: GLOW.itemBox, transparent: true, opacity: 0.88, roughness: 0.2, metalness: 0.1 });
    W.boxMat = mat;
  }

  // ---- water ----
  W.waterNormals = waterNormals();
  if (th.name === 'coast') {
    const m = new THREE.MeshStandardMaterial({ color: 0x1678b8, roughness: 0.08, metalness: 0.1, normalMap: W.waterNormals, normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, opacity: 0.93 });
    W.waterNormals.repeat.set(60, 60);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), m);
    sea.rotation.x = -Math.PI / 2; sea.position.y = th.sea; sea.receiveShadow = true;
    scene.add(sea);
    W.anim.push((dt) => { W.waterNormals.offset.x += dt * 0.004; W.waterNormals.offset.y += dt * 0.0025; });
  }

  buildScenery(W);
  // cull-friendly: static meshes don't need matrix updates every frame
  scene.traverse((o) => { if (o.isMesh && !o.userData.dynamic) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
  return W;
}

function buildTunnels(W, mats) {
  const { scene, T, th } = W;
  const tunMat = new THREE.MeshStandardMaterial({
    color: th.name === 'snow' ? 0x9fd8ff : th.name === 'coast' ? 0x7a6e62 : th.name === 'desert' ? 0xb08a5a : 0x9aa0aa,
    roughness: th.name === 'snow' ? 0.15 : 0.85, metalness: th.name === 'snow' ? 0.2 : 0,
    emissive: th.name === 'snow' ? 0x2a7fd0 : 0x000000, emissiveIntensity: th.name === 'snow' ? 0.22 : 0,
    transparent: th.name === 'snow', opacity: th.name === 'snow' ? 0.9 : 1, side: THREE.DoubleSide
  });
  // recessed strip lights: a light source, so it sits just above the bloom threshold (see GLOW in themes.js)
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.name === 'desert' ? 0xffb060 : th.name === 'snow' ? 0xbff4ff : th.name === 'coast' ? 0xffe6b0 : 0xeaf4ff).multiplyScalar(GLOW.tunnelLamp) });
  const portalMat = new THREE.MeshStandardMaterial({ color: th.name === 'city' ? 0x62687a : th.name === 'snow' ? 0xdff4ff : th.name === 'desert' ? 0xc79a60 : 0x8a7a66, roughness: 0.7 });
  const lamps = [];
  for (const P of T.paths) {
    // contiguous runs
    let i = 0;
    const n = P.n, runs = [];
    const isT = (k) => (P.fl[wrap(P, k)] & F.TUN) !== 0;
    if (P.closed) {
      let start = -1;
      for (let k = 0; k < n; k++) if (isT(k) && !isT(k - 1)) { start = k; let e = k; while (isT(e + 1) && e - k < n) e++; runs.push([start, e]); }
    } else {
      while (i < n) { if (isT(i)) { let e = i; while (e + 1 < n && isT(e + 1)) e++; runs.push([i, e]); i = e + 1; } else i++; }
    }
    for (const [a, e] of runs) {
      const prof = [];
      const H = 7.6, SEG = 12;
      for (let q = 0; q <= SEG; q++) { const ang = Math.PI * (q / SEG); prof.push([Math.cos(ang), Math.sin(ang)]); }
      const pos = [], idx = [], uv = [];
      // the tube runs exactly between the two portals (portal frames sit centred on samples a and e);
      // nothing of the tunnel may stick out past a portal face
      const count = e - a + 1;
      for (let s = 0; s < count; s++) {
        const k = wrap(P, a + s);
        const hw = P.hw[k] + 0.6, y = P.y[k];
        for (const [cx, cy] of [[1, -0.1], ...prof, [-1, -0.1]]) {
          const lat = cx * hw, hh = cy < 0 ? -0.6 : 2.2 + cy * (H - 2.2);
          const lx = cy < 0 ? lat : lat * (cy > 0 ? 1 : 1);
          pos.push(P.x[k] + P.nx[k] * lx, y + hh, P.z[k] + P.nz[k] * lx);
          uv.push(cx * 2, P.s[k] / 8);
        }
        if (s > 0) {
          const C = prof.length + 2, o = (s - 1) * C, q2 = s * C;
          for (let m = 0; m < C - 1; m++) idx.push(o + m, q2 + m, o + m + 1, o + m + 1, q2 + m, q2 + m + 1);
        }
        // two continuous LED lines along the upper walls, starting and ending well inside the tube
        if (s >= 4 && s <= count - 5) lamps.push({ P, k, hw, y, H, first: s === 4 });
      }
      const mesh = new THREE.Mesh(meshFromArrays(pos, idx, { uv }), tunMat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      // portals
      for (const end of [a, e]) {
        const k = wrap(P, end), hw = P.hw[k] + 0.6;
        // a U-shaped frame around the arch; its opening is a lip 0.3 u inside the tube so the frame's inner faces
        // never lie on the tube wall, even where the tunnel slopes (they were coplanar and flickered at every mouth)
        const shape = new THREE.Shape();
        const Wd = hw + 2.2, Ht = H + 2.4, hr = hw - 0.3;
        shape.moveTo(-Wd, -0.6); shape.lineTo(-hr, -0.6);
        for (let q = SEG; q >= 0; q--) { const ang = Math.PI * (q / SEG); shape.lineTo(Math.cos(ang) * hr, 2.2 + Math.sin(ang) * (H - 2.5)); }
        shape.lineTo(hr, -0.6); shape.lineTo(Wd, -0.6); shape.lineTo(Wd, Ht); shape.lineTo(-Wd, Ht); shape.lineTo(-Wd, -0.6);
        const g = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false });
        g.translate(0, 0, -0.8);
        const pm = new THREE.Mesh(g, portalMat);
        pm.position.set(P.x[k], P.y[k], P.z[k]);
        pm.rotation.y = Math.atan2(P.tx[k], P.tz[k]);
        pm.castShadow = true; pm.receiveShadow = true;
        scene.add(pm);
        if (th.name === 'city') {
          // neon tube around the arch on both faces, so the mouth reads at night
          const arch = [];
          for (let q = 0; q <= SEG; q++) { const ang = Math.PI * (q / SEG); arch.push(new THREE.Vector3(Math.cos(ang) * (hw + 0.35), 2.2 + Math.sin(ang) * (H - 1.85), 0)); }
          arch.unshift(new THREE.Vector3(hw + 0.35, 0.2, 0)); arch.push(new THREE.Vector3(-hw - 0.35, 0.2, 0));
          const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arch), 48, 0.13, 6);
          const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.wall.trim).multiplyScalar(GLOW.neon) });
          for (const z of [-0.88, 0.88]) { const m = new THREE.Mesh(tube, neon); m.position.z = z; pm.add(m); }
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.8), new THREE.MeshBasicMaterial({ map: textTexSign('地下通道', 'UNDERPASS', '#19d3ff'), transparent: true }));
          sign.position.set(0, Ht - 1.2, end === a ? -0.85 : 0.85);
          if (end === a) sign.rotation.y = Math.PI;
          pm.add(sign);
        }
      }
    }
  }
  if (lamps.length) {
    // ribbons lying on the arch at 55° (inset a few cm so they sit on the wall, not in the air)
    const pos = [], idx = [];
    const ang = (55 * Math.PI) / 180, half = 0.22; // half-width along the arch (u)
    for (const side of [1, -1]) {
      let prev = -1;
      for (const l of lamps) {
        const P = l.P, k = l.k, r = l.hw - 0.06;
        const v = pos.length / 3;
        for (const d of [-half, half]) {
          const a = ang + d * side / l.hw;
          const lat = side * Math.cos(a) * r, h = 2.2 + Math.sin(a) * (l.H - 2.2) * (r / l.hw);
          pos.push(P.x[k] + P.nx[k] * lat, l.y + h, P.z[k] + P.nz[k] * lat);
        }
        if (prev >= 0 && !l.first) idx.push(prev, prev + 1, v, v, prev + 1, v + 1);
        prev = v;
      }
    }
    const m = new THREE.Mesh(meshFromArrays(pos, idx), lightMat);
    lightMat.side = THREE.DoubleSide;
    scene.add(m);
  }
}
function textTexSign(zh, en, color) {
  return textTex([{ text: zh, font: `64px ${FONT_ZH}`, color, glow: color, y: 44 }, { text: en, font: `26px ${FONT_EN}`, color: '#ffffff', y: 100 }], { w: 512, h: 128, bg: 'rgba(8,10,24,.85)' });
}

function buildBridges(W, railMat) {
  const { scene, T, th } = W;
  const deckMat = new THREE.MeshStandardMaterial({ color: th.name === 'snow' ? 0x6b4428 : th.name === 'coast' ? 0xd6cfc0 : th.name === 'desert' ? 0xc49660 : 0x8a8f9a, roughness: 0.8 });
  const pillarGeo = th.name === 'snow' ? new THREE.BoxGeometry(0.8, 1, 0.8) : new THREE.CylinderGeometry(1.1, 1.3, 1, 12);
  const pillars = [];
  for (const P of T.paths) {
    const pos = [], idx = [];
    let prev = -1, lastPillar = -99;
    for (let s = 0; s <= (P.closed ? P.n : P.n - 1); s++) {
      const i = s % P.n;
      const br = (P.fl[i] & F.BRG) && P.y[i] - W.groundAt(P.x[i], P.z[i]) > 2;
      if (!br) { prev = -1; continue; }
      const hw = P.hw[i] + 0.8, y = P.y[i];
      // arched underside between pillars
      const phase = ((P.s[i] % 24) / 24) * 2 - 1;
      const depth = th.name === 'coast' ? 1.4 + 2.2 * (1 - phase * phase) : 1.5;
      const v = pos.length / 3;
      pos.push(P.x[i] + P.nx[i] * hw, y - 0.2, P.z[i] + P.nz[i] * hw, P.x[i] - P.nx[i] * hw, y - 0.2, P.z[i] - P.nz[i] * hw,
        P.x[i] + P.nx[i] * hw, y - depth, P.z[i] + P.nz[i] * hw, P.x[i] - P.nx[i] * hw, y - depth, P.z[i] - P.nz[i] * hw);
      if (prev >= 0) { const a = v - 4; idx.push(a + 2, a + 3, v + 2, v + 2, a + 3, v + 3, a, a + 2, v, v, a + 2, v + 2, a + 1, v + 1, a + 3, a + 3, v + 1, v + 3); }
      prev = i;
      if (P.s[i] - lastPillar >= 24) {
        lastPillar = P.s[i];
        const gy = W.groundAt(P.x[i], P.z[i]) - 2;
        const top = y - depth + 0.2;
        if (top - gy > 1) for (const side of (P.hw[i] > 7 ? [0.55, -0.55] : [0])) pillars.push([P.x[i] + P.nx[i] * P.hw[i] * side, gy, P.z[i] + P.nz[i] * P.hw[i] * side, top - gy]);
      }
    }
    if (idx.length) { const m = new THREE.Mesh(meshFromArrays(pos, idx), deckMat); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  }
  if (pillars.length) {
    const im = new THREE.InstancedMesh(pillarGeo, deckMat, pillars.length);
    const m4 = new THREE.Matrix4();
    pillars.forEach(([x, y, z, h], n) => { m4.makeScale(1, h, 1); m4.setPosition(x, y + h / 2, z); im.setMatrixAt(n, m4); });
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
  }
}

function buildGantry(W) {
  const { scene, T, th } = W, P = T.main, i = 0;
  const g = new THREE.Group();
  const hw = P.hw[i];
  const col = th.name === 'city' ? 0x1b1f33 : th.name === 'snow' ? 0x1b3f7a : th.name === 'desert' ? 0x6a3a1a : 0x1f4fa8;
  const frame = new THREE.MeshStandardMaterial({ color: col, metalness: 0.6, roughness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xffd21f, emissive: 0xffd21f, emissiveIntensity: th.night ? GLOW.gantryAccent : 0.2, roughness: 0.4 });
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.4), frame);
    p.position.set(s * (hw + 1.6), 5, 0); p.castShadow = true; g.add(p);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.3, 1.45), accent); stripe.position.set(s * (hw + 1.6), 3, 0); g.add(stripe);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 4.6, 2.8, 1.2), frame);
  beam.position.set(0, 9.4, 0); beam.castShadow = true; g.add(beam);
  const tex = textTex([
    { text: '风驰', font: `bold 120px ${FONT_ZH}`, color: '#ffd21f', glow: '#ff8a1f', dx: -300, y: 88 },
    { text: 'WINDRIFT', font: `72px ${FONT_EN}`, color: '#ffffff', dx: 60, y: 70 },
    { text: `${T.def.zh} · ${T.def.en.toUpperCase()}`, font: `34px ${FONT_EN}`, color: '#9fe8ff', dx: 60, y: 128 }
  ], { w: 1024, h: 170, bg: '#0c1330' });
  for (const s of [1, -1]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 1, 2.3), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: th.night ? GLOW.banner : 0.25 }));
    banner.position.set(0, 9.4, s * 0.62); if (s < 0) banner.rotation.y = Math.PI;
    g.add(banner);
  }
  // start lights: 5 pods facing the grid (which sits behind the line = -z local)
  W.lights = [];
  for (let q = 0; q < 5; q++) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 20), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x000000, emissiveIntensity: GLOW.startLight, roughness: 0.3 }));
    pod.rotation.x = Math.PI / 2;
    pod.position.set((q - 2) * 1.7, 7.35, -0.7);
    g.add(pod); W.lights.push(pod.material);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 0.6), frame); hood.position.set((q - 2) * 1.7, 7.35, -0.4); g.add(hood);
  }
  g.position.set(P.x[i], P.y[i], P.z[i]);
  g.rotation.y = Math.atan2(P.tx[i], P.tz[i]);
  scene.add(g);
  W.gantry = g;
  // checkered line + grid marks
  const chk = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 2.4), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  chk.rotation.x = -Math.PI / 2; chk.position.set(0, 0.05, 0);
  g.add(chk);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let slot = 0; slot < 8; slot++) {
    const back = 8 + slot * 5.5, lat = (slot % 2 ? -1 : 1) * 4.2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.25), markMat);
    m.rotation.x = -Math.PI / 2; m.position.set(lat, 0.05, -back + 1.9);
    g.add(m);
  }
}

export function setStartLights(W, n, go) {
  if (!W.lights) return;
  W.lights.forEach((m, q) => {
    if (go) { m.emissive.setHex(0x22ff66); m.color.setHex(0x22ff66); }
    else if (q < n) { m.emissive.setHex(0xff2020); m.color.setHex(0xff2020); }
    else { m.emissive.setHex(0x000000); m.color.setHex(0x111111); }
  });
}

// item boxes (item mode): instanced, hidden when taken
export function buildItemBoxes(W, items) {
  if (W.boxMesh) { W.scene.remove(W.boxMesh); W.boxMesh.geometry.dispose(); W.boxMesh.dispose(); W.boxMesh = null; }
  if (!items) return;
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), W.boxMat, items.boxes.length);
  im.userData.dynamic = true;
  im.frustumCulled = false;
  W.scene.add(im); W.boxMesh = im; W.boxState = items.boxes;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function updateWorld(W, dt, focus, cam) {
  W.time += dt;
  if (cam) for (const h of W.hideInTube) {
    const P = h.P, i = nearestGlobal(P, cam.x, cam.z, cam.y);
    h.mesh.visible = !((P.fl[i] & F.TUN) && Math.abs(lateral(P, i, cam.x, cam.z)) < P.hw[i] + 0.6 && cam.y < P.y[i] + 8);
  }
  for (const f of W.anim) f(dt, W.time);
  if (W.sky.material.uniforms && W.sky.material.uniforms.time) W.sky.material.uniforms.time.value = W.time;
  if (focus) {
    const s = W.sun, d = W.sunDir;
    s.position.set(focus.x + d.x * 180, focus.y + d.y * 180, focus.z + d.z * 180);
    s.target.position.set(focus.x, focus.y, focus.z);
    s.target.updateMatrixWorld();
  }
  if (W.boxMesh) {
    const t = W.time;
    W.boxState.forEach((b, n) => {
      const sc = b.active ? 1 : Math.max(0, 1 - (2.5 - b.t) * 6) * 0 + (b.t < 0.3 ? 1 - b.t / 0.3 : 0);
      _e.set(0.5, t * 1.8 + n, 0.3); _q.setFromEuler(_e);
      _v.set(b.x, b.y + Math.sin(t * 3 + n) * 0.2, b.z); _s.setScalar(sc);
      _m.compose(_v, _q, _s); W.boxMesh.setMatrixAt(n, _m);
    });
    W.boxMesh.instanceMatrix.needsUpdate = true;
  }
}
