// Track geometry, pure JS (no three.js) so the Node/draft tools can import it too.
// A layout is a turtle path: straights ['S', len, opts] and constant-radius arcs ['T', deg, radius, opts]
// (+deg = left). Two straights marked `adj` are stretched so the loop closes exactly. The loop is sampled
// every ~DS units; shortcut branches are centripetal Catmull-Rom curves that leave and rejoin it tangentially.
// Heading h: forward = (sin h, cos h) in (x, z); left normal = (cos h, -sin h). +yaw turns left.

export const DS = 2;
export const F = { TUN: 1, BRG: 2, ICE: 4, GAP: 8, RAMP: 16, PAD: 32, SAND: 64 };
const TAU = Math.PI * 2;
const smooth = (t) => t * t * (3 - 2 * t);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function norm(p) {
  if (p[0] === 'S') return { k: 'S', len: p[1], turn: 0, o: p[2] || {} };
  const turn = (p[1] * Math.PI) / 180;
  return { k: 'T', len: Math.abs(turn) * p[2], turn, r: p[2], o: p[3] || {} };
}

function walk(def, pieces) {
  const S = { x: [], z: [], y: [], h: [], w: [], fl: [] };
  let x = def.x0 || 0, z = def.z0 || 0, h = def.h0 || 0, y = def.y0 || 0, w = def.w || 18;
  pieces.forEach((p) => {
    const n = Math.max(1, Math.round(p.len / DS)), step = p.len / n, k = p.turn / p.len;
    const y0 = p.o.y0 != null ? p.o.y0 : y, y1 = p.o.y != null ? p.o.y : y0, w1 = p.o.w != null ? p.o.w : w, w0 = w;
    let fl = 0;
    if (p.o.tunnel) fl |= F.TUN;
    if (p.o.bridge) fl |= F.BRG;
    if (p.o.ice) fl |= F.ICE;
    if (p.o.gap) fl |= F.GAP;
    if (p.o.sand) fl |= F.SAND;
    p.start = S.x.length; p.n = n; p.h = h; p.x = x; p.z = z;
    for (let j = 0; j < n; j++) {
      const t = j / n;
      S.x.push(x); S.z.push(z); S.h.push(h); S.fl.push(fl);
      S.y.push(y0 + (y1 - y0) * smooth(t)); S.w.push(w0 + (w1 - w0) * smooth(t));
      if (k === 0) { x += Math.sin(h) * step; z += Math.cos(h) * step; }
      else { const h2 = h + k * step; x += (Math.cos(h) - Math.cos(h2)) / k; z += (Math.sin(h2) - Math.sin(h)) / k; h = h2; }
    }
    y = y1; w = w1;
  });
  return { S, end: { x, z, h, y } };
}

