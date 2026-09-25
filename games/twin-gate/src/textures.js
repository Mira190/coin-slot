// Procedural canvas textures: lab panels, metal, floors, cubes, signs and pictograms.
// Everything is drawn in code; each surface gets albedo + roughness + a normal map baked from a height field.
import * as THREE from 'three';

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5 >>> 0) / 4294967296); }

function cnv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// tileable value noise, fbm
function makeNoise(seed, cells) {
  const r = rng(seed), g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => { // x,y in [0,1)
    x *= cells; y *= cells;
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % cells) + cells) % cells, y0 = ((yi % cells) + cells) % cells, x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(seed, base, oct) {
  const ns = []; for (let i = 0; i < oct; i++) ns.push(makeNoise(seed + i * 101, base << i));
  return (x, y) => { let v = 0, a = 0.5, n = 0; for (const f of ns) { v += f(x, y) * a; n += a; a *= 0.5; } return v / n; };
}

// A surface is described by a per-pixel function returning [albedo r,g,b (0..1), height (0..1), rough (0..1)].
function bake(size, fn, normalStrength = 2, repeat = 1) {
  const N = size * size, alb = new Uint8ClampedArray(N * 4), rough = new Uint8ClampedArray(N * 4), hgt = new Float32Array(N);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = fn(x / size, y / size, x, y);
    alb[i * 4] = o[0] * 255; alb[i * 4 + 1] = o[1] * 255; alb[i * 4 + 2] = o[2] * 255; alb[i * 4 + 3] = 255;
    hgt[i] = o[3]; const r = o[4] * 255; rough[i * 4] = r; rough[i * 4 + 1] = r; rough[i * 4 + 2] = r; rough[i * 4 + 3] = 255;
  }
  const nrm = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (xx, yy) => hgt[((yy + size) % size) * size + ((xx + size) % size)];
    const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
    const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
    let nx = -dx * normalStrength, ny = dy * normalStrength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4; nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  const mk = (data, srgb) => {
    const c = cnv(size); c.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.repeat.set(repeat, repeat); return t;
  };
  return { map: mk(alb, true), roughnessMap: mk(rough, false), normalMap: mk(nrm, false) };
}

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
// distance to the nearest grid line, in pixels, for a grid of `cells` per texture
const seam = (u, cells, size) => { const f = u * cells; return Math.abs(f - Math.round(f)) * size / cells; };

