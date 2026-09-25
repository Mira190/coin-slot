// Procedural textures: every albedo / normal / roughness-metalness map in the game is painted here on canvases.
// Normal maps are derived from painted height fields (Sobel), roughness lives in G and metalness in B (three.js
// convention for roughnessMap / metalnessMap sharing one texture).
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------ helpers
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Tileable value-noise field (period in cells) sampled on a w x h grid, fbm with `oct` octaves. Returns Float32Array 0..1
export function noiseField(w, h, cells = 8, oct = 4, seed = 1, gain = 0.5) {
  const out = new Float32Array(w * h);
  const R = rng(seed);
  let amp = 1, tot = 0, cx = cells, cy = Math.max(1, Math.round(cells * h / w));
  for (let o = 0; o < oct; o++) {
    const g = new Float32Array(cx * cy);
    for (let i = 0; i < g.length; i++) g[i] = R();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * cy, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cy) * cx, r1 = ((y0 + 1) % cy) * cx;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cx, c1 = (x0 + 1) % cx;
        const a = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * sx;
        const b = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * sx;
        out[y * w + x] += (a + (b - a) * sy) * amp;
      }
    }
    tot += amp; amp *= gain; cx *= 2; cy *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// height (Float32Array, 0..1) -> normal map canvas; wrap = tileable sampling
export function normalFromHeight(hgt, w, h, strength = 2, wrap = true) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); }
    return hgt[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
// roughness (G) + metalness (B) from two float fields
function rmCanvas(rough, metal, w, h) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 255; d[i * 4 + 1] = clamp(rough[i]) * 255; d[i * 4 + 2] = clamp(metal ? metal[i] : 0) * 255; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
let ANISO = 4;
export function setAniso(a) { ANISO = a; }
export function tex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
// '#rrggbb' -> sRGB 0..1 (no colour management: canvases are sRGB)
const hex = (s) => { const n = parseInt(s.slice(1), 16); return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }; };
function rgbStr(col, k = 1) { return `rgb(${(clamp(col.r * k) * 255) | 0},${(clamp(col.g * k) * 255) | 0},${(clamp(col.b * k) * 255) | 0})`; }
// draw a soft rust streak running down from (x, y)
function streak(ctx, x, y, len, wid, alpha, col = '120,56,26') {
  const g = ctx.createLinearGradient(x, y, x, y + len);
  g.addColorStop(0, `rgba(${col},${alpha})`); g.addColorStop(0.35, `rgba(${col},${alpha * 0.55})`); g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x - wid / 2, y); ctx.lineTo(x + wid / 2, y); ctx.lineTo(x + wid * 0.2, y + len); ctx.lineTo(x - wid * 0.2, y + len); ctx.fill();
}
function blotches(ctx, R, n, w, h, rmin, rmax, style, yBias = 0) {
  ctx.fillStyle = style;
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = yBias ? h - Math.pow(R(), 2.2) * h * yBias : R() * h, r = lerp(rmin, rmax, R());
    ctx.beginPath();
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, rr = r * (0.55 + R() * 0.6); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); }
    ctx.fill();
  }
}
// read canvas luminance to a float field (used to derive roughness from painted masks)
function lumField(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  return out;
}
function alphaField(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] / 255;
  return out;
}