// Corner-vertex layouts: verts [x, z, r, opts] around a closed polygon, each corner filleted with radius r.
// opts: y (height at the corner), a (flags for the arc), s (flags for the straight to the next corner; range
// flags like bridge:[0.2,0.8] split it), start: frac (start line on this straight). Converted to turtle pieces.
function fromVerts(def) {
  const V = def.verts, n = V.length, head = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
  const wrapA = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const turn = V.map((v, i) => wrapA(head(v, V[(i + 1) % n]) - head(V[(i - 1 + n) % n], v)));
  const tan = V.map((v, i) => (v[2] || 0) * Math.tan(Math.abs(turn[i]) / 2));
  const pieces = [], warn = [], segMap = V.map(() => []), cornerMap = [];
  let si = V.findIndex((v) => v[3] && v[3].start != null); if (si < 0) si = 0;
  const sf = (V[si][3] && V[si][3].start) || 0.3;
  // piece order: straight after corner si (from the start line), corners/straights around, then the part of the
  // straight after si before the start line.
  const straight = (i, from, to) => {
    const a = V[i], b = V[(i + 1) % n], o = a[3] || {}, s = o.s || {};
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) - tan[i] - tan[(i + 1) % n];
    if (L < 0) warn.push(`corner ${i}->${(i + 1) % n} overlap ${L.toFixed(1)}`);
    const yA = (a[3] && a[3].y) || 0, yB = (b[3] && b[3].y) || 0;
    // cut points: range flag edges, drops, and the start line
    const cuts = new Set([from, to]);
    for (const k in s) if (Array.isArray(s[k]) && k !== 'pads' && k !== 'box' && k !== 'jump' && k !== 'drop') s[k].forEach((f) => { if (f > from && f < to) cuts.add(f); });
    if (s.drop && s.drop[0] > from && s.drop[0] < to) cuts.add(s.drop[0]);
    const cs = [...cuts].sort((p, q) => p - q);
    for (let c = 0; c < cs.length - 1; c++) {
      const f0 = cs[c], f1 = cs[c + 1], len = L * (f1 - f0);
      if (len < 0.5) continue;
      const po = { y: yA + (yB - yA) * f1 };
      for (const k of ['tunnel', 'bridge', 'ice', 'gap', 'sand']) {
        const v = s[k]; if (!v) continue;
        if (v === true || v === 1 || (Array.isArray(v) && f0 >= v[0] - 1e-9 && f1 <= v[1] + 1e-9)) po[k] = 1;
      }
      if (s.drop && Math.abs(s.drop[0] - f0) < 1e-9) po.y0 = yA + (yB - yA) * f0 - s.drop[1];
      const inR = (f) => f >= f0 - 1e-9 && f < f1 - 1e-9;
      po.pads = (s.pads || []).filter(([f]) => inR(f)).map(([f, lat]) => [(f - f0) / (f1 - f0), lat]);
      po.box = (s.box || []).filter((f) => inR(f)).map((f) => (f - f0) / (f1 - f0));
      const js = s.jump != null ? (Array.isArray(s.jump) ? s.jump : [s.jump]) : null;
      if (js && js[0] > f0 + 1e-9 && js[0] <= f1 + 1e-9) po.jump = [(js[0] - f0) / (f1 - f0), js[1], js[2]];
      if (c === 0 && from === 0 && o.label != null) po.label = o.label;
      segMap[i].push({ pi: pieces.length, f0, f1 });
      pieces.push(['S', len, po]);
    }
    if (o.s && o.s.adj) pieces[pieces.length - 1][2].adj = 1;
  };
  const corner = (i) => {
    const v = V[i], o = v[3] || {};
    if (!v[2] || Math.abs(turn[i]) < 1e-4) return;
    cornerMap[i] = pieces.length;
    pieces.push(['T', (turn[i] * 180) / Math.PI, v[2], Object.assign({ y: o.y || 0, label: o.label }, o.a || {})]);
  };
  straight(si, sf, 1);
  for (let k = 1; k <= n; k++) { const i = (si + k) % n; corner(i); if (k < n) straight(i, 0, 1); }
  straight(si, 0, sf);
  // heading at the start line
  const a = V[si], b = V[(si + 1) % n], h0 = head(a, b), L0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d = tan[si] + (L0 - tan[si] - tan[(si + 1) % n]) * sf;
  const y0 = ((a[3] && a[3].y) || 0) + ((((b[3] && b[3].y) || 0) - ((a[3] && a[3].y) || 0)) * sf);
  return { pieces, x0: a[0] + Math.sin(h0) * d, z0: a[1] + Math.cos(h0) * d, h0, y0, warn, segMap, cornerMap };
}

