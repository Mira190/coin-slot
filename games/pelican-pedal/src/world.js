// The island: terrain, coast road (asphalt / boardwalk planks / town cobbles), beach huts,
// a whitewashed town with a harbour and chapel, the lighthouse, pines, palms, rocks, grass
// and street lamps that switch on at dusk. Behind it all, a glacial lake behind the west beach and a snow-capped
// mainland range round the bay.
import { THREE, V3, clamp, lerp, smooth, rng, canvas, dataTex, normalFromHeight, tfbm, vnoise, mesh, MAX_ANISO, TAU, scene, bakeStatic, noReflect } from './core.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD, LOOP_LEN, ROAD_W, STRETCH, zoneAt, roadHeight, roadDist, terrainAt, LIGHTHOUSE, CHAPEL, fbm2 } from './layout.js';

export const EXT = 560;          // terrain covers [-EXT, EXT]^2
const TG = 373;                  // terrain grid vertices per side (3 m cells)
const N = ROAD.length;
// the glacial lake behind the west beach, just inland of the ride's start: an ellipse (centre, semi-axes, surface)
const LAKE = { x: -270, z: 18, ax: 32, az: 82, level: 1.9 };
// its basin: a shallow bowl, then ground rising gently toward the road (so you see the water from it) and steeply inland
// (the shore wanders: the ellipse's radius varies with the angle round it)
const lakeWobble = (u, v) => { const a = Math.atan2(v, u); return 1 + 0.1 * Math.sin(3 * a + 1.1) + 0.06 * Math.sin(5 * a + 2.3) + 0.035 * Math.sin(9 * a + 0.4); };
function lakeBed(x, z) {
  const w = lakeWobble((x - LAKE.x) / LAKE.ax, (z - LAKE.z) / LAKE.az), u = (x - LAKE.x) / (LAKE.ax * w), v = (z - LAKE.z) / (LAKE.az * w), f = u * u + v * v - 1;
  if (f < 0) return LAKE.level - 0.3 - 2.4 * Math.min(1, -f);
  const d = f / Math.hypot(2 * u / (LAKE.ax * w), 2 * v / (LAKE.az * w)), r = Math.sqrt(f + 1); // ~distance outside the shore
  return LAKE.level - 0.3 + d * lerp(0.5, 0.08, smooth(0.1, -0.7, u / r));
}