// Ceiling light diffuser (emissive map): a louvre grid whose cells glow brightest in the middle, so a fixture
// reads as a light with structure instead of a flat clipped rectangle. 2x2 cells per repeat.
export function lampLouvre(size = 64) {
  const c = cnv(size), g = c.getContext('2d'), img = g.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = ((i + 0.5) / size * 2) % 1, v = ((j + 0.5) / size * 2) % 1, e = Math.min(u, 1 - u, v, 1 - v);
    const b = e < 0.07 ? 0.3 : 0.62 + 0.38 * Math.min(1, (e - 0.07) / 0.3);
    const k = (j * size + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = b * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Building facade for the skyline: window grid, 2 bays x 2 storeys per repeat (5 m x 7 m); glass varies per pane.
export function facade(size = 256) {
  // glass is a mid blue-grey (it stands in for reflected sky, which the lab's room environment cannot provide)
  const pane = rng(61), tone = []; for (let i = 0; i < 4; i++) tone.push(0.3 + pane() * 0.12);
  return bake(size, (u, v) => {
    const bu = (u * 2) % 1, bv = (v * 2) % 1, cell = Math.floor(u * 2) + Math.floor(v * 2) * 2;
    const glass = bu > 0.12 && bu < 0.88 && bv > 0.34 && bv < 0.86, mullion = glass && Math.abs(bu - 0.5) < 0.012;
    if (glass && !mullion) { const g = tone[cell]; return [g * 0.82, g * 0.93, g * 1.1, 0.2, 0.3]; }
    const c = bv < 0.34 ? 0.56 : 0.7; // spandrel band under each window row, lighter frame around it
    return [c, c, c * 0.97, mullion ? 0.8 : 1, 0.85];
  }, 3);
}

// White lab panel: 1 m panels, texture spans 2 m. Portable surface.
export function whitePanel(size = 1024) {
  const n = fbm(11, 8, 5), fine = makeNoise(12, 256), stain = fbm(13, 3, 4);
  const tone = rng(5), pt = []; for (let i = 0; i < 16; i++) pt.push(0.97 + tone() * 0.05);
  return bake(size, (u, v) => {
    const s = Math.min(seam(u, 2, size), seam(v, 2, size));
    const cell = Math.floor(u * 2) + Math.floor(v * 2) * 2;
    const groove = s < 1.5 ? 0 : s < 4 ? (s - 1.5) / 2.5 : 1;
    const lu = (u * 2) % 1, lv = (v * 2) % 1;
    const edgeDirt = Math.max(0, 1 - Math.min(lu, 1 - lu, lv, 1 - lv) * 14) * 0.07;
    // low-frequency stains stay faint: large soft blotches read as haze, not wear
    const g = n(u, v) * 0.022 + fine(u, v) * 0.02 + Math.max(0, stain(u, v) - 0.62) * 0.07 + edgeDirt;
    let b = (0.84 * pt[cell] - g) * (0.7 + 0.3 * groove);
    b = clamp01(b);
    return [b * 0.985, b, b * 0.975, 0.55 * groove + 0.45 - fine(u, v) * 0.02, clamp01(0.5 + n(u, v) * 0.18 + (1 - groove) * 0.3)];
  }, 2.2);
}

// White floor tiles: 0.5 m tiles, texture spans 2 m.
export function whiteFloor(size = 512) {
  const n = fbm(21, 8, 5), fine = makeNoise(22, 256), scuff = fbm(23, 6, 4);
  const tone = rng(7), pt = []; for (let i = 0; i < 16; i++) pt.push(0.95 + tone() * 0.06);
  return bake(size, (u, v) => {
    const s = Math.min(seam(u, 4, size), seam(v, 4, size));
    const cell = Math.floor(u * 4) + Math.floor(v * 4) * 4;
    const groove = s < 1.5 ? 0 : s < 3.5 ? (s - 1.5) / 2 : 1;
    const g = n(u, v) * 0.035 + fine(u, v) * 0.03 + Math.max(0, scuff(u, v) - 0.6) * 0.1;
    const b = clamp01((0.6 * pt[cell] - g) * (0.62 + 0.38 * groove));
    return [b * 0.98, b, b * 0.97, 0.5 * groove + 0.5, clamp01(0.62 + n(u, v) * 0.2 + (1 - groove) * 0.2)];
  }, 1.6);
}

// Dark metal wall tiles (not portable): 1 m square tiles with bevelled light seams, per-tile tone and corner bolts.
export function darkMetal(size = 512) {
  const n = fbm(31, 6, 5), brush = makeNoise(32, 512), streak = fbm(33, 4, 3);
  const tone = rng(9), tt = []; for (let i = 0; i < 16; i++) tt.push(0.88 + tone() * 0.22);
  return bake(size, (u, v) => {
    const px = seam(u, 2, size), py = seam(v, 2, size), s = Math.min(px, py);
    const cell = Math.floor(u * 2) + Math.floor(v * 2) * 2;
    const groove = s < 1.5 ? 0 : s < 5 ? (s - 1.5) / 3.5 : 1;
    const bevel = s >= 1.5 && s < 5 ? 1 - Math.abs(s - 3.2) / 1.7 : 0; // the lit lip of each tile
    const lu = (u * 2) % 1, lv = (v * 2) % 1;
    let bolt = 0;
    for (const cx of [0.06, 0.94]) for (const cy of [0.06, 0.94]) { const d = Math.hypot((lu - cx) * size / 2, (lv - cy) * size / 2); if (d < 4) bolt = Math.max(bolt, 1 - d / 4); }
    const br = brush(u * 0.05, v) * 0.05 + brush(u * 0.02 + 0.3, v * 1.01) * 0.04;
    const g = n(u, v) * 0.08 + br + Math.max(0, streak(u, v) - 0.55) * 0.18;
    const b = clamp01((0.3 * tt[cell] - g * 0.45) * (0.45 + 0.55 * groove) + bevel * 0.1 + bolt * 0.1);
    return [b * 0.95, b * 0.99, b * 1.06, 0.55 * groove + 0.45 + bolt * 0.3, clamp01(0.56 + n(u, v) * 0.18 + br * 1.5 - bevel * 0.15)];
  }, 2.6);
}

// Dark metal floor: diamond tread plate.
export function metalFloor(size = 512) {
  const n = fbm(41, 6, 5), fine = makeNoise(42, 256);
  return bake(size, (u, v) => {
    const k = 16, a = u * k, b = v * k;
    const du = a - Math.floor(a) - 0.5, dv = b - Math.floor(b) - 0.5;
    const alt = (Math.floor(a) + Math.floor(b)) % 2 ? 1 : -1;
    const x = du * 0.707 + dv * 0.707 * alt, y = -du * 0.707 * alt + dv * 0.707;
    const bump = Math.max(0, 1 - Math.hypot(x / 0.34, y / 0.09));
    const s = Math.min(seam(u, 1, size), seam(v, 1, size)), groove = s < 2 ? 0 : 1;
    const g = n(u, v) * 0.1 + fine(u, v) * 0.03;
    const c = clamp01((0.17 - g * 0.4 + bump * 0.06) * (0.5 + 0.5 * groove));
    return [c, c * 1.02, c * 1.06, bump * 0.6 + 0.4 * groove, clamp01(0.6 - bump * 0.15 + n(u, v) * 0.2)];
  }, 3);
}

// Raw concrete for the maintenance areas.
export function concrete(size = 512) {
  const n = fbm(51, 4, 6), pits = makeNoise(52, 180), stain = fbm(53, 2, 5);
  return bake(size, (u, v) => {
    const s = seam(v, 1, size) < 2 ? 0.6 : 1;
    const p = pits(u, v) > 0.9 ? 0.75 : 1;
    const g = n(u, v) * 0.08 + Math.max(0, stain(u, v) - 0.55) * 0.12;
    const b = clamp01((0.42 - g * 0.5) * p * s);
    return [b * 1.02, b, b * 0.95, n(u, v) * 0.7 + (p < 1 ? -0.2 : 0), clamp01(0.85 + n(u, v) * 0.1)];
  }, 1.8);
}

// Weighted test block faces: rounded frame, recessed centre, glowing ring emblem.
export function cubeFaces(kind = 'cube') {
  const size = 256, c = cnv(size), x = c.getContext('2d'), e = cnv(size), ex = e.getContext('2d');
  x.fillStyle = '#b9bdbc'; x.fillRect(0, 0, size, size);
  const gr = x.createLinearGradient(0, 0, size, size); gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(0,0,0,.18)');
  x.fillStyle = gr; x.fillRect(0, 0, size, size);
  x.fillStyle = '#3b4146'; // dark corner caps
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { x.beginPath(); x.arc(cx * size, cy * size, 64, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#9ea3a2'; x.fillRect(46, 46, size - 92, size - 92);
  x.strokeStyle = '#6d7372'; x.lineWidth = 4; x.strokeRect(46, 46, size - 92, size - 92);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, size, size);
  if (kind === 'lens') {
    x.fillStyle = '#2a2f33'; x.beginPath(); x.arc(128, 128, 62, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#e8eef0'; x.beginPath(); x.arc(128, 128, 44, 0, Math.PI * 2); x.fill();
    const lg = ex.createRadialGradient(128, 128, 4, 128, 128, 46); lg.addColorStop(0, '#fff'); lg.addColorStop(0.5, '#ff6a8a'); lg.addColorStop(1, 'rgba(255,40,80,0)');
    ex.fillStyle = lg; ex.beginPath(); ex.arc(128, 128, 46, 0, Math.PI * 2); ex.fill();
  } else {
    // ring + two-dot emblem (the twin gates)
    for (const [ctx, col] of [[x, '#2d3236'], [ex, '#ffffff']]) {
      ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(128, 128, 38, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(112, 128, 7, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(144, 128, 7, 13, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const te = new THREE.CanvasTexture(e); te.colorSpace = THREE.SRGBColorSpace;
  return { map: t, emissiveMap: te };
}

// ---------------------------------------------------------------- pictograms (sign, HUD card, trial select)
export const ICONS = ['gate', 'cube', 'button', 'fling', 'grid', 'acid', 'laser', 'lens', 'plate', 'bridge', 'bounce', 'speed', 'platform', 'eye'];
export function drawIcon(g, kind, x, y, s, fg = '#11161a', bg = null) {
  g.save(); g.translate(x, y); g.scale(s / 100, s / 100);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, 100, 100); }
  g.fillStyle = fg; g.strokeStyle = fg; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
  const P = (pts) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); };
  switch (kind) {
    case 'gate': g.beginPath(); g.ellipse(34, 50, 13, 26, 0, 0, 7); g.stroke(); g.beginPath(); g.ellipse(68, 50, 13, 26, 0, 0, 7); g.stroke(); break;
    case 'cube': P([50, 18, 80, 33, 80, 67, 50, 82, 20, 67, 20, 33]); g.closePath(); g.stroke(); P([20, 33, 50, 48, 80, 33]); g.stroke(); P([50, 48, 50, 82]); g.stroke(); break;
    case 'button': g.fillRect(16, 70, 68, 10); g.fillRect(28, 58, 44, 10); P([50, 20, 50, 46]); g.stroke(); P([38, 36, 50, 48, 62, 36]); g.stroke(); break;
    case 'fling': g.beginPath(); g.moveTo(16, 82); g.quadraticCurveTo(40, 6, 84, 40); g.stroke(); P([70, 30, 86, 40, 72, 52]); g.stroke(); g.fillRect(10, 84, 20, 6); break;
    case 'grid': for (let i = 0; i < 5; i++) { P([22 + i * 14, 16, 22 + i * 14, 84]); g.stroke(); } break;
    case 'acid': for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(10, 44 + i * 18); for (let k = 0; k <= 8; k++) g.lineTo(10 + k * 10, 44 + i * 18 + (k % 2 ? -7 : 7)); g.stroke(); } break;
    case 'laser': g.fillRect(8, 38, 22, 24); P([30, 50, 92, 50]); g.stroke(); P([60, 32, 68, 42]); g.stroke(); P([60, 68, 68, 58]); g.stroke(); break;
    case 'lens': g.strokeRect(22, 22, 56, 56); g.beginPath(); g.arc(50, 50, 13, 0, 7); g.fill(); P([50, 50, 92, 50]); g.stroke(); break;
    case 'plate': g.fillRect(10, 76, 38, 8); g.beginPath(); g.moveTo(28, 72); g.quadraticCurveTo(52, 0, 88, 72); g.setLineDash([8, 9]); g.stroke(); g.setLineDash([]); break;
    case 'bridge': g.fillRect(8, 28, 12, 44); g.globalAlpha = 0.55; g.fillRect(20, 46, 72, 9); g.globalAlpha = 1; P([20, 50, 92, 50]); g.lineWidth = 3; g.stroke(); break;
    case 'bounce': g.beginPath(); g.ellipse(50, 80, 34, 8, 0, 0, 7); g.fill(); P([30, 70, 42, 30, 58, 70, 70, 30]); g.stroke(); break;
    case 'speed': g.beginPath(); g.ellipse(50, 80, 38, 8, 0, 0, 7); g.fill(); for (let i = 0; i < 3; i++) { P([20 + i * 22, 30, 36 + i * 22, 50, 20 + i * 22, 70]); g.stroke(); } break;
    case 'platform': g.fillRect(24, 58, 52, 12); P([14, 40, 86, 40]); g.lineWidth = 4; g.setLineDash([6, 8]); g.stroke(); g.setLineDash([]); P([76, 32, 86, 40, 76, 48]); g.stroke(); break;
    case 'eye': g.beginPath(); g.ellipse(50, 50, 38, 22, 0, 0, 7); g.stroke(); g.beginPath(); g.arc(50, 50, 10, 0, 7); g.fill(); break;
  }
  g.restore();
}
export function iconCanvas(kind, px = 64, fg = '#11161a', bg = '#eef0ec') { const c = cnv(px); drawIcon(c.getContext('2d'), kind, 0, 0, px, fg, bg); return c; }

// In-world trial sign: number, name, progress ticks and pictograms.
export function signTexture(num, total, name, icons) {
  const w = 512, h = 1024, c = cnv(w, h), g = c.getContext('2d');
  g.fillStyle = '#eceee9'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#11161a'; g.font = '600 30px "IBM Plex Mono", monospace'; g.fillText('HINGE LABORATORIES', 36, 64);
  g.fillRect(36, 84, w - 72, 3);
  g.font = '700 300px "IBM Plex Sans", system-ui, sans-serif'; g.fillText(String(num).padStart(2, '0'), 20, 360);
  g.font = '500 34px "IBM Plex Mono", monospace'; g.fillText(`/ ${String(total).padStart(2, '0')}`, 380, 360);
  for (let i = 0; i < total; i++) { g.fillStyle = i < num ? '#11161a' : '#c5c9c4'; g.fillRect(36 + i * ((w - 72) / total), 392, (w - 72) / total - 5, 14); }
  g.fillStyle = '#11161a'; g.font = '700 46px "IBM Plex Sans", system-ui, sans-serif';
  const words = name.split(' '); let line = '', yy = 480;
  for (const wd of words) { if (g.measureText(line + wd).width > w - 72) { g.fillText(line, 36, yy); yy += 52; line = ''; } line += wd + ' '; }
  g.fillText(line, 36, yy);
  g.fillRect(36, 600, w - 72, 3);
  icons.slice(0, 8).forEach((k, i) => drawIcon(g, k, 36 + (i % 4) * 112, 640 + Math.floor(i / 4) * 116, 96, '#eceee9', '#11161a'));
  g.fillStyle = '#6b716c'; g.font = '500 22px "IBM Plex Mono", monospace'; g.fillText('EVALUATION IN PROGRESS', 36, 960);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Small repeating hazard stripe, for edges of pits and acid.
export function hazardStripe() {
  const c = cnv(128, 32), g = c.getContext('2d');
  g.fillStyle = '#1b1d1f'; g.fillRect(0, 0, 128, 32); g.fillStyle = '#e8b21c';
  for (let i = -1; i < 5; i++) { g.beginPath(); g.moveTo(i * 32, 32); g.lineTo(i * 32 + 16, 32); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 16, 0); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// Soft round sprite for particles.
export function dotSprite() {
  const c = cnv(64), g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