// Build a closed main loop from a layout; returns { path, pieces, closure }.
function buildMain(def) {
  let vv = null;
  if (def.verts) {
    vv = fromVerts(def);
    def = Object.assign({}, def, { pieces: vv.pieces, x0: vv.x0, z0: vv.z0, h0: vv.h0, y0: vv.y0 });
  }
  const pieces = def.pieces.map(norm);
  let r = walk(def, pieces);
  const ex = r.end.x - (def.x0 || 0), ez = r.end.z - (def.z0 || 0);
  const adj = pieces.filter((p) => p.o.adj);
  let closure = { ok: true, a: 0, b: 0, heading: 0 };
  const dh = r.end.h - (def.h0 || 0);
  closure.heading = ((dh % TAU) + TAU) % TAU; if (closure.heading > Math.PI) closure.heading -= TAU;
  if (adj.length === 2) {
    const [A, B] = adj, dax = Math.sin(A.h), daz = Math.cos(A.h), dbx = Math.sin(B.h), dbz = Math.cos(B.h);
    const det = dax * dbz - dbx * daz;
    if (Math.abs(det) < 1e-3) closure.ok = false;
    else {
      const a = (-ex * dbz + dbx * ez) / det, b = (-dax * ez + ex * daz) / det;
      A.len += a; B.len += b; closure.a = a; closure.b = b;
      if (A.len < 4 || B.len < 4) closure.ok = false;
      r = walk(def, pieces);
    }
  } else closure.ok = !!vv;
  closure.warn = vv ? vv.warn : [];
  closure.gap = Math.hypot(r.end.x - (def.x0 || 0), r.end.z - (def.z0 || 0));
  closure.dy = r.end.y - (def.y0 || 0);
  const path = finish(r.S, true);
  path.id = 0; path.kind = 'main';
  // features
  const at = (pi, f) => { const p = pieces[pi]; return (p.start + Math.round(clamp(f, 0, 1) * p.n)) % path.n; };
  // branch anchors: piece index for turtle layouts, [vertex, frac] of the straight after that corner for verts
  path.at = !vv ? at : (vi, f) => {
    if (typeof vi === 'string') return at(vv.cornerMap[+vi.slice(1)], f);
    const segs = vv.segMap[vi];
    const g = segs.find((q) => f >= q.f0 - 1e-9 && f <= q.f1 + 1e-9) || segs[0];
    return at(g.pi, (f - g.f0) / (g.f1 - g.f0));
  };
  const pads = [], boxes = [], jumps = [], signs = [];
  pieces.forEach((p, pi) => {
    const o = p.o;
    (o.pads || []).forEach(([f, lat]) => pads.push({ path: 0, i: at(pi, f), lat }));
    (o.box || []).forEach((f) => boxes.push({ path: 0, i: at(pi, f) }));
    if (o.jump != null) {
      const j = Array.isArray(o.jump) ? o.jump : [o.jump];
      // the lip is the last sample of the piece (a drop, if any, starts on the next piece)
      jumps.push({ path: 0, i: (p.start + Math.min(p.n - 1, Math.round(clamp(j[0], 0, 1) * p.n))) % path.n, h: j[1] || 1.6, len: j[2] || 10 });
    }
    if (o.sign) signs.push({ path: 0, i: at(pi, 0), dir: Math.sign(p.turn) || 1 });
  });
  return { path, pieces, closure, pads, boxes, jumps, signs };
}

// Per-path derived arrays from raw samples.
function finish(S, closed) {
  const n = S.x.length;
  const P = {
    closed, n,
    x: Float32Array.from(S.x), z: Float32Array.from(S.z), y: Float32Array.from(S.y),
    hw: Float32Array.from(S.w, (w) => w / 2), fl: Uint8Array.from(S.fl),
    tx: new Float32Array(n), tz: new Float32Array(n), nx: new Float32Array(n), nz: new Float32Array(n),
    s: new Float32Array(n), kap: new Float32Array(n), line: new Float32Array(n), rad: new Float32Array(n),
    prog: new Float32Array(n), near: new Array(n).fill(null)
  };
  const idx = (i) => (closed ? (i + n) % n : clamp(i, 0, n - 1));
  for (let i = 0; i < n; i++) {
    const a = idx(i - 1), b = idx(i + 1);
    let dx = P.x[b] - P.x[a], dz = P.z[b] - P.z[a];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    P.tx[i] = dx; P.tz[i] = dz; P.nx[i] = dz; P.nz[i] = -dx;
    if (i > 0) P.s[i] = P.s[i - 1] + Math.hypot(P.x[i] - P.x[i - 1], P.z[i] - P.z[i - 1]);
  }
  P.len = P.s[n - 1] + (closed ? Math.hypot(P.x[0] - P.x[n - 1], P.z[0] - P.z[n - 1]) : 0);
  for (let i = 0; i < n; i++) {
    const a = idx(i - 2), b = idx(i + 2);
    const ha = Math.atan2(P.tx[a], P.tz[a]), hb = Math.atan2(P.tx[b], P.tz[b]);
    let d = hb - ha; d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
    P.kap[i] = d / (4 * DS);
  }
  return P;
}