// ------------------------------------------------------------------------------------------------ containers
export const CONTAINER_COLORS = {
  red: '#9c2f22', blue: '#1f4f8f', green: '#2f6b3a', orange: '#c8662a', grey: '#7d8288', teal: '#1d6f6c', maroon: '#6a2331', yellow: '#c79a2c', white: '#c9c8c0', brown: '#6b4a32',
};
const SW = 1024, SH = 512; // side texture covers one 6.06 x 2.59 m panel
// corrugation profile across u (0..1 within one pitch): outer flat, slope, inner flat, slope
function corr(t) {
  if (t < 0.36) return 1;
  if (t < 0.5) return 1 - (t - 0.36) / 0.14;
  if (t < 0.86) return 0;
  return (t - 0.86) / 0.14;
}
let SIDE_SHARED = null;
function containerSideShared() {
  if (SIDE_SHARED) return SIDE_SHARED;
  const w = SW, h = SH, pitch = SW / 22; // 22 ribs per 6 m panel, tiles cleanly
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  const dent = noiseField(w, h, 6, 3, 77);
  const fine = noiseField(w, h, 64, 2, 78);
  const railT = 0.055 * h, railB = 0.07 * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = corr(((x + 6) % pitch) / pitch) * 0.55;
      if (y < railT || y > h - railB) v = 0.9 + (y < railT ? 0.05 : 0);
      if (x < 10 || x > w - 10) v = 0.95; // corner posts
      v += (dent[i] - 0.5) * 0.35 + (fine[i] - 0.5) * 0.02;
      hgt[i] = v;
      rough[i] = 0.5 + (fine[i] - 0.5) * 0.12;
    }
  }
  SIDE_SHARED = { hgt, rough, metal, normal: tex(normalFromHeight(hgt, w, h, 2.4), false) };
  return SIDE_SHARED;
}
// per-colour side albedo + roughness (rust/dirt differ per colour so boxes don't look cloned).
// 20 ft sides are 1024 px wide, 40 ft sides 2048 px (the shared relief maps repeat twice); the owner's
// logo and box number are painted in, so they pick up the corrugation normals.
export function containerSide(color, seed = 1, len = 20, logo = seed) {
  const sh = containerSideShared();
  const k = len === 40 ? 2 : 1, w = SW * k, h = SH, R = rng(seed * 131 + 7);
  const c = canvas(w, h), ctx = c.getContext('2d');
  const base = hex(CONTAINER_COLORS[color] || color);
  ctx.fillStyle = rgbStr(base); ctx.fillRect(0, 0, w, h);
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,245,230,0.10)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(0.85, 'rgba(40,30,20,0.12)'); g.addColorStop(1, 'rgba(30,20,10,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // logo + number, then corrugation shading over everything (paint follows the ribs)
  if (color !== 'white') {
    const name = LOGOS[logo % LOGOS.length];
    ctx.fillStyle = 'rgba(246,244,236,0.93)';
    let fs = 150 * (k > 1 ? 1.25 : 1);
    ctx.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`;
    while (ctx.measureText(name).width > w * 0.62 && fs > 40) { fs -= 6; ctx.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`; }
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const lx = w * 0.46;
    ctx.fillText(name, lx + 40, h * 0.5);
    // emblem left of the name
    const ew = ctx.measureText(name).width;
    ctx.save(); ctx.translate(lx + 40 - ew / 2 - 80, h * 0.5);
    ctx.beginPath(); ctx.arc(0, 0, 58, 0, 7); ctx.fill();
    ctx.fillStyle = rgbStr(base);
    ctx.beginPath(); ctx.moveTo(-50, 10); ctx.quadraticCurveTo(-12, -26, 12, 8); ctx.quadraticCurveTo(32, 30, 54, 0); ctx.lineTo(54, 16); ctx.quadraticCurveTo(32, 46, 12, 24); ctx.quadraticCurveTo(-12, -8, -50, 26); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(246,244,236,0.93)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const code = ['MRDU', 'TDWU', 'HLCU', 'ORCU', 'SHRU', 'KRLU', 'ALBU', 'PRLU'][logo % 8];
    ctx.font = 'bold 34px "IBM Plex Mono", monospace';
    ctx.fillText(code + ' ' + String(100000 + ((seed * 7919) % 899999)) + ' ' + (seed % 9), w - 360, 78);
  }
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const mottle = noiseField(w, h, 5 * k, 4, seed * 3 + 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, si = y * SW + (x % SW), kk = 0.9 + sh.hgt[si] * 0.16 + (mottle[i] - 0.5) * 0.14;
    d[i * 4] *= kk; d[i * 4 + 1] *= kk; d[i * 4 + 2] *= kk;
  }
  ctx.putImageData(img, 0, 0);
  const rc = canvas(w, h), rx = rc.getContext('2d');
  for (let i = 0; i < 26 * k; i++) streak(rx, R() * w, h * 0.05 + R() * 6, 40 + R() * 180, 3 + R() * 8, 0.25 + R() * 0.35);
  for (let i = 0; i < 10 * k; i++) streak(rx, R() * w, R() * h * 0.7, 20 + R() * 90, 2 + R() * 5, 0.3 + R() * 0.3, '90,40,20');
  blotches(rx, R, 90 * k, w, h, 2, 9, 'rgba(110,52,24,0.55)', 0);
  blotches(rx, R, 60 * k, w, h, 5, 22, 'rgba(96,48,26,0.45)', 0.16);
  g = rx.createLinearGradient(0, h * 0.9, 0, h); g.addColorStop(0, 'rgba(100,46,22,0)'); g.addColorStop(1, 'rgba(92,44,22,0.75)');
  rx.fillStyle = g; rx.fillRect(0, h * 0.88, w, h * 0.12);
  blotches(rx, R, 40 * k, w, h, 1, 3.5, 'rgba(150,150,145,0.8)', 0);
  ctx.drawImage(rc, 0, 0);
  ctx.fillStyle = 'rgba(240,240,235,0.82)';
  ctx.font = 'bold 15px "IBM Plex Mono", monospace';
  ctx.fillText(k > 1 ? '45G1' : '22G1', w - 150, h * 0.8);
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillText(k > 1 ? 'MAX GR  32,500 KG' : 'MAX GR  30,480 KG', w - 150, h * 0.8 + 14);
  ctx.fillText(k > 1 ? 'TARE     3,750 KG' : 'TARE     2,220 KG', w - 150, h * 0.8 + 26);
  const ra = alphaField(rc), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; rough[i] = sh.rough[y * SW + (x % SW)] + ra[i] * 0.35; metal[i] = 0.05 * ra[i]; }
  let normal = sh.normal;
  if (k > 1) { normal = sh.normal.clone(); normal.repeat.set(2, 1); normal.needsUpdate = true; }
  return { map: tex(c), normal, rm: tex(rmCanvas(rough, metal, w, h), false) };
}
// door end: two leaves, recessed panels, header/sill, data plates. Locking bars are real geometry.
let DOOR_SHARED = null;
export function containerDoor(color, seed = 1) {
  const w = 512, h = 544, R = rng(seed * 71 + 3);
  if (!DOOR_SHARED) {
    const hgt = new Float32Array(w * h), fine = noiseField(w, h, 32, 2, 9), dent = noiseField(w, h, 4, 3, 10);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = 0.6;
      const inFrame = y < 30 || y > h - 36 || x < 16 || x > w - 16;
      const seam = Math.abs(x - w / 2) < 3;
      if (inFrame) v = 0.95; else if (seam) v = 0.2;
      else {
        // pressed door panels: horizontal ribs
        const ry = ((y - 30) % 96) / 96;
        v = ry < 0.12 || ry > 0.88 ? 0.75 : 0.45 + 0.1 * Math.sin(ry * Math.PI);
      }
      hgt[i] = v + (dent[i] - 0.5) * 0.2 + (fine[i] - 0.5) * 0.02;
    }
    DOOR_SHARED = { hgt, normal: tex(normalFromHeight(hgt, w, h, 2.2), false) };
  }
  const c = canvas(w, h), ctx = c.getContext('2d'), base = hex(CONTAINER_COLORS[color] || color);
  ctx.fillStyle = rgbStr(base); ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data, hg = DOOR_SHARED.hgt;
  for (let i = 0; i < w * h; i++) { const k = 0.88 + hg[i] * 0.2; d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k; }
  ctx.putImageData(img, 0, 0);
  const rc = canvas(w, h), rx = rc.getContext('2d');
  for (let i = 0; i < 16; i++) streak(rx, R() * w, 28 + R() * 10, 30 + R() * 160, 3 + R() * 6, 0.3 + R() * 0.3);
  blotches(rx, R, 40, w, h, 2, 8, 'rgba(110,52,24,0.55)', 0);
  let g = rx.createLinearGradient(0, h * 0.86, 0, h); g.addColorStop(0, 'rgba(100,46,22,0)'); g.addColorStop(1, 'rgba(92,44,22,0.8)');
  rx.fillStyle = g; rx.fillRect(0, h * 0.84, w, h * 0.16);
  ctx.drawImage(rc, 0, 0);
  // owner code + number on the right leaf, CSC plate on the left leaf
  const code = ['MRDU', 'TDWU', 'HLCU', 'ORCU', 'SHRU', 'KRLU', 'ALBU', 'PRLU'][seed % 8];
  const num = String(100000 + Math.floor(R() * 899999));
  ctx.fillStyle = 'rgba(245,245,240,0.9)';
  ctx.font = 'bold 30px "IBM Plex Mono", monospace';
  ctx.fillText(code, w * 0.56, 90);
  ctx.fillText(num + ' ' + ((R() * 9) | 0), w * 0.56, 124);
  ctx.font = 'bold 22px "IBM Plex Mono", monospace'; ctx.fillText('22G1', w * 0.56, 156);
  ctx.fillStyle = 'rgba(200,200,190,0.85)'; ctx.fillRect(w * 0.12, h * 0.42, 70, 46);
  ctx.fillStyle = 'rgba(60,60,60,0.8)'; ctx.font = '8px monospace';
  for (let k = 0; k < 5; k++) ctx.fillRect(w * 0.12 + 6, h * 0.42 + 8 + k * 7, 40 + R() * 18, 2);
  const ra = alphaField(rc), rough = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) rough[i] = 0.52 + ra[i] * 0.35;
  return { map: tex(c, true, false), normal: DOOR_SHARED.normal, rm: tex(rmCanvas(rough, null, w, h), false, false) };
}
// roof panel: shallow transverse corrugation + standing water stains; also used for container tops you walk on
let ROOF = null;
export function containerRoof() {
  if (ROOF) return ROOF;
  const w = 512, h = 256, R = rng(55);
  const hgt = new Float32Array(w * h), n = noiseField(w, h, 6, 4, 56), f = noiseField(w, h, 48, 2, 57);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    hgt[i] = 0.5 + 0.25 * Math.sin((x / w) * Math.PI * 2 * 14) + (n[i] - 0.5) * 0.4 + (f[i] - 0.5) * 0.03;
  }
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#7b7d7c'; ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { const k = 0.8 + n[i] * 0.4; d[i * 4] *= k; d[i * 4 + 1] *= k * 0.98; d[i * 4 + 2] *= k * 0.95; }
  ctx.putImageData(img, 0, 0);
  blotches(ctx, R, 60, w, h, 3, 16, 'rgba(105,50,24,0.5)');
  blotches(ctx, R, 18, w, h, 12, 40, 'rgba(40,36,30,0.25)');
  const rough = new Float32Array(w * h);
  const L = lumField(c);
  for (let i = 0; i < w * h; i++) rough[i] = 0.55 + (0.5 - L[i]) * 0.5;
  ROOF = { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 1.6), false), rm: tex(rmCanvas(rough, null, w, h), false) };
  return ROOF;
}
// big logos and numbers for container sides (alpha texture atlas, 4 x 4 cells of 512 x 256)
export const LOGOS = ['MERIDIAN', 'TIDEWAY', 'HALCYON', 'ORCALINE', 'SEAHORN', 'KAIRO', 'ALBATROSS', 'PEARLINE'];
export function decalAtlas() {
  const w = 2048, h = 1024, c = canvas(w, h), ctx = c.getContext('2d');
  const R = rng(4242);
  LOGOS.forEach((name, k) => {
    const cx = (k % 4) * 512, cy = Math.floor(k / 4) * 256;
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(250,248,240,0.95)';
    // emblem
    ctx.save(); ctx.translate(60, 128);
    const e = k % 4;
    ctx.beginPath();
    if (e === 0) { ctx.arc(0, 0, 44, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.moveTo(-40, 8); ctx.quadraticCurveTo(-10, -20, 10, 6); ctx.quadraticCurveTo(26, 24, 42, 0); ctx.lineTo(42, 14); ctx.quadraticCurveTo(26, 38, 10, 20); ctx.quadraticCurveTo(-10, -4, -40, 22); ctx.fill(); }
    else if (e === 1) { ctx.moveTo(-40, 30); ctx.lineTo(0, -44); ctx.lineTo(40, 30); ctx.closePath(); ctx.fill(); }
    else if (e === 2) { for (let i = 0; i < 3; i++) { ctx.fillRect(-42, -34 + i * 26, 84, 14); } }
    else { ctx.moveTo(0, -46); for (let i = 1; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 20 : 46; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(250,248,240,0.95)';
    let fs = 92; ctx.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`;
    while (ctx.measureText(name).width > 400 && fs > 30) { fs -= 4; ctx.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`; }
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 118, 132);
    ctx.restore();
  });
  // cells 8..15: number plates "ABCU 123456 7" + small ISO text
  for (let k = 8; k < 16; k++) {
    const cx = (k % 4) * 512, cy = Math.floor(k / 4) * 256;
    ctx.fillStyle = 'rgba(245,245,240,0.92)';
    ctx.font = 'bold 60px "IBM Plex Mono", monospace'; ctx.textBaseline = 'top';
    const code = ['MRDU', 'TDWU', 'HLCU', 'ORCU', 'SHRU', 'KRLU', 'ALBU', 'PRLU'][k - 8];
    ctx.fillText(code, cx + 20, cy + 30);
    ctx.fillText(String(100000 + Math.floor(R() * 899999)) + ' ' + ((R() * 9) | 0), cx + 20, cy + 100);
    ctx.font = 'bold 34px "IBM Plex Mono", monospace'; ctx.fillText('45G1', cx + 20, cy + 176);
  }
  const t = tex(c, true, false);
  return t;
}

// ------------------------------------------------------------------------------------------------ deck + metals
// painted steel deck plate, tiles every 4 m: plate seams, weld beads, non-skid grain, worn paths, rust
export function deckPlate() {
  const w = 1024, h = 1024, R = rng(901);
  const hgt = new Float32Array(w * h), grain = noiseField(w, h, 128, 2, 902), wear = noiseField(w, h, 4, 5, 903), bump = noiseField(w, h, 16, 3, 904);
  const seam = (v, p) => { const t = v % p; return t < 3 || t > p - 3; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let v = 0.5 + (grain[i] - 0.5) * 0.08 + (bump[i] - 0.5) * 0.12;
    if (seam(x, 512) || seam(y + 256, 512)) v = 0.72 + (grain[i] - 0.5) * 0.3; // weld bead
    hgt[i] = v;
  }
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#4c5a50'; ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data, rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const wv = wear[i];
    // worn areas go from paint to dark bare steel to rust
    let r = 76, g = 90, b = 80;
    const k = 0.85 + grain[i] * 0.2 + (bump[i] - 0.5) * 0.2;
    let ro = 0.62, me = 0.0;
    // worn paths: paint -> scuffed bare steel -> a little dull brown oxide in the deepest wear
    if (wv > 0.58) { const t = clamp((wv - 0.58) / 0.14); r = lerp(r, 92, t); g = lerp(g, 94, t); b = lerp(b, 92, t); ro = lerp(ro, 0.42, t); me = t * 0.6; }
    if (wv > 0.74) { const t = clamp((wv - 0.74) / 0.12) * 0.6; r = lerp(r, 100, t); g = lerp(g, 82, t); b = lerp(b, 64, t); ro = lerp(ro, 0.8, t); me = lerp(me, 0.15, t); }
    if (hgt[i] > 0.66) { r *= 0.8; g *= 0.8; b *= 0.78; }
    d[i * 4] = r * k; d[i * 4 + 1] = g * k; d[i * 4 + 2] = b * k;
    rough[i] = ro + (grain[i] - 0.5) * 0.15; metal[i] = me;
  }
  ctx.putImageData(img, 0, 0);
  blotches(ctx, R, 14, w, h, 20, 70, 'rgba(20,18,16,0.14)'); // oil stains
  blotches(ctx, R, 30, w, h, 2, 6, 'rgba(92,70,48,0.35)'); // dull rust pits (brown, never blood-red)
  const L = lumField(c);
  for (let i = 0; i < w * h; i++) rough[i] = clamp(rough[i] + (0.3 - L[i]) * 0.2);
  return { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 3.2), false), rm: tex(rmCanvas(rough, metal, w, h), false) };
}
// raised diamond tread plate (walkways, stair treads)
export function treadPlate() {
  const w = 512, h = 512, R = rng(77);
  const hgt = new Float32Array(w * h), n = noiseField(w, h, 8, 3, 78), g = noiseField(w, h, 64, 2, 79);
  const P = 32;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    // alternating diagonal lozenges
    const cx = Math.floor(x / P), cy = Math.floor(y / P), u = (x % P) / P - 0.5, v = (y % P) / P - 0.5;
    const dir = (cx + cy) % 2 ? 1 : -1;
    const a = (u + dir * v) * 0.7071, b = (u - dir * v) * 0.7071;
    const lz = Math.max(0, 1 - Math.hypot(a / 0.36, b / 0.08));
    hgt[i] = lz * 0.8 + (n[i] - 0.5) * 0.1 + (g[i] - 0.5) * 0.03;
  }
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#6d7272'; ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data, rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const k = 0.75 + n[i] * 0.35 + hgt[i] * 0.2;
    d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k;
    rough[i] = 0.5 - hgt[i] * 0.2 + (g[i] - 0.5) * 0.1; metal[i] = 0.7;
  }
  ctx.putImageData(img, 0, 0);
  blotches(ctx, R, 30, w, h, 4, 18, 'rgba(100,52,26,0.45)');
  const L = lumField(c);
  for (let i = 0; i < w * h; i++) if (L[i] < 0.33) { rough[i] = 0.85; metal[i] = 0.2; }
  return { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 2.5), false), rm: tex(rmCanvas(rough, metal, w, h), false) };
}
// painted steel wall with panel seams + rust streaks (cabin exterior, hull, pipe walls). colour + dirt level vary
export function paintedSteel(color = '#d8d6cc', seed = 5, dirt = 1, panelW = 256, panelH = 256) {
  const w = 512, h = 512, R = rng(seed);
  const hgt = new Float32Array(w * h), n = noiseField(w, h, 4, 4, seed + 1), g = noiseField(w, h, 64, 2, seed + 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const sx = x % panelW, sy = y % panelH;
    let v = 0.5 + (n[i] - 0.5) * 0.25 + (g[i] - 0.5) * 0.02;
    if (sx < 3 || sy < 3) v = 0.75; // weld / panel seams
    if ((sx === 12 || sx === panelW - 12) && sy % 32 < 4) v = 0.9; // rivet rows
    hgt[i] = v;
  }
  const c = canvas(w, h), ctx = c.getContext('2d');
  const base = hex(color);
  ctx.fillStyle = rgbStr(base); ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { const k = 0.9 + n[i] * 0.16; d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k; }
  ctx.putImageData(img, 0, 0);
  const rc = canvas(w, h), rx = rc.getContext('2d');
  for (let i = 0; i < 18 * dirt; i++) streak(rx, R() * w, R() * h, 40 + R() * 200, 2 + R() * 7, 0.2 + R() * 0.35);
  blotches(rx, R, 50 * dirt, w, h, 2, 9, 'rgba(110,52,24,0.5)');
  const gg = rx.createLinearGradient(0, 0, 0, h);
  gg.addColorStop(0, 'rgba(60,50,40,0)'); gg.addColorStop(1, `rgba(60,50,40,${0.2 * dirt})`);
  rx.fillStyle = gg; rx.fillRect(0, 0, w, h);
  ctx.drawImage(rc, 0, 0);
  const ra = alphaField(rc), rough = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) rough[i] = 0.5 + (g[i] - 0.5) * 0.1 + ra[i] * 0.35;
  return { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 1.8), false), rm: tex(rmCanvas(rough, null, w, h), false) };
}
// linoleum tiles for cabin floors
export function linoFloor() {
  const w = 512, h = 512, R = rng(33), n = noiseField(w, h, 16, 3, 34), f = noiseField(w, h, 4, 3, 35);
  const c = canvas(w, h), ctx = c.getContext('2d');
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
    ctx.fillStyle = (tx + ty) % 2 ? '#5b5f58' : '#6e6a5e';
    ctx.fillRect(tx * 128, ty * 128, 128, 128);
  }
  const img = ctx.getImageData(0, 0, w, h), d = img.data, hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, k = 0.85 + n[i] * 0.25 - f[i] * 0.1;
    d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k;
    hgt[i] = (x % 128 < 2 || y % 128 < 2) ? 0.2 : 0.5 + (n[i] - 0.5) * 0.04;
    rough[i] = 0.35 + f[i] * 0.35;
  }
  ctx.putImageData(img, 0, 0);
  blotches(ctx, R, 20, w, h, 6, 20, 'rgba(30,26,20,0.12)');
  return { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 1.5), false), rm: tex(rmCanvas(rough, null, w, h), false) };
}
// wooden crate side: frame boards + planks + stencil
export function crateWood(seed = 12) {
  const w = 512, h = 512, R = rng(seed);
  const c = canvas(w, h), ctx = c.getContext('2d');
  const grain = noiseField(w, h, 3, 4, seed + 1), fib = noiseField(w, h, 64, 1, seed + 2);
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  const img = ctx.createImageData(w, h), d = img.data;
  const plank = 64, frame = 52;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const inFrame = x < frame || x > w - frame || y < frame || y > h - frame;
    const diag = Math.abs((x - frame) - (y - frame)) < 30 && !inFrame;
    const pl = Math.floor(y / plank);
    // grain along boards: stretch noise along x (or along the diagonal)
    const gx = inFrame && (x < frame || x > w - frame) ? grain[((x * 7) % w) + ((y >> 3) % h) * w] : grain[(y * 7 % h) * w + ((x >> 3) % w)];
    let tone = 0.62 + gx * 0.3 + (R() - 0.5) * 0.04 + ((pl * 37) % 7) * 0.012;
    let hv = 0.5 + fib[i] * 0.06;
    if (!inFrame && y % plank < 3) { tone *= 0.45; hv = 0.1; }
    if (inFrame) { tone *= 1.05; hv = 0.8 + fib[i] * 0.06; if (x % (w - frame) < 3 || y % (h - frame) < 3) { hv = 0.6; tone *= 0.7; } }
    if (diag) { hv = 0.8; tone *= 1.06; }
    d[i * 4] = 178 * tone; d[i * 4 + 1] = 128 * tone; d[i * 4 + 2] = 76 * tone; d[i * 4 + 3] = 255;
    hgt[i] = hv; rough[i] = 0.7 + fib[i] * 0.2;
  }
  ctx.putImageData(img, 0, 0);
  // nails
  ctx.fillStyle = 'rgba(40,40,40,0.8)';
  for (const [x, y] of [[26, 26], [w - 26, 26], [26, h - 26], [w - 26, h - 26], [26, h / 2], [w - 26, h / 2], [w / 2, 26], [w / 2, h - 26]]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
  // stencil
  ctx.save(); ctx.translate(w / 2, h / 2 + 40); ctx.rotate(0);
  ctx.fillStyle = 'rgba(40,24,16,0.55)'; ctx.font = '900 44px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
  ctx.fillText(['FRAGILE', 'THIS SIDE UP', 'HANDLE CARE', 'NO HOOKS'][seed % 4], 0, 0);
  ctx.restore();
  ctx.strokeStyle = 'rgba(40,24,16,0.5)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(w / 2 - 40, h / 2 - 30); ctx.lineTo(w / 2, h / 2 - 80); ctx.lineTo(w / 2 + 40, h / 2 - 30); ctx.stroke();
  blotches(ctx, R, 12, w, h, 8, 30, 'rgba(40,30,20,0.14)');
  return { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 2.2), false), rm: tex(rmCanvas(rough, null, w, h), false) };
}
// quay concrete
export function concrete(seed = 60) {
  const w = 512, h = 512, R = rng(seed), n = noiseField(w, h, 8, 5, seed), f = noiseField(w, h, 96, 2, seed + 1);
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const k = 0.55 + n[i] * 0.35 + (f[i] - 0.5) * 0.15;
    d[i * 4] = 168 * k; d[i * 4 + 1] = 164 * k; d[i * 4 + 2] = 156 * k; d[i * 4 + 3] = 255;
    hgt[i] = n[i] * 0.3 + f[i] * 0.2; rough[i] = 0.85 + f[i] * 0.1;
    const x = i % w, y = (i / w) | 0;
    if (x % 256 < 2 || y % 256 < 2) { d[i * 4] *= 0.6; d[i * 4 + 1] *= 0.6; d[i * 4 + 2] *= 0.6; hgt[i] = 0; }
  }
  ctx.putImageData(img, 0, 0);
  blotches(ctx, R, 16, w, h, 10, 40, 'rgba(30,28,24,0.15)');
  return { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 1.5), false), rm: tex(rmCanvas(rough, null, w, h), false) };
}
// fabric camo for soldiers: palette of 4 colours, blotchy patterns, plus a woven normal map
export function camo(palette, seed = 3, scale = 5) {
  const w = 512, h = 512, n1 = noiseField(w, h, scale, 4, seed), n2 = noiseField(w, h, scale + 2, 4, seed + 9), n3 = noiseField(w, h, scale * 2, 3, seed + 17);
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const cols = palette.map((p) => hex(p));
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let k = 0;
    if (n1[i] > 0.55) k = 1;
    if (n2[i] > 0.6) k = 2;
    if (n3[i] > 0.66) k = 3;
    const col = cols[k], t = 0.92 + ((x + y) % 2) * 0.05 + (n3[i] - 0.5) * 0.1;
    d[i * 4] = col.r * 255 * t; d[i * 4 + 1] = col.g * 255 * t; d[i * 4 + 2] = col.b * 255 * t; d[i * 4 + 3] = 255;
    hgt[i] = ((x >> 1) % 2 ^ (y >> 1) % 2) * 0.5 + n3[i] * 0.2; // weave
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 0.8), false) };
}
// gun finishes: parkerised steel, polymer stipple, oiled wood
export function gunFinish(kind = 'steel') {
  const w = 256, h = 256, n = noiseField(w, h, 32, 3, kind.length * 7), f = noiseField(w, h, 128, 1, kind.length * 13);
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  const gr = kind === 'wood' ? noiseField(w, h, 2, 5, 991) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (kind === 'wood') {
      const band = Math.sin((y / h) * 60 + gr[(y * w + ((x * 3) % w))] * 18) * 0.5 + 0.5;
      const k = 0.6 + band * 0.25 + f[i] * 0.1;
      d[i * 4] = 150 * k; d[i * 4 + 1] = 82 * k; d[i * 4 + 2] = 42 * k;
      hgt[i] = band * 0.1 + f[i] * 0.05; rough[i] = 0.45 + band * 0.15; metal[i] = 0;
    } else if (kind === 'polymer') {
      const k = 0.16 + f[i] * 0.05;
      d[i * 4] = 255 * k; d[i * 4 + 1] = 255 * k; d[i * 4 + 2] = 255 * k * 1.02;
      hgt[i] = f[i] * 0.8; rough[i] = 0.7 + f[i] * 0.2; metal[i] = 0;
    } else if (kind === 'tan') {
      const k = 0.62 + f[i] * 0.06 + (n[i] - 0.5) * 0.08;
      d[i * 4] = 190 * k; d[i * 4 + 1] = 168 * k; d[i * 4 + 2] = 126 * k;
      hgt[i] = f[i] * 0.4; rough[i] = 0.6 + f[i] * 0.15; metal[i] = 0;
    } else {
      const k = 0.2 + n[i] * 0.06 + f[i] * 0.04;
      d[i * 4] = 255 * k; d[i * 4 + 1] = 255 * k; d[i * 4 + 2] = 255 * k * 1.04;
      hgt[i] = f[i] * 0.3; rough[i] = 0.42 + n[i] * 0.2; metal[i] = 0.75;
    }
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c), normal: tex(normalFromHeight(hgt, w, h, 1.2), false), rm: tex(rmCanvas(rough, metal, w, h), false) };
}
// emissive city windows (for distant buildings)
export function cityWindows(seed = 8) {
  const w = 256, h = 512, R = rng(seed), c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  for (let y = 6; y < h - 6; y += 12) for (let x = 6; x < w - 6; x += 10) {
    if (R() < 0.3) { const t = R(); ctx.fillStyle = t < 0.7 ? `rgba(255,${190 + R() * 50},${120 + R() * 60},${0.5 + R() * 0.5})` : `rgba(180,220,255,${0.4 + R() * 0.4})`; ctx.fillRect(x, y, 6, 7); }
  }
  return tex(c);
}
// tileable sea normal map (several octaves of ripples)
export function seaNormal() {
  const w = 512, h = 512;
  const a = noiseField(w, h, 8, 5, 311, 0.55), b = noiseField(w, h, 24, 3, 312);
  const hgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hgt[i] = a[i] * 0.8 + b[i] * 0.2;
  const t = tex(normalFromHeight(hgt, w, h, 5), false);
  return t;
}
// soft round sprite (particles)
export function softDot(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// puffy smoke sprite
export function smokePuff(seed = 5) {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d'), n = noiseField(s, s, 4, 4, seed), img = ctx.createImageData(s, s), d = img.data;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, r = Math.hypot(x - s / 2, y - s / 2) / (s / 2);
    const a = clamp((1 - r) * 1.6) * clamp(n[i] * 1.6 - 0.2);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// bullet hole decal (dark hole + scorched ring), and a variant for wood (splintered)
export function bulletHole(wood = false) {
  const s = 64, c = canvas(s, s), ctx = c.getContext('2d'), R = rng(wood ? 2 : 1);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(8,8,8,1)'); g.addColorStop(0.18, 'rgba(15,12,10,1)'); g.addColorStop(0.3, wood ? 'rgba(200,160,110,0.9)' : 'rgba(150,150,150,0.7)'); g.addColorStop(0.55, 'rgba(40,36,30,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  if (wood) { ctx.strokeStyle = 'rgba(210,170,120,0.8)'; ctx.lineWidth = 2; for (let i = 0; i < 7; i++) { const a = R() * 7; ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(32 + Math.cos(a) * (12 + R() * 14), 32 + Math.sin(a) * (12 + R() * 14)); ctx.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// warning stripes (yellow/black hatching) for deck markings
export function hazard() {
  const w = 256, h = 64, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#d9a91e'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1b1b1b';
  for (let x = -h; x < w + h; x += 48) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 24, h); ctx.lineTo(x + 24 + h, 0); ctx.lineTo(x + h, 0); ctx.fill(); }
  const n = noiseField(w, h, 8, 3, 5), img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { const k = n[i] > 0.62 ? 0.55 : 0.9 + n[i] * 0.1; d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k; }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}
// big painted letters/numbers (cabin walls, funnel)
export function signTexture(text, fg = '#f2efe6', bg = null, w = 512, h = 256, font = '900 150px Rubik, "Arial Black", sans-serif') {
  const c = canvas(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO; return t;
}
