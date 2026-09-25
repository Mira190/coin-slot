// Island layout as plain data + math (no three.js), so tools can preview it top-down.
// World: metres, x east, z south (so north is -z). The coast road is one closed loop.

// control points of the loop, running clockwise seen from above (west coast heading north first)
export const CTRL = [
  [-300, 150], [-322, 40], [-315, -70], [-282, -160], // west beach (sunset side)
  [-220, -232], [-150, -270],                         // boardwalk
  [-70, -292], [10, -300], [85, -286],                // town & harbour
  [160, -250], [225, -190],                           // climb
  [282, -105], [306, -10],                            // lighthouse point
  [296, 85], [252, 170],                              // cliffs
  [170, 240], [70, 282], [-40, 288],                  // pines & south dunes
  [-150, 262], [-240, 218],                           // south-west beach
];

// centripetal Catmull-Rom on a closed polygon
function crPoint(P, i, t) {
  const n = P.length, p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
  const a = 0.5, d = (u, v) => Math.pow(Math.hypot(v[0] - u[0], v[1] - u[1]), a) || 1e-4;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t, out = [0, 0];
  for (let k = 0; k < 2; k++) {
    const A1 = (t1 - tt) / (t1 - t0) * p0[k] + (tt - t0) / (t1 - t0) * p1[k];
    const A2 = (t2 - tt) / (t2 - t1) * p1[k] + (tt - t1) / (t2 - t1) * p2[k];
    const A3 = (t3 - tt) / (t3 - t2) * p2[k] + (tt - t2) / (t3 - t2) * p3[k];
    const B1 = (t2 - tt) / (t2 - t0) * A1 + (tt - t0) / (t2 - t0) * A2;
    const B2 = (t3 - tt) / (t3 - t1) * A2 + (tt - t1) / (t3 - t1) * A3;
    out[k] = (t2 - tt) / (t2 - t1) * B1 + (tt - t1) / (t2 - t1) * B2;
  }
  return out;
}

// dense, arc-length-uniform samples (~1 m apart)
function sampleLoop() {
  const raw = [];
  for (let i = 0; i < CTRL.length; i++) for (let k = 0; k < 60; k++) raw.push(crPoint(CTRL, i, k / 60));
  const cum = [0];
  for (let i = 1; i <= raw.length; i++) { const a = raw[i - 1], b = raw[i % raw.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[cum.length - 1], N = Math.round(L), out = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i / N * L; while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j]), a = raw[j], b = raw[(j + 1) % raw.length];
    out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, s });
  }
  for (let i = 0; i < N; i++) {
    const a = out[(i - 1 + N) % N], b = out[(i + 1) % N], p = out[i];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz);
    p.tx = tx / l; p.tz = tz / l;
    // clockwise loop seen from above with x right, z down => the sea is on the left of travel;
    // outward (seaward) normal = rotate tangent by -90° in the x/z plane
    p.nx = p.tz; p.nz = -p.tx;
  }
  // make sure the normal really points away from the island centre
  let flip = 0; for (const p of out) flip += Math.sign(p.nx * p.x + p.nz * p.z);
  if (flip < 0) for (const p of out) { p.nx = -p.nx; p.nz = -p.nz; }
  // curvature (signed, 1/m) for lean and camera work
  for (let i = 0; i < N; i++) {
    const a = out[(i - 3 + N) % N], b = out[(i + 3) % N];
    out[i].k = ((b.tx - a.tx) * out[i].nz - (b.tz - a.tz) * out[i].nx) / 6 * -1;
  }
  return { pts: out, L };
}
const S = sampleLoop();
export const ROAD = S.pts;
export const LOOP_LEN = S.L;
export const ROAD_W = 6.6;

// stretches along the loop as fractions of the length (computed from control point indices)
const idxFrac = (i) => i / CTRL.length; // control points are ~evenly spaced in arc length
export const STRETCH = {
  beach: [idxFrac(0), idxFrac(3.6)],
  boardwalk: [idxFrac(3.6), idxFrac(5.9)],
  town: [idxFrac(5.9), idxFrac(9.2)],
  climb: [idxFrac(9.2), idxFrac(10.8)],
  lighthouse: [idxFrac(10.8), idxFrac(12.6)],
  cliffs: [idxFrac(12.6), idxFrac(14.8)],
  pines: [idxFrac(14.8), idxFrac(17.6)],
  south: [idxFrac(17.6), 1],
};
export function zoneAt(f) {
  f = ((f % 1) + 1) % 1;
  for (const k in STRETCH) { const [a, b] = STRETCH[k]; if (f >= a && f < b) return k; }
  return 'beach';
}
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// smooth bump between fractions a..b with ramps of width r
const band = (f, a, b, r) => sm(a - r, a, f) * (1 - sm(b, b + r, f));

// road elevation above sea level along the loop
export function roadHeight(f) {
  f = ((f % 1) + 1) % 1;
  const [ca, cb] = [STRETCH.climb[0], STRETCH.cliffs[1]];
  let h = 2.6;
  h += 0.8 * band(f, STRETCH.boardwalk[0], STRETCH.boardwalk[1], 0.02);        // boardwalk deck
  h += 1.2 * band(f, STRETCH.town[0], STRETCH.town[1], 0.03);                  // quay level
  h += 12.5 * band(f, ca + 0.03, cb - 0.02, 0.07);                              // headland and cliffs
  h += 3.5 * band(f, STRETCH.pines[0], STRETCH.pines[1] - 0.05, 0.05);         // dunes and pines
  return h;
}