export const wrap = (P, i) => (P.closed ? ((i % P.n) + P.n) % P.n : clamp(i, 0, P.n - 1));

// ---- branches -------------------------------------------------------------------------------
function catmull(pts, spp) {
  // centripetal Catmull-Rom through pts (with phantom ends already included); returns dense [x,z,y,t]
  const out = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < spp; k++) {
      const t = t1 + ((t2 - t1) * k) / spp;
      const L = (a, b, ta, tb) => a.map((v, j) => j < 2 ? ((tb - t) * v + (t - ta) * b[j]) / (tb - ta) : 0);
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3), C = L(B1, B2, t1, t2);
      const u = k / spp;
      out.push([C[0], C[1], p1[2] + (p2[2] - p1[2]) * smooth(u)]);
    }
  }
  const last = pts[pts.length - 2]; out.push([last[0], last[1], last[2]]);
  return out;
}

function buildBranch(main, b, id) {
  const M = main.path, at = M.at;
  const pt = ([pi, f, lat = 0, y]) => {
    const i = at(pi, f);
    return [M.x[i] + M.nx[i] * lat, M.z[i] + M.nz[i] * lat, y != null ? y : M.y[i], i];
  };
  const A = pt(b.from), B = pt(b.to), vias = (b.via || []).map(pt);
  const ia = A[3], ib = B[3];
  const k = b.tan || 30;
  const pts = [
    [A[0] - M.tx[ia] * k, A[1] - M.tz[ia] * k, A[2]], A, ...vias, B, [B[0] + M.tx[ib] * k, B[1] + M.tz[ib] * k, B[2]]
  ];
  const dense = catmull(pts, 60);
  // resample by arc length at DS
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum[cum.length - 1], n = Math.max(2, Math.round(total / DS) + 1);
  const S = { x: [], z: [], y: [], h: [], w: [], fl: [] };
  let j = 0;
  let fl = 0;
  if (b.tunnel === true || b.tunnel === 1) fl |= F.TUN;
  if (b.bridge === true || b.bridge === 1) fl |= F.BRG;
  if (b.ice === true || b.ice === 1) fl |= F.ICE;
  if (b.sand) fl |= F.SAND;
  for (let s = 0; s < n; s++) {
    const target = (total * s) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const u = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    const p = dense[j], q = dense[j + 1];
    S.x.push(p[0] + (q[0] - p[0]) * u); S.z.push(p[1] + (q[1] - p[1]) * u); S.y.push(p[2] + (q[2] - p[2]) * u);
    S.h.push(0); S.w.push(b.w || 10);
    // range flags on a branch: tunnel: [0.3, 0.7] covers that fraction of its length
    let f2 = fl;
    const fr = s / (n - 1);
    for (const [key, bit] of [['tunnel', F.TUN], ['bridge', F.BRG], ['ice', F.ICE]]) if (Array.isArray(b[key])) f2 = (fr >= b[key][0] && fr <= b[key][1]) ? f2 | bit : f2 & ~bit;
    S.fl.push(f2);
  }
  const P = finish(S, false);
  P.id = id; P.kind = b.kind || 'shortcut'; P.from = ia; P.to = ib; P.def = b;
  const N = M.n, span = ((ib - ia) % N + N) % N;
  for (let i = 0; i < P.n; i++) P.prog[i] = ia + (span * P.s[i]) / P.len;
  return P;
}