// ---------------------------------------------------------------- road frame queries
const _a = new V3(), _b = new V3();
// continuous position along the loop: s in metres (any value), lateral offset (+ seaward)
export function roadFrame(s, lat = 0, out = { p: new V3(), t: new V3(), n: new V3(), k: 0, f: 0, zone: '' }) {
  s = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const fi = s / LOOP_LEN * N, i = Math.floor(fi) % N, j = (i + 1) % N, u = fi - Math.floor(fi);
  const A = ROAD[i], B = ROAD[j];
  const f = s / LOOP_LEN;
  out.t.set(lerp(A.tx, B.tx, u), 0, lerp(A.tz, B.tz, u)).normalize();
  out.n.set(lerp(A.nx, B.nx, u), 0, lerp(A.nz, B.nz, u)).normalize();
  out.p.set(lerp(A.x, B.x, u), roadHeight(f), lerp(A.z, B.z, u)).addScaledVector(out.n, lat);
  out.k = lerp(A.k, B.k, u); out.f = f; out.zone = zoneAt(f);
  return out;
}
export function roadHeightAt(s) { return roadHeight(((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN / LOOP_LEN); }
// Road and boardwalk-deck ribbons: half-width, lift above the road line, camber (drop at the edge).
// surfaceAt() is the top of the ribbon the ribbons are built from, so it's what the tyres touch.
const ROAD_HW = ROAD_W / 2 + 1.2, DECK_HW = ROAD_W / 2 + 1.6, ROAD_LIFT = 0.02, DECK_LIFT = 0.06, CAMBER = 0.06;
const DECK_I = [Math.round(STRETCH.boardwalk[0] * N), Math.round(STRETCH.boardwalk[1] * N)];
// the deck's extra lift ramps in over its first and last 3 rows, so there's no lip where it meets the road
const deckLift = (fi) => ROAD_LIFT + (DECK_LIFT - ROAD_LIFT) * clamp(Math.min(fi - DECK_I[0], DECK_I[1] - fi) / 3, 0, 1);
export function surfaceAt(s, lat) {
  const f = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN / LOOP_LEN, deck = f * N >= DECK_I[0] && f * N <= DECK_I[1], hw = deck ? DECK_HW : ROAD_HW;
  // ponytail: flat top only (|lat| <= 2/3 of the half-width); the rider's lanes stop well inside it
  return roadHeight(f) + (deck ? deckLift(f * N) : ROAD_LIFT) - Math.min(Math.abs(lat), hw * 2 / 3) / (2 * hw) * CAMBER;
}

// ---------------------------------------------------------------- textures
function asphaltTex() {
  // across (u) 0..1 covers the full ribbon incl. gravel shoulders; along (v) repeats every 24 m
  const W = 256, H = 1024, c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data, R = rng(4);
  const edge = 1.2 / (ROAD_W + 2.4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, i = (y * W + x) * 4;
    const n = tfbm(x / 6, y / 6, 1e6, 3), grain = R();
    let r, gg, b;
    if (u < edge || u > 1 - edge) { const k = 0.6 + 0.4 * grain; r = 150 * k; gg = 136 * k; b = 112 * k; } // gravel
    else { const k = 0.72 + 0.2 * n + (grain > 0.97 ? 0.35 : 0); r = 78 * k; gg = 78 * k; b = 82 * k; }
    // edge lines (solid white), centre line (dashed, warm white): 3 m dash, 5 m gap
    const lane = (u - edge) / (1 - 2 * edge);
    const vy = y / H * 24;
    if (Math.abs(lane - 0.03) < 0.012 || Math.abs(lane - 0.97) < 0.012) { r = gg = b = 214 * (0.85 + 0.15 * grain); }
    if (Math.abs(lane - 0.5) < 0.011 && (vy % 8) < 3) { r = 226 * (0.85 + 0.15 * grain); gg = 208 * (0.85 + 0.15 * grain); b = 150 * (0.85 + 0.15 * grain); }
    // tyre polish & patches
    if (Math.abs(lane - 0.25) < 0.05 || Math.abs(lane - 0.75) < 0.05) { r *= 0.93; gg *= 0.93; b *= 0.95; }
    d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO; return t;
}
function planksTex() {
  // planks run across the deck; v repeats every 4 m
  const W = 256, H = 512, c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data, hts = new Float32Array(W * H), R = rng(8);
  const PL = 16; const tone = []; for (let i = 0; i < 64; i++) tone.push(0.75 + R() * 0.3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = Math.floor(y / PL), fy = (y % PL) / PL, seam = fy < 0.08 ? 1 : 0;
    const off = (p * 37) % W, endSeam = ((x + off) % 128) < 2 ? 1 : 0;
    const grain = 0.5 + 0.5 * Math.sin((x + off) * 0.08 + Math.sin(y * 0.9 + p) * 2 + tfbm(x / 20, y / 4, 1e6, 2) * 6);
    const k = tone[p % 64] * (0.85 + 0.15 * grain) * (seam || endSeam ? 0.35 : 1);
    const i = (y * W + x) * 4; d[i] = 150 * k; d[i + 1] = 112 * k; d[i + 2] = 78 * k; d[i + 3] = 255;
    hts[y * W + x] = seam || endSeam ? 0 : 0.8 + grain * 0.1;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO;
  return { map: t, normal: normalFromHeight(hts, W, H, 3) };
}
function cobbleTex() {
  const W = 256, H = 256, c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data, hts = new Float32Array(W * H), R = rng(12);
  const S = 16, cells = [];
  for (let j = 0; j < H / S; j++) for (let i = 0; i < W / S; i++) cells.push([(i + 0.5 + (j & 1) * 0.5) * S + (R() - 0.5) * 3, (j + 0.5) * S + (R() - 0.5) * 3, 0.7 + R() * 0.35, R()]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let b1 = 1e9, b2 = 1e9, bc = null;
    for (const cl of cells) { let dx = Math.abs(x - cl[0]); dx = Math.min(dx, W - dx); let dy = Math.abs(y - cl[1]); dy = Math.min(dy, H - dy); const q = dx * dx * 0.8 + dy * dy; if (q < b1) { b2 = b1; b1 = q; bc = cl; } else if (q < b2) b2 = q; }
    const edge = Math.sqrt(b2) - Math.sqrt(b1);
    const h = smooth(0, 4, edge);
    const i = (y * W + x) * 4, k = bc[2] * (0.4 + 0.6 * h);
    d[i] = 168 * k * (0.95 + bc[3] * 0.1); d[i + 1] = 158 * k; d[i + 2] = 142 * k * (1.05 - bc[3] * 0.1); d[i + 3] = 255;
    hts[y * W + x] = h;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO;
  return { map: t, normal: normalFromHeight(hts, W, H, 2.5) };
}
function detailTex() {
  const Nn = 256, hts = new Float32Array(Nn * Nn), d = new Uint8Array(Nn * Nn * 4);
  for (let y = 0; y < Nn; y++) for (let x = 0; x < Nn; x++) {
    const v = tfbm(x / 16, y / 16, Nn / 16, 5), ripple = 0.5 + 0.5 * Math.sin((x + tfbm(x / 32, y / 32, 8, 2) * 40) / Nn * TAU * 12);
    hts[y * Nn + x] = v * 0.7 + ripple * 0.3;
    const k = 200 + v * 55, i = (y * Nn + x) * 4; d[i] = d[i + 1] = d[i + 2] = k; d[i + 3] = 255;
  }
  return { map: dataTex(d, Nn, Nn, { srgb: true }), normal: normalFromHeight(hts, Nn, Nn, 2) };
}
// whitewashed wall with windows, blue shutters and a door; plus a matching emissive map for night
function facadeTex() {
  const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d'), ce = canvas(W, H), ge = ce.getContext('2d'), R = rng(21);
  g.fillStyle = '#f2eee6'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${170 + R() * 60},${160 + R() * 60},${150 + R() * 50},${0.04 + R() * 0.05})`; g.fillRect(R() * W, R() * H, 2 + R() * 18, 2 + R() * 14); }
  const grd = g.createLinearGradient(0, H - 60, 0, H); grd.addColorStop(0, 'rgba(120,110,100,0)'); grd.addColorStop(1, 'rgba(120,110,100,0.35)'); g.fillStyle = grd; g.fillRect(0, H - 60, W, 60);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  // a 4x4 grid of window slots (each slot 128 px = 2 m of wall)
  const shutters = ['#2f6ea8', '#3a8a8c', '#2c5d92', '#6f8f3d', '#b5533b'];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const x = i * 128 + 40, y = j * 128 + 30, w = 48, h = 64;
    if (j === 3 && i === 1) { // door
      g.fillStyle = shutters[(i + j) % shutters.length]; g.fillRect(x - 4, y + 4, w + 8, 94); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 4, y + 4, w + 8, 4);
      ge.fillStyle = 'rgba(255,190,110,0.25)'; ge.fillRect(x + 6, y + 10, w - 12, 14); continue;
    }
    g.fillStyle = '#d8d0c4'; g.fillRect(x - 5, y - 5, w + 10, h + 10);
    g.fillStyle = '#23272e'; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(160,190,210,0.35)'; g.fillRect(x + 3, y + 3, w / 2 - 5, h - 6);
    g.fillStyle = '#e8e2d8'; g.fillRect(x + w / 2 - 1.5, y, 3, h); g.fillRect(x, y + h / 2 - 1.5, w, 3);
    const col = shutters[Math.floor(R() * shutters.length)];
    if (R() < 0.8) { g.fillStyle = col; g.fillRect(x - 22, y - 2, 18, h + 4); g.fillRect(x + w + 4, y - 2, 18, h + 4); g.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 0; k < 8; k++) { g.fillRect(x - 22, y + k * 8 + 2, 18, 2); g.fillRect(x + w + 4, y + k * 8 + 2, 18, 2); } }
    if (R() < 0.3) { g.fillStyle = '#b84a3a'; g.fillRect(x - 8, y + h + 4, w + 16, 8); g.fillStyle = '#3f8a3a'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x - 4 + k * 11, y + h + 2, 5, 0, TAU); g.fill(); } g.fillStyle = '#e04a7a'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + 2 + k * 11, y + h, 2.2, 0, TAU); g.fill(); } }
    if (R() < 0.55) { const warm = R() < 0.8; ge.fillStyle = warm ? `rgb(255,${170 + R() * 40},${90 + R() * 40})` : 'rgb(170,200,255)'; ge.fillRect(x + 2, y + 2, w - 4, h - 4); ge.fillStyle = '#000'; ge.fillRect(x + w / 2 - 1.5, y, 3, h); ge.fillRect(x, y + h / 2 - 1.5, w, 3); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO;
  const e = new THREE.CanvasTexture(ce); e.colorSpace = THREE.SRGBColorSpace; e.wrapS = e.wrapT = THREE.RepeatWrapping;
  return { map: t, emissive: e };
}
function roofTex() {
  const W = 256, H = 256, c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data, hts = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const row = Math.floor(y / 32), fy = (y % 32) / 32, off = (row & 1) * 16, fx = ((x + off) % 32) / 32;
    const barrel = Math.sin(fx * Math.PI), h = barrel * (0.6 + 0.4 * fy);
    const tone = 0.8 + 0.2 * tfbm((x + row * 50) / 12, row, 1e6, 2);
    const i = (y * W + x) * 4, k = tone * (0.55 + 0.45 * barrel) * (fy > 0.9 ? 0.6 : 1);
    d[i] = 190 * k; d[i + 1] = 92 * k; d[i + 2] = 58 * k; d[i + 3] = 255; hts[y * W + x] = h;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO;
  return { map: t, normal: normalFromHeight(hts, W, H, 3) };
}
function stripeTex(colors, bands) {
  const c = canvas(8, 256), g = c.getContext('2d');
  for (let i = 0; i < bands; i++) { g.fillStyle = colors[i % colors.length]; g.fillRect(0, i * 256 / bands, 8, 256 / bands + 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function barkTex() {
  const W = 64, H = 256, hts = new Float32Array(W * H), d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = tfbm(x / 4, y / 16, W / 4, 4), plate = Math.abs(Math.sin(x / W * TAU * 5 + tfbm(x / 8, y / 32, 8, 2) * 3));
    hts[y * W + x] = v * 0.5 + plate * 0.5; const k = 0.5 + 0.5 * plate, i = (y * W + x) * 4;
    d[i] = 110 * k; d[i + 1] = 80 * k; d[i + 2] = 62 * k; d[i + 3] = 255;
  }
  return { map: dataTex(d, W, H, { srgb: true }), normal: normalFromHeight(hts, W, H, 2.5) };
}
function foliageTex(hue) {
  // needle/leaf clusters on transparent ground for canopy cards
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = rng(hue.length * 7);
  for (let i = 0; i < 520; i++) {
    const a = R() * TAU, r = Math.sqrt(R()) * S * 0.44, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.8;
    const l = 30 + R() * 30; g.strokeStyle = hue[Math.floor(R() * hue.length)]; g.lineWidth = 2 + R() * 3;
    const b = R() * TAU; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l * 0.4, y + Math.sin(b) * l * 0.4); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; return t;
}
function grassTex() {
  // a soft tuft of blades: dense and dark at the root, thin straw tips, alpha fading at the base
  const W = 128, H = 128, c = canvas(W, H), g = c.getContext('2d'), R = rng(99);
  for (let i = 0; i < 90; i++) {
    const x = W / 2 + (R() - 0.5) * W * 0.55, h = H * (0.35 + R() * 0.62), bend = (R() - 0.5) * 50;
    const cg = g.createLinearGradient(0, H, 0, H - h);
    const tip = R() < 0.55 ? '#d9cf8f' : R() < 0.5 ? '#b9b766' : '#8fa24c';
    cg.addColorStop(0, 'rgba(60,80,36,0)'); cg.addColorStop(0.12, '#56703a'); cg.addColorStop(1, tip);
    g.strokeStyle = cg; g.lineWidth = 1 + R() * 1.6; g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + bend * 0.25, H - h * 0.6, x + bend, H - h); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// wind sway for instanced vegetation: displaces by height above the instance origin
function addSway(mat, amp, uni) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime; sh.uniforms.uWind = uni.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
        float ph = dot(ip, vec3(0.13, 0.0, 0.17));
        float hgt = max(0.0, position.y);
        transformed.x += sin(uTime * 1.7 + ph) * ${amp.toFixed(3)} * hgt * hgt * uWind;
        transformed.z += cos(uTime * 1.3 + ph * 1.3) * ${amp.toFixed(3)} * 0.6 * hgt * hgt * uWind;
      #endif`);
  };
}

// ---------------------------------------------------------------- the world
export class World {
  constructor() {
    this.group = new THREE.Group(); this.group.name = 'world'; scene.add(this.group);
    this.uni = { uTime: { value: 0 }, uWind: { value: 1 } };
    this.night = 0; this.lamps = []; this.nightMats = [];
    const t0 = performance.now();
    this.buildTerrain();
    // everything stands on the ground as it was before the lake was carved, so every prop outside the lake keeps its
    // exact place; then sinkProps removes the few now under water and sets those on its banks down onto the new ground
    const carved = this.H; this.H = this.H0;
    this.buildRoad();
    this.buildBoardwalk();
    this.buildTown();
    this.buildLighthouse();
    this.buildVegetation();
    this.buildRocks();
    this.buildBeach();
    this.buildLamps();
    this.H = carved; this.sinkProps();
    this.buildBackdrop();
    this.buildTime = performance.now() - t0;
  }

  // ------------------------------------------------------------ terrain
  buildTerrain() {
    const n = TG, step = EXT * 2 / (n - 1);
    const H = this.H = new Float32Array(n * n), D = new Float32Array(n * n), F = new Float32Array(n * n);
    let hint = -1;
    for (let j = 0; j < n; j++) {
      for (let i0 = 0; i0 < n; i0++) {
        const i = (j & 1) ? n - 1 - i0 : i0; // serpentine keeps the nearest-road hint valid
        const x = -EXT + i * step, z = -EXT + j * step;
        const r = roadDist(x, z, hint); hint = r.i;
        const f = r.i / N;
        H[j * n + i] = terrainAt(x, z, r.d, f); D[j * n + i] = r.d; F[j * n + i] = f;
      }
    }
    this.step = step;
    // a 3 m cell that straddles the road edge can rise through the flat top of the ribbon (dirt over the
    // asphalt, and tyres that seem to sink into it): lower the corners of any such cell to just under it.
    // Lowering only ever lowers, so one pass settles it.
    const rf = { p: new V3(), t: new V3(), n: new V3(), k: 0, f: 0, zone: '' };
    for (let s = 0; s < LOOP_LEN; s += 0.5) for (let l = -3.3; l <= 3.3; l += 0.3) {
      const p = roadFrame(s, l, rf).p, y = surfaceAt(s, l) - 0.03;
      if (this.heightAt(p.x, p.z) <= y) continue;
      const i = Math.floor((p.x + EXT) / step), j = Math.floor((p.z + EXT) / step);
      for (const k of [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1]) H[k] = Math.min(H[k], y);
    }
    // carve the lake's basin (kept clear of the road and the palms along it)
    this.H0 = H.slice();
    for (let k = 0; k < n * n; k++) {
      const w = smooth(-(ROAD_W / 2 + 4.5), -(ROAD_W / 2 + 8), D[k]); if (w <= 0) continue;
      const b = lakeBed(-EXT + (k % n) * step, -EXT + Math.floor(k / n) * step); if (b < H[k]) H[k] = lerp(H[k], b, w);
    }
    const g = new THREE.PlaneGeometry(EXT * 2, EXT * 2, n - 1, n - 1).rotateX(-Math.PI / 2);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(), silt = new THREE.Color(0xb4ad9c);
    for (let k = 0; k < pos.count; k++) pos.setY(k, H[k]);
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    const sand = new THREE.Color(0xc9b187), wet = new THREE.Color(0xa99470), grass = new THREE.Color(0x6f8a3f), dry = new THREE.Color(0xa59a5c),
      rock = new THREE.Color(0x8a8278), dirt = new THREE.Color(0x9a8062), sea = new THREE.Color(0x8c7a5a), dark = new THREE.Color(0x4f6a2e);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k), h = H[k], d = D[k], slope = 1 - nrm.getY(k);
      const nn = fbm2(x * 0.03, z * 0.03, 3), n2 = fbm2(x * 0.15 + 3, z * 0.15, 2);
      if (d > ROAD_W / 2 + 1.5 && h < roadHeight(F[k]) - 0.2) {
        c.copy(sand).lerp(wet, smooth(0.8, 0.05, h)); if (h < 0) c.copy(sea);
      } else {
        c.copy(grass).lerp(dry, clamp(nn * 1.4 - 0.2, 0, 1)).lerp(dark, clamp(n2 - 0.45, 0, 1) * 1.2);
        if (Math.abs(d) < ROAD_W / 2 + 2.5) c.lerp(dirt, 0.7);
        if (zoneAt(F[k]) === 'beach' || zoneAt(F[k]) === 'south') c.lerp(sand, clamp((d + 20) / 20, 0, 1) * 0.7);
      }
      c.lerp(rock, smooth(0.22, 0.45, slope));
      if (this.H0[k] - h > 0.05) c.lerp(silt, smooth(LAKE.level + 0.7, LAKE.level + 0.1, h)); // a pale glacial-silt shore
      c.multiplyScalar(0.9 + n2 * 0.2);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // the sea is opaque: triangles entirely below -1 m can never be seen
    { const src = g.index.array, keep = []; for (let i = 0; i < src.length; i += 3) { const a = src[i], b = src[i + 1], c = src[i + 2]; if (H[a] > -1 || H[b] > -1 || H[c] > -1) keep.push(a, b, c); } g.setIndex(keep); }
    const det = detailTex(); det.map.repeat.set(220, 220); det.normal.repeat.set(220, 220);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: det.map, normalMap: det.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 });
    // the swash zone: sand the waves have just left is darker and glossy (per pixel, so the band is soft)
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat wet = smoothstep(0.45, 0.03, vWY);\ndiffuseColor.rgb *= 1.0 - 0.38 * wet;') // ocean.js WET matches the result
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, wet);');
    };
    const m = mesh(g, mat, false, true); m.name = 'terrain'; this.group.add(m); this.terrain = m;
    // the exact height grid for the ocean shader: it rebuilds the mesh's own triangles (see heightAt), so the
    // sea knows its true depth right up to the waterline
    this.hTex = new THREE.DataTexture(H, n, n, THREE.RedFormat, THREE.FloatType); this.hTex.needsUpdate = true;
  }
  heightAt(x, z, H = this.H) {
    const n = TG, fx = (x + EXT) / this.step, fz = (z + EXT) / this.step;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return -16;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    // PlaneGeometry triangles split along the (i+1,j)-(i,j+1) diagonal
    const h00 = H[j * n + i], h10 = H[j * n + i + 1], h01 = H[(j + 1) * n + i], h11 = H[(j + 1) * n + i + 1];
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  // ------------------------------------------------------------ road ribbons
  ribbon(i0, i1, halfW, mat, vScale, skirt = 0.6, lift = 0.02) {
    const pos = [], uv = [], idx = [], cols = 7;
    let rows = 0;
    for (let k = i0; k <= i1; k++) {
      const p = ROAD[((k % N) + N) % N], f = (((k % N) + N) % N) / N, h = roadHeight(f) + (typeof lift === 'function' ? lift(k) : lift);
      for (let c = 0; c < cols; c++) {
        let u = c / (cols - 1), l = (u - 0.5) * 2 * halfW, y = h - Math.abs(u - 0.5) * CAMBER; // gentle camber
        if (c === 0 || c === cols - 1) { l = Math.sign(u - 0.5) * (halfW + 0.05); y = h - skirt; u = c === 0 ? 0 : 1; }
        pos.push(p.x + p.nx * l, y, p.z + p.nz * l); uv.push(clamp(u, 0, 1), k * vScale);
      }
      rows++;
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const a = r * cols + c, b = a + cols; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = mesh(g, mat, false, true); this.group.add(m); return m;
  }
  buildRoad() {
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.88 });
    const cob = cobbleTex(); const cobble = new THREE.MeshStandardMaterial({ map: cob.map, normalMap: cob.normal, roughness: 0.8 });
    cob.map.repeat.set(3, 1); cob.normal.repeat.set(3, 1);
    const pl = planksTex(); this.plankMat = new THREE.MeshStandardMaterial({ map: pl.map, normalMap: pl.normal, roughness: 0.78 });
    // ribbons per stretch
    const fi = (f) => Math.round(f * N);
    const bw = STRETCH.boardwalk, tw = STRETCH.town;
    this.ribbon(fi(bw[1]), fi(tw[0]), ROAD_HW, cobble, 1 / 4, 0.6, ROAD_LIFT);
    this.ribbon(fi(tw[0]), fi(tw[1]), ROAD_HW, cobble, 1 / 4, 0.6, ROAD_LIFT);
    this.ribbon(fi(tw[1]), N + fi(bw[0]), ROAD_HW, asphalt, 1 / 24, 0.6, ROAD_LIFT);
  }

  // ------------------------------------------------------------ boardwalk
  buildBoardwalk() {
    const [a, b] = STRETCH.boardwalk, i0 = Math.round(a * N), i1 = Math.round(b * N);
    const deck = this.ribbon(i0, i1, DECK_HW, this.plankMat, 1 / 4, 0.35, deckLift);
    deck.name = 'boardwalk';
    const wood = new THREE.MeshStandardMaterial({ color: 0x6e5238, roughness: 0.85 });
    const rail = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 });
    const posts = [], rails = [];
    const postG = new THREE.CylinderGeometry(0.13, 0.15, 1, 8);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let k = i0; k <= i1; k += 3) {
      const p = ROAD[k], h = roadHeight(k / N);
      for (const l of [-(ROAD_W / 2 + 1.3), 0, ROAD_W / 2 + 1.3]) {
        const x = p.x + p.nx * l, z = p.z + p.nz * l, g = this.heightAt(x, z) - 1, len = h - g;
        if (len > 0.2) posts.push(m4.clone().compose(new V3(x, g + len / 2, z), q, new V3(1, len, 1)));
      }
    }
    // seaward railing: white posts every 2 m + two rails
    const railPts = [], railPts2 = [];
    for (let k = i0; k <= i1; k += 2) {
      const p = ROAD[k], h = roadHeight(k / N) + 0.06, l = ROAD_W / 2 + 1.45;
      const x = p.x + p.nx * l, z = p.z + p.nz * l;
      rails.push(m4.clone().compose(new V3(x, h + 0.55, z), q, new V3(0.5, 1.1, 0.5)));
      railPts.push(new V3(x, h + 1.08, z)); railPts2.push(new V3(x, h + 0.6, z));
    }
    const pi = new THREE.InstancedMesh(postG, wood, posts.length); posts.forEach((m, i) => pi.setMatrixAt(i, m)); pi.castShadow = true; pi.receiveShadow = true; this.group.add(pi);
    const ri = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12), rail, rails.length); rails.forEach((m, i) => ri.setMatrixAt(i, m)); ri.castShadow = true; this.group.add(ri);
    for (const pts of [railPts, railPts2]) this.group.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.05, 6), rail));
    // benches facing the sea
    const benchG = mergeGeometries([new THREE.BoxGeometry(1.6, 0.06, 0.45).translate(0, 0.45, 0), new THREE.BoxGeometry(1.6, 0.4, 0.06).translate(0, 0.7, -0.2), new THREE.BoxGeometry(0.08, 0.45, 0.4).translate(-0.7, 0.22, 0), new THREE.BoxGeometry(0.08, 0.45, 0.4).translate(0.7, 0.22, 0)]);
    const benches = new THREE.InstancedMesh(benchG, wood, 8);
    for (let k = 0; k < 8; k++) {
      const s = i0 + Math.round((k + 0.5) / 8 * (i1 - i0)), p = ROAD[s], l = ROAD_W / 2 + 0.9, h = roadHeight(s / N) + 0.06;
      q.setFromAxisAngle(new V3(0, 1, 0), Math.atan2(p.nx, p.nz) + Math.PI);
      benches.setMatrixAt(k, m4.clone().compose(new V3(p.x + p.nx * l, h, p.z + p.nz * l), q, new V3(1, 1, 1)));
    }
    benches.castShadow = true; this.group.add(benches);
  }

  // ------------------------------------------------------------ town, harbour, chapel
  buildTown() {
    const fac = facadeTex(), roof = roofTex();
    const wallMat = new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.9, vertexColors: true });
    const roofMat = new THREE.MeshStandardMaterial({ map: roof.map, normalMap: roof.normal, roughness: 0.75 });
    this.nightMats.push({ m: wallMat, k: 1.0 }); // lit windows: warm, not blown (night exposure is ~3-4.5x)
    const walls = [], roofs = [], R = rng(31);
    const tints = [0xffffff, 0xfff6e6, 0xf6efe2, 0xe8f0f6, 0xfdf0dc, 0xf9e7d6];
    const [a, b] = STRETCH.town, i0 = Math.round(a * N), i1 = Math.round(b * N);
    const one = new V3(1, 1, 1);
    const addHouse = (x, z, rot, w, d, floors, flat) => {
      const q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), rot);
      // sit on the lowest corner so nothing floats on a slope
      let gy = 1e9;
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const c = new V3(cx * w / 2, 0, cz * d / 2).applyQuaternion(q); gy = Math.min(gy, this.heightAt(x + c.x, z + c.z)); }
      gy -= 0.4;
      const h = floors * 3 + 0.4, H = h + 0.6;
      const box = new THREE.BoxGeometry(w, H, d);
      // uv: one texture repeat = 8 m of wall across and 4 floors (12 m) up
      const uv = box.attributes.uv, p = box.attributes.position, nn = box.attributes.normal;
      const ox = Math.floor(R() * 4) * 0.25;
      for (let k = 0; k < uv.count; k++) {
        const ax = Math.abs(nn.getX(k)) > 0.5 ? p.getZ(k) : p.getX(k);
        uv.setXY(k, ax / 8 + ox, (p.getY(k) + H / 2 - 0.2) / 12);
        if (Math.abs(nn.getY(k)) > 0.5) uv.setXY(k, 0.02, 0.98);
      }
      const tint = new THREE.Color(tints[Math.floor(R() * tints.length)]), cc = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) { cc[k * 3] = tint.r; cc[k * 3 + 1] = tint.g; cc[k * 3 + 2] = tint.b; }
      box.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      walls.push(box.applyMatrix4(new THREE.Matrix4().compose(new V3(x, gy + H / 2, z), q, one)));
      if (!flat) {
        // hipped terracotta roof: a square pyramid stretched over the footprint
        const rh = 1.4 + R() * 0.6;
        const r = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(w * 1.12, rh, d * 1.12).translate(0, gy + H + rh / 2 - 0.05, 0);
        const rp = r.attributes.position, ruv = r.attributes.uv;
        for (let k = 0; k < ruv.count; k++) ruv.setXY(k, (rp.getX(k) + rp.getZ(k)) / 3, rp.getY(k) / 1.4);
        roofs.push(r.applyMatrix4(new THREE.Matrix4().compose(new V3(x, 0, z), q, one)));
      } else {
        // flat roof with a parapet (cycladic)
        const pr = new THREE.BoxGeometry(w + 0.2, 0.35, d + 0.2); pr.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pr.attributes.position.count * 3).fill(1), 3));
        const puv = pr.attributes.uv; for (let k = 0; k < puv.count; k++) puv.setXY(k, 0.02, 0.98);
        walls.push(pr.applyMatrix4(new THREE.Matrix4().compose(new V3(x, gy + H + 0.1, z), q, one)));
      }
    };
    // houses along the inland side of the town road, two or three rows up the slope
    for (let k = i0 + 6; k < i1 - 6; k += 9 + Math.floor(R() * 5)) {
      const p = ROAD[k], rot = Math.atan2(p.tx, p.tz);
      for (let row = 0; row < 3; row++) {
        if (R() < 0.18 * row) continue;
        const w = 6 + R() * 4, d = 6 + R() * 3, off = ROAD_W / 2 + 4 + d / 2 + row * 13 + R() * 3;
        const x = p.x - p.nx * off + p.tx * (R() - 0.5) * 3, z = p.z - p.nz * off + p.tz * (R() - 0.5) * 3;
        addHouse(x, z, rot, w, d, 1 + Math.floor(R() * 2.4), R() < 0.4);
      }
    }
    // a few cottages up the island and near the beach huts
    for (let k = 0; k < 10; k++) {
      const s = Math.floor(R() * N), p = ROAD[s], z0 = zoneAt(s / N);
      if (z0 === 'town' || z0 === 'boardwalk' || z0 === 'lighthouse') continue;
      const off = ROAD_W / 2 + 14 + R() * 30, x = p.x - p.nx * off, z = p.z - p.nz * off;
      addHouse(x, z, Math.atan2(p.tx, p.tz) + (R() - 0.5) * 0.4, 5 + R() * 3, 5 + R() * 2, 1, R() < 0.5);
    }
    this.group.add(mesh(mergeGeometries(walls.map((g) => g.index ? g.toNonIndexed() : g)), wallMat));
    this.group.add(mesh(mergeGeometries(roofs.map((g) => { g = g.index ? g.toNonIndexed() : g; if (g.attributes.color) g.deleteAttribute('color'); return g; })), roofMat));
    // chapel: whitewashed nave, blue dome, small bell tower
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.85 });
    const blue = new THREE.MeshPhysicalMaterial({ color: 0x1f5fb3, roughness: 0.35, clearcoat: 0.6 });
    const ch = new THREE.Group(); const gy = this.heightAt(CHAPEL.x, CHAPEL.z);
    ch.position.set(CHAPEL.x, gy - 0.5, CHAPEL.z); ch.rotation.y = 0.3; this.group.add(ch);
    ch.add(mesh(new THREE.BoxGeometry(8, 6, 12).translate(0, 3, 0), white));
    ch.add(mesh(new THREE.CylinderGeometry(3.2, 3.4, 1.4, 24).translate(0, 6.7, 1), white));
    ch.add(mesh(new THREE.SphereGeometry(3.2, 28, 14, 0, TAU, 0, Math.PI / 2).translate(0, 7.4, 1), blue));
    ch.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6).translate(0, 11.4, 1), white));
    ch.add(mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12).translate(0, 11.7, 1), white));
    ch.add(mesh(new THREE.BoxGeometry(3, 9, 3).translate(0, 4.5, -7), white));
    ch.add(mesh(new THREE.SphereGeometry(1.5, 16, 8, 0, TAU, 0, Math.PI / 2).translate(0, 9, -7), blue));
    const bell = mesh(new THREE.CylinderGeometry(0.3, 0.55, 0.7, 12, 1, true).translate(0, 7.8, -7), new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1, roughness: 0.35, side: THREE.DoubleSide })); ch.add(bell);
    bakeStatic(ch);
    // harbour quay: a stone wall from the road edge down into the water
    {
      const stone = (() => { const c = canvas(256, 128), g = c.getContext('2d'); g.fillStyle = '#9b9384'; g.fillRect(0, 0, 256, 128); for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) { const o = (y % 2) * 21; g.fillStyle = `hsl(${35 + R() * 10},${10 + R() * 8}%,${48 + R() * 16}%)`; g.fillRect(x * 43 + o + 1, y * 16 + 1, 41, 14); } g.fillStyle = 'rgba(40,60,50,0.35)'; g.fillRect(0, 100, 256, 28); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
      const qa = Math.round((STRETCH.town[0] + 0.012) * N), qb = Math.round((STRETCH.town[1] - 0.022) * N), pos = [], uv = [], idx = [];
      for (let k = qa; k <= qb; k++) {
        const p = ROAD[k], h = roadHeight(k / N), l = ROAD_W / 2 + 1.5 + 5.4;
        pos.push(p.x + p.nx * l, h - 0.1, p.z + p.nz * l, p.x + p.nx * (l + 0.3), -4, p.z + p.nz * (l + 0.3)); uv.push(k / 6, 1, k / 6, 0);
        if (k < qb) { const a0 = (k - qa) * 2; idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      this.group.add(mesh(g, new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9, side: THREE.DoubleSide }), false, true));
    }
    // harbour: quay bollards and fishing boats bobbing
    this.boats = [];
    const hullM = [0x2a6fb0, 0xd24a3a, 0x2f8f6a, 0xf2c14a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    const whiteHull = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 });
    for (let k = 0; k < 7; k++) {
      const s = i0 + Math.round((k + 0.5) / 7 * (i1 - i0)), p = ROAD[s], off = ROAD_W / 2 + 10 + (k % 2) * 6;
      const boat = new THREE.Group(); boat.position.set(p.x + p.nx * off, 0, p.z + p.nz * off); boat.rotation.y = Math.atan2(p.tx, p.tz) + (k % 2 ? 0.2 : -0.15);
      const hull = new THREE.SphereGeometry(1, 16, 8, 0, TAU, Math.PI / 2, Math.PI / 2); hull.scale(1.1, 0.8, 3.2);
      boat.add(mesh(hull, hullM[k % 4]));
      boat.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 16, 1).scale(1, 1, 2.9).translate(0, 0.04, 0), whiteHull));
      if (k % 2 === 0) boat.add(mesh(new THREE.BoxGeometry(1.2, 1, 1.4).translate(0, 0.6, -0.6), whiteHull));
      boat.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6).translate(0, 1.7, 0.6), whiteHull));
      bakeStatic(boat); this.group.add(boat); this.boats.push({ g: boat, ph: k * 1.7 });
    }
  }

  // ------------------------------------------------------------ lighthouse
  buildLighthouse() {
    const L = new THREE.Group(); const gy = this.heightAt(LIGHTHOUSE.x, LIGHTHOUSE.z);
    L.position.set(LIGHTHOUSE.x, gy - 0.3, LIGHTHOUSE.z); this.group.add(L); this.lighthouse = L;
    const H = LIGHTHOUSE.h;
    const prof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(lerp(3.2, 2.1, t) + (i === 0 ? 0.3 : 0), t * H)); }
    const tower = new THREE.LatheGeometry(prof, 40);
    const stripes = stripeTex(['#f5f2ec', '#c8262c'], 7); stripes.wrapS = THREE.RepeatWrapping;
    const tm = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 });
    L.add(mesh(tower, tm));
    const dark = new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.5, metalness: 0.6 });
    L.add(mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.35, 32).translate(0, H + 0.15, 0), dark));
    // gallery railing
    const rg = []; for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; rg.push(new THREE.CylinderGeometry(0.04, 0.04, 1, 5).translate(Math.cos(a) * 2.85, H + 0.8, Math.sin(a) * 2.85)); }
    rg.push(new THREE.TorusGeometry(2.85, 0.05, 6, 40).rotateX(Math.PI / 2).translate(0, H + 1.3, 0));
    L.add(mesh(mergeGeometries(rg), dark));
    // lantern room: glass + lamp + dome
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.05, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.35, emissive: 0xffe7b0, emissiveIntensity: 0, depthWrite: false });
    this.lantern = mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 20, 1, true).translate(0, H + 1.5, 0), glass, false); L.add(this.lantern);
    this.lamp = mesh(new THREE.SphereGeometry(0.55, 16, 10).translate(0, H + 1.5, 0), new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd68a, emissiveIntensity: 0 }), false); L.add(this.lamp);
    L.add(mesh(new THREE.CylinderGeometry(0.16, 0.32, 0.7, 16).translate(0, H + 0.675, 0), dark)); // pedestal: gallery floor up into the lamp
    L.add(mesh(new THREE.SphereGeometry(1.75, 20, 10, 0, TAU, 0, Math.PI / 2).translate(0, H + 2.7, 0), new THREE.MeshStandardMaterial({ color: 0xa3262a, roughness: 0.4, metalness: 0.3 })));
    L.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6).translate(0, H + 5, 0), dark));
    this.nightMats.push({ m: glass, k: 1.2 }, { m: this.lamp.material, k: 10 });
    // rotating beams (additive cones, faded along their length)
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform float uI; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = uI * pow(vY, 2.2) * edge * 0.55; gl_FragColor = vec4(vec3(1.0,0.9,0.7)*a, a); }',
    });
    this.beamMat = beamMat;
    this.beams = new THREE.Group(); this.beams.position.set(0, H + 1.5, 0); L.add(this.beams);
    for (const s of [1, -1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 9, 160, 24, 1, true).translate(0, -80, 0).rotateZ(s * Math.PI / 2), beamMat); c.frustumCulled = false; this.beams.add(c); }
    // keeper's cottage
    const cot = new THREE.Group(); cot.position.set(7, 0, 5); cot.rotation.y = 0.4; L.add(cot);
    cot.add(mesh(new THREE.BoxGeometry(6, 3.2, 5).translate(0, 1.6, 0), new THREE.MeshStandardMaterial({ color: 0xf3efe7, roughness: 0.9 })));
    cot.add(mesh(new THREE.ConeGeometry(4.3, 1.8, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.9).translate(0, 4.1, 0), new THREE.MeshStandardMaterial({ color: 0xa33a2a, roughness: 0.7 })));
    this.beacon = new THREE.PointLight(0xffd8a0, 0, 60, 1.5); this.beacon.position.set(0, H + 1.5, 0); L.add(this.beacon);
    bakeStatic(L, (o) => o === this.beams || o.isLight);
  }

  // ------------------------------------------------------------ vegetation
  buildVegetation() {
    const R = rng(55);
    const bark = barkTex(); bark.map.repeat.set(2, 3); bark.normal.repeat.set(2, 3);
    const barkM = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normal, roughness: 0.95 });
    // umbrella (stone) pine: leaning trunk + flat canopy clusters of foliage cards
    const pineT = foliageTex(['#2f4a22', '#3d5a2a', '#4a6a30', '#29401d']);
    const leafM = new THREE.MeshStandardMaterial({ map: pineT, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
    addSway(leafM, 0.004, this.uni);
    const trunk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(0, -0.5, 0), new V3(0.6, 3, 0.2), new V3(1.4, 6, 0.4), new V3(1.8, 8.2, 0.5)]), 12, 0.32, 8);
    const canopyCards = [];
    for (let i = 0; i < 26; i++) {
      const a = R() * TAU, r = Math.sqrt(R()) * 4.2, y = 8.3 + R() * 1.6 - r * 0.12;
      const card = new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2 + (R() - 0.5) * 0.5).rotateY(R() * TAU).translate(1.8 + Math.cos(a) * r, y, 0.5 + Math.sin(a) * r);
      canopyCards.push(card);
      if (i % 3 === 0) canopyCards.push(new THREE.PlaneGeometry(3, 2).rotateY(R() * TAU).translate(1.8 + Math.cos(a) * r * 0.8, y - 0.4, 0.5 + Math.sin(a) * r * 0.8));
    }
    const canopy = mergeGeometries(canopyCards);
    // cypress: tall narrow flame of cards
    const cypT = foliageTex(['#223a1e', '#2c4a24', '#1d321a']);
    const cypM = new THREE.MeshStandardMaterial({ map: cypT, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 }); addSway(cypM, 0.002, this.uni);
    const cypCards = []; for (let i = 0; i < 16; i++) { const y = 1 + i * 0.6, r = 1.1 * Math.sin(Math.min(1, (i + 2) / 16) * Math.PI) * (1 - i / 22); cypCards.push(new THREE.PlaneGeometry(r * 2.2 + 0.4, 1.6).rotateY(i * 2.1).translate(0, y, 0)); }
    const cyp = mergeGeometries(cypCards);
    // palm: curved trunk + fronds
    const frondT = (() => { const c = canvas(256, 64), g = c.getContext('2d'); g.strokeStyle = '#5a7a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 32); g.lineTo(256, 32); g.stroke(); for (let i = 0; i < 60; i++) { const x = 8 + i * 4, l = 28 * Math.sin((i / 60) * Math.PI) + 4; g.strokeStyle = i % 2 ? '#4f7426' : '#6a8f34'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 10, 32 - l); g.moveTo(x, 32); g.lineTo(x + 10, 32 + l); g.stroke(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const frondM = new THREE.MeshStandardMaterial({ map: frondT, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }); addSway(frondM, 0.006, this.uni);
    const palmTrunk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(0, -0.4, 0), new V3(0.3, 3, 0), new V3(1.1, 6, 0), new V3(2.0, 8.4, 0)]), 16, 0.22, 7);
    const fr = []; for (let i = 0; i < 11; i++) { const g = new THREE.PlaneGeometry(4.2, 1.1, 6, 1); const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k) + 2.1; p.setX(k, x); p.setY(k, p.getY(k) - 0.09 * x * x); p.setZ(k, p.getY(k) * 0); } g.rotateX(-Math.PI / 2 + 0.35).rotateY(i / 11 * TAU + (i % 2) * 0.2).translate(2.0, 8.5, 0); fr.push(g); }
    const fronds = mergeGeometries(fr);
    // placement
    const pines = [], cyps = [], palms = [];
    const m4 = () => new THREE.Matrix4();
    const place = (arr, x, z, s, ry) => { const y = this.heightAt(x, z); if (y < 1.5) return false; arr.push(m4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), ry), new V3(s, s * (0.9 + R() * 0.2), s))); return true; };
    for (let k = 0; k < 900 && pines.length < 70; k++) {
      const s = Math.floor(R() * N), p = ROAD[s], zn = zoneAt(s / N);
      const wantPine = zn === 'pines' || zn === 'cliffs' || zn === 'climb' || (zn === 'south' && R() < 0.4) || R() < 0.08;
      if (!wantPine) continue;
      const off = ROAD_W / 2 + 7 + R() * 60, x = p.x - p.nx * off, z = p.z - p.nz * off;
      place(pines, x, z, 0.8 + R() * 0.5, R() * TAU);
    }
    // pine woods on the hillsides, patchy by noise
    for (let k = 0; k < 2400 && pines.length < 230; k++) {
      const x = (R() - 0.5) * 560, z = (R() - 0.5) * 560, r = roadDist(x, z, -1);
      if (r.d > -30 || fbm2(x * 0.012 + 40, z * 0.012, 3) < 0.52) continue;
      place(pines, x, z, 0.75 + R() * 0.6, R() * TAU);
    }
    // a few pines on the seaward side of the dunes (framing the road)
    for (let k = 0; k < 14; k++) { const s = Math.floor((STRETCH.pines[0] + R() * (STRETCH.pines[1] - STRETCH.pines[0])) * N), p = ROAD[s], off = ROAD_W / 2 + 6 + R() * 8; place(pines, p.x + p.nx * off, p.z + p.nz * off, 0.8 + R() * 0.4, R() * TAU); }
    for (let k = 0; k < 400 && cyps.length < 40; k++) {
      const s = Math.floor(R() * N), p = ROAD[s], zn = zoneAt(s / N);
      if (!(zn === 'town' || zn === 'climb' || R() < 0.05)) continue;
      const off = ROAD_W / 2 + 6 + R() * 45, x = p.x - p.nx * off, z = p.z - p.nz * off;
      place(cyps, x, z, 0.9 + R() * 0.6, R() * TAU);
    }
    // cypresses by the chapel
    for (let k = 0; k < 5; k++) place(cyps, CHAPEL.x + 8 + k * 3.2, CHAPEL.z + 10 + (k % 2) * 2, 1.1, 0);
    // palms line the boardwalk promenade and the beach road
    const [ba, bb] = STRETCH.boardwalk;
    for (let k = 0; k < 18; k++) { const f = lerp(STRETCH.beach[0] + 0.02, bb, k / 17), s = Math.floor(f * N), p = ROAD[s], off = -(ROAD_W / 2 + 3.2); place(palms, p.x + p.nx * off, p.z + p.nz * off, 0.9 + R() * 0.25, R() * TAU); }
    const inst = (geo, mat, arr, cast = true) => { const im = new THREE.InstancedMesh(geo, mat, arr.length); arr.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = cast; im.receiveShadow = true; this.group.add(im); return im; };
    this.noAO = [];
    inst(trunk, barkM, pines); this.noAO.push(inst(canopy, leafM, pines));
    inst(new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6).translate(0, 0.5, 0), barkM, cyps); this.noAO.push(inst(cyp, cypM, cyps));
    inst(palmTrunk, barkM, palms); this.noAO.push(inst(fronds, frondM, palms));
    this.treeCount = pines.length + cyps.length + palms.length;
    // grass tufts: inland verges and the dunes
    const gT = grassTex(); const gM = new THREE.MeshStandardMaterial({ map: gT, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.95 }); addSway(gM, 0.25, this.uni);
    const tuft = mergeGeometries([0, 1, 2, 3].map((i) => new THREE.PlaneGeometry(1.0, 0.75).translate(0, 0.36, 0).rotateX((i % 2 ? 1 : -1) * 0.18).rotateY(i * Math.PI / 4 + 0.3)));
    const tufts = [];
    for (let k = 0; k < 9000 && tufts.length < 2600; k++) {
      const s = Math.floor(R() * N), p = ROAD[s], zn = zoneAt(s / N);
      if (zn === 'town') continue;
      const side = R() < 0.72 ? -1 : 1, off = ROAD_W / 2 + 1.8 + Math.pow(R(), 1.6) * (side < 0 ? 40 : 18);
      const x = p.x + p.nx * off * side + (R() - 0.5) * 2, z = p.z + p.nz * off * side + (R() - 0.5) * 2, y = this.heightAt(x, z);
      if (y < 1.2 || (zn === 'boardwalk' && side > 0) || (side > 0 && R() < 0.5)) continue;
      tufts.push(new THREE.Matrix4().compose(new V3(x, y - 0.05, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), R() * TAU), new V3(0.8 + R() * 0.9, 0.6 + R() * 1.1, 0.8 + R() * 0.9)));
    }
    this.noAO.push(noReflect(inst(tuft, gM, tufts, false)));
  }

  buildRocks() {
    const R = rng(77);
    // weld the icosphere so displacement keeps it watertight and the normals come out smooth
    let g = new THREE.IcosahedronGeometry(1, 4); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const v = new V3().fromBufferAttribute(p, k), n = fbm2(v.x * 1.7 + 3, v.z * 1.7 + v.y, 4), c = fbm2(v.x * 5 + 9, v.z * 5 - v.y * 3, 2); v.multiplyScalar(0.72 + n * 0.62 + c * 0.08); v.y *= 0.7; p.setXYZ(k, v.x, v.y, v.z); }
    g.computeVertexNormals();
    { const uv = new Float32Array(p.count * 2); for (let k = 0; k < p.count; k++) { uv[k * 2] = p.getX(k) * 0.5 + p.getZ(k) * 0.3; uv[k * 2 + 1] = p.getY(k) * 0.5 + p.getZ(k) * 0.2; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
    // granular, lichen-speckled stone (no sand ripples)
    const Nn = 128, hts = new Float32Array(Nn * Nn), dd = new Uint8Array(Nn * Nn * 4);
    for (let y = 0; y < Nn; y++) for (let x = 0; x < Nn; x++) {
      const v = tfbm(x / 12, y / 12, Nn / 12, 5), cr = Math.abs(tfbm(x / 24 + 5, y / 24, Nn / 24, 3) - 0.5) < 0.03 ? 0.6 : 1, i = (y * Nn + x) * 4;
      hts[y * Nn + x] = v * cr; const k = (150 + v * 90) * cr, lich = tfbm(x / 6 + 11, y / 6, Nn / 6, 2) > 0.72;
      dd[i] = lich ? 170 : k; dd[i + 1] = lich ? 160 : k * 0.97; dd[i + 2] = lich ? 110 : k * 0.92; dd[i + 3] = 255;
    }
    const rmap = dataTex(dd, Nn, Nn, { srgb: true }), rnrm = normalFromHeight(hts, Nn, Nn, 2.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb0a89e, map: rmap, normalMap: rnrm, roughness: 0.92 });
    const arr = [];
    const put = (x, z, s) => { const y = this.heightAt(x, z); arr.push(new THREE.Matrix4().compose(new V3(x, y - s * 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 0.5, R() * TAU, R() * 0.5)), new V3(s * (1 + R() * 0.6), s, s * (1 + R() * 0.5)))); };
    for (let k = 0; k < 160; k++) {
      const s = Math.floor(R() * N), p = ROAD[s], zn = zoneAt(s / N);
      if (!(zn === 'cliffs' || zn === 'lighthouse' || zn === 'climb' || R() < 0.1)) continue;
      const off = ROAD_W / 2 + 4 + R() * 26; put(p.x + p.nx * off, p.z + p.nz * off, 0.6 + R() * 2.8);
    }
    for (let k = 0; k < 40; k++) { const a = R() * TAU, r = 18 + R() * 28; put(LIGHTHOUSE.x + Math.cos(a) * r, LIGHTHOUSE.z + Math.sin(a) * r, 1 + R() * 3); }
    const im = new THREE.InstancedMesh(g, mat, arr.length); arr.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; this.group.add(noReflect(im));
  }

  // colourful beach huts, parasols and a lifeguard tower on the west beach
  buildBeach() {
    const R = rng(88), [a, b] = STRETCH.beach, cols = [0xe8554e, 0x3fa7d6, 0xf2c14e, 0x6cc57c, 0xf28ab2, 0xffffff, 0x2f6fb5];
    const huts = new THREE.Group(); this.group.add(huts);
    const roofG = new THREE.ConeGeometry(1.45, 0.9, 4).rotateY(Math.PI / 4).scale(1, 1, 1.2);
    // weatherboard: pale vertical boards with dark gaps, multiplied by each hut's paint colour
    const plankTex = (() => { const c = canvas(128, 128), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + (i % 3) * 0.02})`; g.fillRect(i * 16, 0, 16, 128); g.fillStyle = 'rgba(40,30,20,0.45)'; g.fillRect(i * 16, 0, 1.5, 128); } g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 120, 128, 8); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const wallM = new THREE.MeshStandardMaterial({ vertexColors: true, map: plankTex, roughness: 0.75 });
    const plainM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    for (let k = 0; k < 14; k++) {
      const f = lerp(a + 0.05, b - 0.03, k / 13), s = Math.round(f * N), p = ROAD[s], off = ROAD_W / 2 + 7;
      const x = p.x + p.nx * off, z = p.z + p.nz * off, y = this.heightAt(x, z);
      const hut = new THREE.Group(); hut.position.set(x, y, z); hut.rotation.y = Math.atan2(p.nx, p.nz); huts.add(hut);
      const col = cols[k % cols.length];
      hut.add(mesh(tint(new THREE.BoxGeometry(2, 2.2, 2.4).translate(0, 1.1, 0), col), wallM));
      hut.add(mesh(tint(new THREE.BoxGeometry(0.9, 1.75, 0.06).translate(0, 0.9, 1.22), k % 3 ? 0xffffff : 0xf2d7a0), wallM));
      hut.add(mesh(tint(new THREE.BoxGeometry(2.3, 0.08, 0.5).translate(0, 0.04, 1.4), 0x9c7a55), plainM));
      hut.add(mesh(tint(roofG.clone().translate(0, 2.65, 0), k % 2 ? 0xf4efe6 : 0x3f4a56), plainM));
    }
    const stripe = (() => { const c = canvas(256, 16), g = c.getContext('2d'); for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f6f1e6' : ['#e04f4f', '#2f86c9', '#f0a830'][Math.floor(i / 2) % 3]; g.fillRect(i * 32, 0, 32, 16); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const umbM = new THREE.MeshStandardMaterial({ map: stripe, side: THREE.DoubleSide, roughness: 0.8 });
    const pole = new THREE.MeshStandardMaterial({ color: 0xf4f1ea });
    for (let k = 0; k < 16; k++) {
      const f = lerp(a + 0.03, b - 0.02, R()), s = Math.round(f * N), p = ROAD[s], off = ROAD_W / 2 + 13 + R() * 14;
      const x = p.x + p.nx * off, z = p.z + p.nz * off, y = this.heightAt(x, z); if (y < 0.4) continue;
      const u = new THREE.Group(); u.position.set(x, y, z); u.rotation.set((R() - 0.5) * 0.2, R() * TAU, (R() - 0.5) * 0.2); huts.add(u);
      u.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6).translate(0, 1.15, 0), pole));
      u.add(mesh(new THREE.ConeGeometry(1.3, 0.45, 8, 1, true).translate(0, 2.2, 0), umbM));
    }
    bakeStatic(huts);
  }

  // ------------------------------------------------------------ lamps (switch on at dusk)
  buildLamps() {
    const pts = [];
    const [ba, bb] = STRETCH.boardwalk, [ta, tb] = STRETCH.town;
    for (let f = ba + 0.004; f < bb; f += 18 / LOOP_LEN) pts.push([f, ROAD_W / 2 + 1.45]);
    for (let f = ta + 0.004; f < tb; f += 22 / LOOP_LEN) pts.push([f, -(ROAD_W / 2 + 1.1)]);
    for (let f = tb; f < STRETCH.lighthouse[1]; f += 45 / LOOP_LEN) pts.push([f, -(ROAD_W / 2 + 1.1)]);
    // one fixture in pole-local space (+z toward the road): pole -> crook arm from the pole top over to z = 0.7 ->
    // housing hung from the arm tip; the globe (below) sits in the housing's mouth at (0, HEAD_Y, 0.7)
    const HEAD_Y = 4.0;
    const poleG = mergeGeometries([
      new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8).translate(0, 2.1, 0),
      new THREE.TorusGeometry(0.35, 0.035, 6, 16, Math.PI).rotateY(-Math.PI / 2).translate(0, 4.2, 0.35),
      new THREE.CylinderGeometry(0.05, 0.25, 0.2, 16).translate(0, HEAD_Y + 0.1, 0.7),
    ]);
    const poleM = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.45, metalness: 0.7 });
    // a warm sodium/LED glow: bright enough to read as a lit lamp with a soft halo, not a blown white ball
    // (the night exposure is ~3-4.5x, so k is a display brightness of roughly 2-3)
    const globeM = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffb057, emissiveIntensity: 0, roughness: 0.2 });
    this.nightMats.push({ m: globeM, k: 1.3 });
    const poles = new THREE.InstancedMesh(poleG, poleM, pts.length), globes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 16, 10), globeM, pts.length);
    pts.forEach(([f, l], i) => {
      const s = Math.round(f * N) % N, p = ROAD[s], h = roadHeight(f) + (l > 0 ? 0.06 : 0);
      const x = p.x + p.nx * l, z = p.z + p.nz * l, y = l > 0 ? h : Math.max(h, this.heightAt(x, z));
      const side = Math.sign(l), rot = Math.atan2(-p.nx * side, -p.nz * side);
      poles.setMatrixAt(i, new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), rot), new V3(1, 1, 1)));
      const gp = new V3(x - p.nx * side * 0.7, y + HEAD_Y, z - p.nz * side * 0.7);
      globes.setMatrixAt(i, new THREE.Matrix4().makeTranslation(gp.x, gp.y, gp.z));
      this.lamps.push({ p: gp, s: f * LOOP_LEN, phase: hashf(i) });
    });
    poles.castShadow = true; this.group.add(poles, globes);
    // a pool of real lights handed to the lamps nearest the rider: cut-off street optics shine down, so they
    // pool on the road instead of flooding the walls beside them
    this.lampLights = [];
    for (let i = 0; i < 5; i++) { const l = new THREE.SpotLight(0xffc27a, 0, 18, 1.15, 0.6, 1.8); this.group.add(l, l.target); this.lampLights.push(l); }
  }

  // instanced props (trees, grass, rocks) where the lake's basin was carved: the ones now under water are removed, the
  // ones on its banks are set down onto the lowered ground where they stood
  sinkProps() {
    const m = new THREE.Matrix4(), p = new V3(), zero = new THREE.Matrix4().makeScale(0, 0, 0); this.sunkProps = 0; this.movedProps = 0;
    this.group.traverse((o) => {
      if (!o.isInstancedMesh) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); p.setFromMatrixPosition(m); const h = this.heightAt(p.x, p.z), dh = h - this.heightAt(p.x, p.z, this.H0);
        if (dh > -0.05) continue;
        if (h < LAKE.level + 0.15) { o.setMatrixAt(i, zero); this.sunkProps++; } else { m.elements[13] += dh; o.setMatrixAt(i, m); this.movedProps++; }
      }
      o.instanceMatrix.needsUpdate = true;
    });
  }

  // ------------------------------------------------------------ backdrop: a snow-capped coast range
  // A mainland range wraps round the bay from the north-west to the south-south-west (the west stays open sea for the
  // sunsets), in the Kaikoura style: a narrow coastal strip, a steep front range, and higher peaks behind. One polar grid
  // built once (the ranges only ever sit 4-16 km off), coloured per pixel (forest, tussock, rock and snow above a
  // snowline that climbs on steep faces) and hazed with distance and altitude, so farther ranges go bluer and paler.
  buildBackdrop() {
    const D2R = Math.PI / 180, A0 = -44 * D2R, A1 = 218 * D2R, NA = 560, NR = 76, R1 = 16000;
    const coast = (b) => 4300 + 500 * Math.sin(b * 1.7 + 0.6) + 350 * Math.sin(b * 4.3 + 2.0) + 2000 * (1 - smooth(A0, A0 + 0.5, b) * smooth(A1, A1 - 0.5, b));
    const fbm = (x, z) => (vnoise(x, z) + 0.5 * vnoise(x * 2.03, z * 2.03) + 0.25 * vnoise(x * 4.1, z * 4.1)) / 1.75;
    // ridged multifractal: sharp crests, gullies between
    const ridged = (x, z) => { let sum = 0, amp = 0.5, f = 1, w = 1; for (let i = 0; i < 6; i++) { let n = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1); n *= n * w; w = clamp(n * 1.8, 0, 1); sum += n * amp; f *= 2.07; amp *= 0.5; } return sum; };
    const height = (x, z, xi, b) => {
      if (xi < 0) return Math.max(-60, xi * 0.3); // a sloping shore into the sea
      // a steep front range straight behind the coast, the main divide behind it, and the highest peaks far back
      const env = 1350 * smooth(80, 2300, xi) + 1000 * smooth(2300, 6500, xi) + 900 * smooth(7500, 10500, xi);
      const gaps = 0.5 + 0.5 * smooth(0.3, 0.62, vnoise(x / 5200 + 7, z / 5200 - 3)); // passes and valleys between massifs
      const taper = smooth(A0 + 0.05, A0 + 0.4, b) * smooth(A1 - 0.05, A1 - 0.4, b) * (1 - 0.35 * smooth(140 * D2R, 200 * D2R, b)); // lower in the south
      return 3 + 12 * smooth(0, 120, xi) + env * gaps * taper * (0.25 + 0.6 * ridged(x / 3200, z / 3200) + 0.4 * fbm(x / 2600 + 3, z / 2600));
    };
    const pos = new Float32Array(NA * NR * 3), idx = [];
    for (let i = 0; i < NA; i++) {
      const b = A0 + (A1 - A0) * i / (NA - 1), sx = Math.sin(b), sz = -Math.cos(b), c0 = coast(b) - 160;
      for (let j = 0; j < NR; j++) {
        const r = c0 + (R1 - c0) * Math.pow(j / (NR - 1), 1.7), x = sx * r, z = sz * r, k = (i * NR + j) * 3;
        pos[k] = x; pos[k + 1] = height(x, z, r - c0 - 160, b); pos[k + 2] = z;
      }
    }
    for (let i = 0; i < NA - 1; i++) for (let j = 0; j < NR - 1; j++) { const a = i * NR + j, c = a + NR; idx.push(a, a + 1, c, c, a + 1, c + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((v, n) => idx[n - (n % 3) + [0, 2, 1][n % 3]])); g.computeVertexNormals(); }
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
    const U = this.mtnU = { uHazeK: { value: 1e-4 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP, vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWP, vWN; uniform float uHazeK;
        float mh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float mn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mh(i), mh(i + vec2(1, 0)), f.x), mix(mh(i + vec2(0, 1)), mh(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        // gullies and rock ribs finer than the mesh: a ridged detail height, bumped into the normal (below) and the slope
        vec2 q = vWP.xz / 260.0; float e = 0.07;
        float r0 = 1.0 - abs(2.0 * mn(q) - 1.0), rx = 1.0 - abs(2.0 * mn(q + vec2(e, 0.0)) - 1.0), rz = 1.0 - abs(2.0 * mn(q + vec2(0.0, e)) - 1.0);
        vec3 bumpW = vec3(r0 - rx, 0.0, r0 - rz) / e * 0.55;
        vec3 wn = normalize(normalize(vWN) + bumpW);
        float hgt = vWP.y, sl = 1.0 - wn.y, n1 = mn(vWP.xz / 900.0), n2 = mn(vWP.xz / 160.0 + 7.0), n3 = mn(vWP.xz / 45.0 + 3.0);
        // snow above ~1400 m; steep faces and ribs stay dark rock (it slides off), gullies hold it, and the edge is ragged
        float line = 1400.0 + 900.0 * smoothstep(0.22, 0.55, sl) + 300.0 * (n1 - 0.5) + 160.0 * (n2 - 0.5) + 60.0 * (n3 - 0.5) - 250.0 * (1.0 - r0);
        float snow = smoothstep(line - 40.0, line + 40.0, hgt);
        float forest = (1.0 - smoothstep(650.0, 950.0, hgt + 200.0 * (n2 - 0.5))) * (1.0 - smoothstep(0.4, 0.7, sl));
        float rock = clamp(smoothstep(0.38, 0.62, sl + 0.25 * (n3 - 0.5)) + smoothstep(1200.0, 1800.0, hgt) * 0.8, 0.0, 1.0);
        vec3 col = mix(vec3(0.15, 0.13, 0.07), vec3(0.2, 0.18, 0.1), n2);        // tussock and alpine scrub
        col = mix(col, vec3(0.025, 0.05, 0.025) * (0.8 + 0.4 * n3), forest);    // beech forest
        col = mix(col, vec3(0.1, 0.095, 0.09) * (0.7 + 0.6 * n3), rock);        // greywacke and scree
        col = mix(col, vec3(0.08, 0.11, 0.05), 1.0 - smoothstep(10.0, 40.0, hgt)); // a strip of coastal pasture
        col = mix(col, vec3(0.72, 0.75, 0.8), snow);
        diffuseColor.rgb = col;`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(bumpW, 0.0)).xyz);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, snow);')
        // aerial perspective: thinner air higher up, so the peaks stay crisp over hazy bases
        .replace('#include <fog_fragment>', `#ifdef USE_FOG
          float hk = uHazeK * exp(-max(0.5 * (vWP.y + cameraPosition.y), 0.0) / 3500.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - exp(-length(vWP - cameraPosition) * hk));
        #endif`);
    };
    const m = new THREE.Mesh(g, mat); m.name = 'mountains'; m.frustumCulled = false; this.group.add(m); this.noAO.push(m); this.mountains = m;
    this.backdropTris = idx.length / 3;
    // the lake: milky turquoise (glacial flour scatters the light back up), paler over the shallows, with a light ripple
    // that catches the sky at grazing angles
    const lmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 });
    lmat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTime: this.uni.uTime });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vL;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvL = position.xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          varying vec2 vL; uniform float uTime;
          float lq(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1, 0), vec2(127.1, 311.7)), dot(i + vec2(0, 1), vec2(127.1, 311.7)), dot(i + 1.0, vec2(127.1, 311.7)))) * 43758.5453); return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y); }
          float lh(vec2 p) { return lq(p) + 0.5 * lq(p * 2.3 + 1.7); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float r = length(vL); diffuseColor.rgb = mix(vec3(0.012, 0.25, 0.31), vec3(0.2, 0.46, 0.44), smoothstep(0.55, 1.05, r));`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 wp = vL * vec2(${(LAKE.ax * 1.25 + 6).toFixed(1)}, ${(LAKE.az * 1.25 + 8).toFixed(1)}) * 0.45 + vec2(uTime * 0.3, uTime * 0.17);
          float e0 = lh(wp), ex = lh(wp + vec2(0.3, 0.0)), ez = lh(wp + vec2(0.0, 0.3));
          normal = normalize(normal + (viewMatrix * vec4((e0 - ex) * 0.25, 0.0, (e0 - ez) * 0.25, 0.0)).xyz);`);
    };
    const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 128).rotateX(-Math.PI / 2), lmat);
    lake.scale.set(LAKE.ax * 1.25 + 6, 1, LAKE.az * 1.25 + 8); lake.position.set(LAKE.x, LAKE.level, LAKE.z); lake.receiveShadow = true; lake.name = 'lake';
    this.group.add(lake); this.noAO.push(lake); this.lake = lake;
  }

  // ------------------------------------------------------------ per frame
  update(dt, t, night, rider, windK = 1) {
    this.uni.uTime.value = t; this.uni.uWind.value = windK;
    this.mtnU.uHazeK.value = scene.fog.density * 0.2; // hazier at dusk and night, like the fog
    if (night !== this.night) {
      this.night = night;
      for (const n of this.nightMats) n.m.emissiveIntensity = n.k * night;
      this.beamMat.uniforms.uI.value = night;
      this.beacon.intensity = night * 400;
      this.beams.visible = night > 0.02;
    }
    this.beams.rotation.y = t * 0.9;
    for (const b of this.boats) { b.g.position.y = Math.sin(t * 1.3 + b.ph) * 0.12 - 0.05; b.g.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.06; b.g.rotation.x = Math.sin(t * 0.8 + b.ph * 2) * 0.03; }
    // hand the light pool to the lamps nearest the rider
    if (rider && night > 0.01) {
      const near = this.lamps.map((l) => ({ l, d: l.p.distanceToSquared(rider) })).sort((a, b) => a.d - b.d);
      this.lampLights.forEach((L, i) => { const n = near[i]; if (!n || n.d > 70 * 70) { L.intensity = 0; return; } L.position.copy(n.l.p).y -= 0.25; L.target.position.copy(L.position).y -= 4; L.intensity = 18 * night * (1 - smooth(45, 70, Math.sqrt(n.d))); });
    } else this.lampLights.forEach((L) => (L.intensity = 0));
  }
}
function hashf(i) { const s = Math.sin(i * 91.7) * 43758.5; return s - Math.floor(s); }