// nearest road sample to (x,z) (brute force with a coarse stride, then refine)
export function nearestRoad(x, z, hint = -1) {
  const N = ROAD.length;
  let best = 1e18, bi = 0;
  if (hint >= 0) {
    for (let d = -40; d <= 40; d++) { const i = (hint + d + N) % N, p = ROAD[i], q = (p.x - x) ** 2 + (p.z - z) ** 2; if (q < best) { best = q; bi = i; } }
    return bi;
  }
  for (let i = 0; i < N; i += 8) { const p = ROAD[i], q = (p.x - x) ** 2 + (p.z - z) ** 2; if (q < best) { best = q; bi = i; } }
  for (let d = -8; d <= 8; d++) { const i = (bi + d + N) % N, p = ROAD[i], q = (p.x - x) ** 2 + (p.z - z) ** 2; if (q < best) { best = q; bi = i; } }
  return bi;
}

// landmarks
export const LIGHTHOUSE = { x: 336, z: -58, h: 24 };
export const CHAPEL = { x: 20, z: -238 };

// signed distance to the road centre (+ seaward) and nearest sample index
export function roadDist(x, z, hint) {
  let i = nearestRoad(x, z, hint);
  // a stale hint can lock onto the wrong stretch far from the road: re-scan if it looks suspicious
  if (hint >= 0) { const p = ROAD[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 > 400) i = nearestRoad(x, z, -1); }
  const p = ROAD[i];
  const dx = x - p.x, dz = z - p.z;
  return { i, d: dx * p.nx + dz * p.nz, along: dx * p.tx + dz * p.tz };
}

// value noise (deterministic)
const hsh = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hsh(xi, yi), b = hsh(xi + 1, yi), c = hsh(xi, yi + 1), d = hsh(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, y, o = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vn(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }

// terrain height from the signed road distance d (+ seaward) at loop fraction f
export function terrainAt(x, z, d, f) {
  const rh = roadHeight(f), zone = zoneAt(f);
  const shoulder = ROAD_W / 2 + 1.5;
  const n = fbm2(x * 0.012, z * 0.012, 5), n2 = fbm2(x * 0.05 + 7, z * 0.05, 3);
  const cliff = band(f, STRETCH.climb[1] - 0.01, STRETCH.cliffs[1], 0.02);
  const quay = band(f, STRETCH.town[0] + 0.01, STRETCH.town[1] - 0.02, 0.01);
  if (d > -shoulder && d < shoulder) return rh - 0.05 - 0.05 * Math.max(0, Math.abs(d) - ROAD_W / 2);
  if (d >= shoulder) {
    // seaward: beach / quay wall / cliff, all meeting the same shelf further out
    const e = d - shoulder;
    const beachW = 30 + 14 * n;
    const shelf = -Math.min(16, 0.25 + Math.max(0, e - beachW) * 0.11);
    let h = Math.max(rh - 0.1 - e * (rh / beachW) + (n2 - 0.5) * 0.4, shelf);
    const cliffH = rh - Math.pow(Math.max(0, e - 2), 1.3) * 1.4 + (n2 - 0.5) * 2.5;
    h += (Math.max(cliffH, shelf - 2 * (1 - sm(40, 140, e))) - h) * cliff;
    const quayH = e < 5 ? rh - 0.15 : -3.5 + (shelf + 3.5) * sm(15, 80, e);
    h += (quayH - h) * quay;
    // the lighthouse sits on a rocky spur
    const lx = x - LIGHTHOUSE.x, lz = z - LIGHTHOUSE.z, ld = Math.hypot(lx, lz);
    if (ld < 60) h = Math.max(h, (rh + 1.5) * (1 - sm(26, 60, ld)) + (n2 - 0.5) * 3 * (1 - sm(26, 60, ld)));
    return h;
  }
  // inland: hills rising towards the island centre
  const e = -d - shoulder;
  const rise = 1 - Math.exp(-e / 40);
  const cr = Math.hypot(x, z), core = Math.max(0, 1 - cr / 280);
  // near the road the ground follows the road; deeper inland it is a road-independent hill field
  // (so there is no crease where two stretches of road are equally near)
  const near = rh + rise * (4 + 10 * n);
  // a big central peak, a ridge to the north-east and broad undulation: relief that reads from the sea
  const ridge = Math.exp(-(((x - 90) * 0.7 + (z + 60) * 0.7) ** 2) / (2 * 55 * 55)) * Math.max(0, 1 - Math.hypot(x - 60, z + 90) / 230);
  const macro = fbm2(x * 0.004 + 11, z * 0.004 - 3, 3);
  const hill = 10 + 78 * Math.pow(core, 1.7) + 34 * ridge + 18 * n + 22 * (macro - 0.5) * core;
  let h = near + (Math.max(hill, rh + 3) - near) * sm(12, 110, e);
  h += (n2 - 0.5) * 1.2 * Math.min(1, e / 6);
  // the town terraces are flatter
  const town = band(f, STRETCH.town[0], STRETCH.town[1], 0.02) * (1 - sm(40, 90, e));
  h = h * (1 - town * 0.6) + (rh + rise * 6) * town * 0.6;
  return h;
}