// ---- queries --------------------------------------------------------------------------------
export function nearestLocal(P, x, z, guess, range) {
  let best = guess, bd = Infinity;
  for (let k = -range; k <= range; k++) {
    const i = wrap(P, guess + k), dx = x - P.x[i], dz = z - P.z[i], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
export function nearestGlobal(P, x, z, yHint) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < P.n; i++) {
    const dx = x - P.x[i], dz = z - P.z[i], dy = yHint == null ? 0 : (yHint - P.y[i]) * 3, d = dx * dx + dz * dz + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
// lateral offset (+ = left) and fractional position along sample i
export function lateral(P, i, x, z) { return (x - P.x[i]) * P.nx[i] + (z - P.z[i]) * P.nz[i]; }
export function along(P, i, x, z) { return (x - P.x[i]) * P.tx[i] + (z - P.z[i]) * P.tz[i]; }
export function heightAt(P, i, x, z) {
  const a = along(P, i, x, z);
  const j = a >= 0 ? wrap(P, i + 1) : wrap(P, i - 1);
  if (j === i) return P.y[i];
  const seg = Math.hypot(P.x[j] - P.x[i], P.z[j] - P.z[i]) || DS;
  const f = clamp(Math.abs(a) / seg, 0, 1);
  // a step (drop) between samples is kept sharp: take the nearer side
  if (Math.abs(P.y[j] - P.y[i]) > 1.2) return f < 0.5 ? P.y[i] : P.y[j];
  return P.y[i] + (P.y[j] - P.y[i]) * f;
}
export function progressOf(T, pathId, i, x, z) {
  const P = T.paths[pathId];
  const a = along(P, i, x, z) / DS;
  if (pathId === 0) return i + a;
  const j = wrap(P, i + 1);
  return P.prog[i] + (P.prog[j] - P.prog[i]) * clamp(a, -1, 1);
}

// ---- racing line (elastic band) + corner radius ----------------------------------------------
function racingLine(P, margin, pinA, pinB) {
  const n = P.n, L = P.line;
  const lim = (i) => Math.max(0, P.hw[i] - margin);
  L.fill(0);
  const qx = new Float32Array(n), qz = new Float32Array(n);
  for (const k of [16, 10, 6, 3]) {
    for (let it = 0; it < 70; it++) {
      for (let i = 0; i < n; i++) { qx[i] = P.x[i] + P.nx[i] * L[i]; qz[i] = P.z[i] + P.nz[i] * L[i]; }
      for (let i = 0; i < n; i++) {
        if (!P.closed && (i < 3 || i > n - 4)) continue;
        const a = wrap(P, i - k), b = wrap(P, i + k);
        const mx = (qx[a] + qx[b]) / 2, mz = (qz[a] + qz[b]) / 2;
        const t = (mx - P.x[i]) * P.nx[i] + (mz - P.z[i]) * P.nz[i];
        L[i] = clamp(L[i] + (t - L[i]) * 0.5, -lim(i), lim(i));
      }
    }
  }
  // branch ends continue the loop's line, but only within the branch's own width (a wider pin put the line outside
  // a narrow shortcut and faked a hairpin at its mouth)
  if (!P.closed) { for (let i = 0; i < 3; i++) { L[i] = clamp(pinA || 0, -lim(i), lim(i)); L[n - 1 - i] = clamp(pinB || 0, -lim(n - 1 - i), lim(n - 1 - i)); } }
  // radius of the racing line
  for (let i = 0; i < n; i++) {
    const a = wrap(P, i - 4), b = wrap(P, i + 4);
    const ax = P.x[a] + P.nx[a] * L[a], az = P.z[a] + P.nz[a] * L[a];
    const bx = P.x[i] + P.nx[i] * L[i], bz = P.z[i] + P.nz[i] * L[i];
    const cx = P.x[b] + P.nx[b] * L[b], cz = P.z[b] + P.nz[b] * L[b];
    const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
    const cross = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    P.rad[i] = cross < 1e-6 ? 9999 : Math.min(9999, (ab * bc * ca) / (2 * cross));
  }
}

// ---- junctions: which samples overlap another path (for transfers and wall openings) --------------
function linkPaths(paths) {
  for (const P of paths) {
    P.openL = new Uint8Array(P.n); P.openR = new Uint8Array(P.n);
    for (const Q of paths) {
      if (Q === P) continue;
      for (let i = 0; i < P.n; i++) {
        // cheap reject
        let best = -1, bd = Infinity;
        for (let j = 0; j < Q.n; j += 2) {
          const dx = P.x[i] - Q.x[j], dz = P.z[i] - Q.z[j], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = j; }
        }
        const reach = P.hw[i] + Q.hw[best] + 6;
        if (bd > reach * reach) continue;
        const j = nearestLocal(Q, P.x[i], P.z[i], best, 3);
        if (Math.abs(P.y[i] - Q.y[j]) > 2.5) continue;
        (P.near[i] || (P.near[i] = [])).push(Q.id);
        for (const side of [1, -1]) {
          const wx = P.x[i] + P.nx[i] * side * (P.hw[i] + 0.6), wz = P.z[i] + P.nz[i] * side * (P.hw[i] + 0.6);
          const jj = nearestLocal(Q, wx, wz, j, 8);
          const lat = lateral(Q, jj, wx, wz), al = Math.abs(along(Q, jj, wx, wz));
          const endOk = Q.closed || (jj > 0 && jj < Q.n - 1) || al < DS;
          if (Math.abs(lat) < Q.hw[jj] + 0.3 && endOk) (side > 0 ? P.openL : P.openR)[i] = 1;
        }
      }
    }
  }
}

export function buildTrack(def) {
  const main = buildMain(def);
  const paths = [main.path];
  (def.branches || []).forEach((b) => paths.push(buildBranch(main, b, paths.length)));
  const M = main.path;
  for (let i = 0; i < M.n; i++) M.prog[i] = i;
  // jump ramps: raise the road before the lip so karts launch off it naturally
  for (const j of main.jumps) {
    const P = paths[j.path], m = Math.round(j.len / DS);
    for (let k = 0; k < m; k++) { const i = wrap(P, j.i - k); P.y[i] += j.h * (1 - k / m); P.fl[i] |= F.RAMP; }
  }
  // branch-local features
  const pads = main.pads.slice(), boxes = main.boxes.slice(), jumps = main.jumps.slice();
  paths.slice(1).forEach((P) => {
    (P.def.pads || []).forEach(([f, lat]) => pads.push({ path: P.id, i: Math.round(f * (P.n - 1)), lat }));
    (P.def.box || []).forEach((f) => boxes.push({ path: P.id, i: Math.round(f * (P.n - 1)) }));
  });
  const padsByPath = paths.map(() => ({}));
  for (const p of pads) {
    const P = paths[p.path];
    // a pad covers ~6 units of road
    for (let k = -1; k <= 1; k++) { const i = wrap(P, p.i + k); P.fl[i] |= F.PAD; (padsByPath[p.path][i] || (padsByPath[p.path][i] = [])).push(p); }
  }
  linkPaths(paths);
  racingLine(M, 3.4);
  paths.slice(1).forEach((P) => racingLine(P, 2.6, M.line[P.from], M.line[P.to]));
  // bounds
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const P of paths) for (let i = 0; i < P.n; i++) {
    x0 = Math.min(x0, P.x[i]); x1 = Math.max(x1, P.x[i]); z0 = Math.min(z0, P.z[i]); z1 = Math.max(z1, P.z[i]);
    y0 = Math.min(y0, P.y[i]); y1 = Math.max(y1, P.y[i]);
  }
  return {
    def, paths, main: M, pieces: main.pieces, closure: main.closure, pads, padsByPath, boxes, jumps, signs: main.signs,
    bounds: { x0, x1, z0, z1, y0, y1 }, N: M.n
  };
}

