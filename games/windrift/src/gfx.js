// Shared graphics helpers: seeded RNG, value noise, canvas textures, geometry-from-arrays.
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// 2D value noise + fbm (deterministic)
const P = new Uint8Array(512);
{ const r = rng(1337); const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const fade = (t) => t * t * (3 - 2 * t);
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => P[(P[(a & 255)] + (b & 255)) & 511] / 255;
  const u = fade(xf), v = fade(yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += noise2(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export function canvasTex(w, h, draw, opt = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  draw(c, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = opt.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opt.aniso || 8;
  if (opt.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (opt.nomip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.userData.canvas = cv;
  return t;
}

// speckled noise fill for surfaces
export function speckle(c, w, h, base, amt, n, seed = 1) {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const v = (r() - 0.5) * amt;
    c.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    const s = 1 + r() * 2.5;
    c.fillRect(r() * w, r() * h, s, s);
  }
}

export function meshFromArrays(pos, idx, opt = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (opt.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(opt.uv, 2));
  if (opt.color) g.setAttribute('color', new THREE.Float32BufferAttribute(opt.color, 3));
  g.setIndex(idx);
  if (opt.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(opt.normal, 3));
  else g.computeVertexNormals();
  return g;
}

// radial soft sprite (for particles, glows, light pools)
let _soft = null;
export function softTex() {
  if (_soft) return _soft;
  _soft = canvasTex(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, { nomip: false });
  return _soft;
}

export function textTex(lines, o = {}) {
  const w = o.w || 512, h = o.h || 128;
  return canvasTex(w, h, (c) => {
    if (o.bg) { c.fillStyle = o.bg; c.fillRect(0, 0, w, h); }
    if (o.border) { c.strokeStyle = o.border; c.lineWidth = o.bw || 8; c.strokeRect(4, 4, w - 8, h - 8); }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    lines.forEach((L, i) => {
      c.font = L.font; c.fillStyle = L.color || '#fff';
      if (L.glow) { c.shadowColor = L.glow; c.shadowBlur = L.blur || 18; } else c.shadowBlur = 0;
      c.fillText(L.text, w / 2 + (L.dx || 0), L.y != null ? L.y : h / 2);
    });
  }, o);
}

export const FONT_ZH = '"ZCOOL QingKe HuangYou","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
export const FONT_EN = '"Russo One","Arial Black",sans-serif';

export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