// Where the loop passes over itself: pairs of far-apart samples closer than the road widths.
export function crossings(T) {
  const out = [], P = T.main, all = T.paths;
  for (const A of all) for (const B of all) {
    if (B.id < A.id) continue;
    for (let i = 0; i < A.n; i += 2) for (let j = 0; j < B.n; j += 2) {
      if (A === B && Math.abs(i - j) < 40 || A === B && A.n - Math.abs(i - j) < 40) continue;
      if (A === B && j <= i) continue;
      const d = Math.hypot(A.x[i] - B.x[j], A.z[i] - B.z[j]);
      if (d < A.hw[i] + B.hw[j] - 1) {
        const dy = Math.abs(A.y[i] - B.y[j]);
        if (A !== B && dy < 2.5 && ((A.near[i] && A.near[i].includes(B.id)))) continue; // junction, not a crossing
        out.push({ a: A.id, i, b: B.id, j, x: A.x[i], z: A.z[i], dy });
      }
    }
  }
  // collapse runs
  const res = [];
  for (const c of out) if (!res.some((r) => r.a === c.a && r.b === c.b && Math.hypot(r.x - c.x, r.z - c.z) < 30)) res.push(c);
  else { const r = res.find((r) => r.a === c.a && r.b === c.b && Math.hypot(r.x - c.x, r.z - c.z) < 30); r.dy = Math.min(r.dy, c.dy); }
  return res;
}
