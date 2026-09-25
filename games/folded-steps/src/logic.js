// Folded Steps: pure rules (no DOM, no three.js). Shared by the game, the editor, the hint worker and tools/.
//
// World: unit cubes on an integer grid; cell (x,y,z) spans ±0.5, so its top face sits at y + 0.5.
// Walkable tiles are cube faces (tops, plus side faces marked as gravity walls) and stair cells.
// Camera: orthographic isometric, looking along -(1,1,1). Points that differ by k·(1,1,1) land on
// the same pixel, so two tiles whose edges meet on screen are joined even when they are far apart
// in depth, provided the seam is really visible. The graph is rebuilt (and cached) per mechanism
// configuration, i.e. every time something snaps.
//
// Time is discrete: a tick moves the player one tile (or waits), then the companion, then sentinels.
// Mechanism snaps and companion orders happen between ticks.

export const HEAD = -2; // the companion's flat head: a walkable tile that travels with it
const ONE = [1, 1, 1];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-6;
const rnd = (v) => v.map((x) => Math.round(x));
export const FACE = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
export const faceName = (n) => (n[0] ? (n[0] > 0 ? '+x' : '-x') : n[1] ? (n[1] > 0 ? '+y' : '-y') : n[2] > 0 ? '+z' : '-z');
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function rot(axis, q) {
  q = ((q % 4) + 4) % 4;
  const c = [1, 0, -1, 0][q], s = [0, 1, 0, -1][q];
  return axis === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : axis === 'y' ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
}
export const mv = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const mm = (A, B) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]); return o; };
// an affine pose maps p -> M·p + t
const about = (M, pivot, off = [0, 0, 0]) => ({ M, t: add(sub(pivot, mv(M, pivot)), off) });
const compose = (W, P) => ({ M: mm(W.M, P.M), t: add(mv(W.M, P.t), W.t) });
export const xp = (P, p) => add(mv(P.M, p), P.t);
// isometric screen projection (x right, y up); points that differ by k(1,1,1) coincide
export const scr = (v) => [(v[0] - v[2]) * 0.70710678, (2 * v[1] - v[0] - v[2]) * 0.40824829];
const canon = (p) => Math.round(2 * (p[0] - p[1])) * 8192 + Math.round(2 * (p[2] - p[1]));
export const ck = (p) => ((Math.round(p[0]) + 128) * 256 + (Math.round(p[1]) + 128)) * 256 + Math.round(p[2]) + 128;

// ---------- level compile ----------
export function compile(def) {
  const L = { def, groups: [], tiles: [], mechs: [], lifts: [], key: new Map(), cache: new Map() };
  const gid = new Map();
  const fail = (msg) => { throw new Error((def.title || 'level') + ': ' + msg); };
  (def.groups || []).forEach((g, gi) => {
    if (gid.has(g.id)) fail('duplicate group ' + g.id);
    const G = { i: gi, id: g.id, kind: g.kind || 'static', src: g, cells: [] };
    gid.set(g.id, G);
    if (G.kind === 'rotor' || G.kind === 'slider') { G.mi = L.mechs.length; L.mechs.push(G); }
    if (G.kind === 'lift') { G.li = L.lifts.length; L.lifts.push(G); }
    const blocks = g.blocks || [], stairs = g.stairs || [];
    const own = new Set([...blocks, ...stairs].map((b) => ck(b)));
    const grav = new Set((g.walls || []).map((w) => w.slice(0, 3).join(',') + w[3]));
    for (const b of blocks) {
      const cell = b.slice(0, 3);
      G.cells.push(cell);
      if ((b[3] || '').includes('n')) continue;
      for (const F in FACE) {
        const n = FACE[F];
        if (own.has(ck(add(cell, n)))) continue; // buried against a neighbour of the same rigid group
        const t = mk(L, { g: gi, kind: 'face', cell, n, face: F, c: add(cell, mul(n, 0.5)), grav: grav.has(cell.join(',') + F) });
        L.key.set(g.id + ':' + cell.join(',') + (F === '+y' ? '' : ':' + F), t.id);
      }
    }
    for (const s of stairs) {
      const cell = s.slice(0, 3);
      if (!FACE[s[3]] || FACE[s[3]][1]) fail('stair needs a horizontal direction at ' + s);
      G.cells.push(cell);
      const t = mk(L, { g: gi, kind: 'stair', cell, n: [0, 1, 0], d: FACE[s[3]], c: cell });
      L.key.set(g.id + ':' + cell.join(','), t.id);
    }
    L.groups.push(G);
  });
  if (def.world) {
    // whole-level rotation: one crank turns everything about a vertical axis
    L.world = { kind: 'world', id: 'world', mi: L.mechs.length, src: { axis: 'y', cyc: true, ...def.world } };
    L.mechs.push(L.world);
  }
  for (const G of L.mechs) {
    const g = G.src;
    if (G.kind === 'slider') G.dom = range(0, (g.n || 2) - 1);
    else if (g.cyc) G.dom = [0, 1, 2, 3];
    else G.dom = range(g.min ?? 0, g.max ?? 1);
    G.start = g.start || 0;
    if (!G.dom.includes(G.start)) fail('bad start for ' + G.id);
  }
  const ref = (s) => { const id = L.key.get(s); if (id == null) fail('bad tile ' + s); return id; };
  L.ref = ref;
  L.player = ref(def.player);
  L.goal = ref(def.goal);
  L.comp = def.companion ? ref(def.companion) : -1;
  L.glim = def.glimmer ? ref(def.glimmer) : -1;
  L.plates = (def.plates || []).map((p) => ({
    tile: ref(p.tile), latch: !!p.latch,
    lifts: p.lifts.map((id) => { const G = gid.get(id); if (!G || G.li == null) fail('bad lift ' + id); return G.li; }),
  }));
  L.sentinels = [];
  const st0 = { m: L.mechs.map((G) => G.start), lift: L.lifts.map(() => 0) };
  const Gr0 = graph(L, st0.m, st0.lift);
  if (Gr0.conflict) fail('overlapping blocks in the starting configuration');
  for (const s of def.sentinels || []) {
    // a rail is a list of waypoints; the legs between them follow shortest paths in the starting graph
    const way = s.rail.map(ref);
    const rail = [way[0]];
    const legs = s.loop ? [...way.slice(1), way[0]] : way.slice(1);
    for (const w of legs) {
      const leg = bfsPath(Gr0.adj, rail[rail.length - 1], w);
      if (!leg) fail('sentinel rail has no path to ' + w);
      rail.push(...leg.slice(1));
    }
    if (s.loop) rail.pop();
    L.sentinels.push({ rail, loop: !!s.loop, start: s.start || 0, dir: s.dir || 1 });
  }
  return L;
}
const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
function mk(L, t) {
  t.id = L.tiles.length;
  if (t.kind === 'stair') { const h = mul(add(t.d, t.n), 0.5); t.ports = [sub(t.c, h), add(t.c, h)]; }
  else t.ports = facePorts(t.c, t.n);
  L.tiles.push(t);
  return t;
}
function facePorts(c, n) {
  const o = [];
  for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) if (!dot(a, n)) o.push(add(c, mul(a, 0.5)), add(c, mul(a, -0.5)));
  return o;
}

export function pose(L, G, m, lift) {
  const g = G.src;
  let P = { M: I3, t: [0, 0, 0] };
  if (G.kind === 'rotor') P = about(rot(g.axis, m[G.mi]), g.pivot);
  else if (G.kind === 'slider') P = { M: I3, t: mul(g.dir, m[G.mi]) };
  else if (G.kind === 'lift') {
    const p = (g.poses || [])[lift[G.li]] || {};
    P = about(rot(p.axis || 'y', p.q || 0), p.pivot || [0, 0, 0], p.off || [0, 0, 0]);
  }
  if (L.world) P = compose(about(rot('y', m[L.world.mi]), L.world.src.pivot), P);
  return P;
}

// ---------- the visual-adjacency graph for one mechanism configuration ----------
// configurations and states are keyed by mixed-radix numbers (much faster to hash than strings);
// anything that would not fit exactly falls back to a string key
function cfgKey(L, m, lift) {
  let k = 0;
  for (let i = 0; i < m.length; i++) {
    const d = L.mechs[i].dom.indexOf(m[i]);
    if (d < 0) return m.join(',') + '/' + lift.join('');
    k = k * L.mechs[i].dom.length + d;
  }
  for (let i = 0; i < lift.length; i++) k = k * 2 + lift[i];
  return k;
}
export function graph(L, m, lift) {
  const key = cfgKey(L, m, lift);
  let Gr = L.cache.get(key);
  if (Gr) return Gr;
  const P = L.groups.map((G) => pose(L, G, m, lift));
  const occ = new Set(), wedge = new Map(); // stair cells are wedges: solid only below the slope
  let conflict = false, far = -Infinity;
  for (const G of L.groups) for (const c of G.cells) {
    const w = xp(P[G.i], c), k = ck(w);
    if (occ.has(k)) conflict = true;
    occ.add(k);
    far = Math.max(far, w[0] + w[1] + w[2]);
  }
  L.tiles.forEach((t) => { if (t.kind === 'stair') wedge.set(ck(xp(P[t.g], t.cell)), { c: xp(P[t.g], t.cell), d: rnd(mv(P[t.g].M, t.d)), up: rnd(mv(P[t.g].M, t.n)) }); });
  const W = L.tiles.map((t) => {
    const Pg = P[t.g];
    const c = xp(Pg, t.c), n = rnd(mv(Pg.M, t.n)), cell = rnd(xp(Pg, t.cell));
    const up = n[1] === 1;
    let ok = t.kind === 'stair' ? up : up || (t.grav && (n[0] === 1 || n[2] === 1));
    if (ok && t.kind === 'face' && occ.has(ck(add(cell, n)))) ok = false;
    return { c, n, cell, ports: t.ports.map((p) => xp(Pg, p)), active: ok, grav: t.grav, stair: t.kind === 'stair' };
  });
  const buckets = new Map();
  W.forEach((w, i) => {
    if (!w.active) return;
    w.ports.forEach((p) => {
      const k = canon(p);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push({ t: i, p, d: scr(sub(p, w.c)) });
    });
  });
  const adj = W.map(() => []);
  Gr = { key, P, occ, wedge, far, W, buckets, adj, heads: new Map(), m, lift, fake: new Set(), conflict };
  for (const b of buckets.values())
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const A = b[i], B = b[j];
        if (A.t === B.t || adj[A.t].includes(B.t)) continue;
        const r = link(Gr, W[A.t], A, W[B.t], B);
        if (!r) continue;
        adj[A.t].push(B.t); adj[B.t].push(A.t);
        if (r === 2) Gr.fake.add(Math.min(A.t, B.t) + ':' + Math.max(A.t, B.t));
      }
  L.cache.set(key, Gr);
  return Gr;
}
// 1 = a real joint, 2 = an impossible (screen-only) joint, 0 = none
function link(Gr, wa, A, wb, B) {
  const real = near(A.p, B.p);
  if (near(wa.n, wb.n)) {
    const c = (A.d[0] * B.d[0] + A.d[1] * B.d[1]) / Math.hypot(A.d[0], A.d[1]) / Math.hypot(B.d[0], B.d[1]);
    if (c > -0.2) return 0; // the tiles overlap on screen instead of meeting edge to edge
    if (real) return 1;
    return visible(Gr, wa, A.p) && visible(Gr, wb, B.p) ? 2 : 0;
  }
  return real ? 1 : 0; // a fold onto (or off) a gravity wall; non-top faces are only active when they are walls
}
// is the strip of tile w next to port p visible from the camera? (march toward the eye through occupied cells)
function visible(Gr, w, p) {
  const own = ck(w.cell);
  const edge = cross(w.n, sub(p, w.c)); // along the edge, length 0.5
  const base = add(add(p, mul(sub(w.c, p), 0.12)), mul(w.n, 0.03));
  for (const s of [-0.6, 0, 0.6]) {
    const q0 = add(base, mul(edge, s));
    for (let t = 0.04; ; t += 0.06) {
      const q = add(q0, mul(ONE, t));
      if (q[0] + q[1] + q[2] > Gr.far + 2) break;
      const r = rnd(q);
      if (Math.abs(q[0] - r[0]) < 0.49 && Math.abs(q[1] - r[1]) < 0.49 && Math.abs(q[2] - r[2]) < 0.49) {
        const k = ck(r);
        if (k === own || !Gr.occ.has(k)) continue;
        const wg = Gr.wedge.get(k);
        if (!wg) return false;
        const rel = sub(q, wg.c);
        if (dot(rel, wg.up) < dot(rel, wg.d) + 0.02) return false;
      }
    }
  }
  return true;
}
// the companion's flat head is a walkable tile one unit above it
export function head(Gr, L, ct) {
  if (ct < 0) return null;
  if (Gr.heads.has(ct)) return Gr.heads.get(ct);
  let h = null;
  const w = Gr.W[ct];
  if (w.active && !w.stair) {
    const c = add(w.c, w.n), cell = add(w.cell, w.n);
    if (!Gr.occ.has(ck(add(cell, w.n)))) {
      h = { c, n: w.n, cell, ports: facePorts(c, w.n), adj: [], head: true };
      for (const p of h.ports) {
        const A = { p, d: scr(sub(p, c)) };
        for (const B of Gr.buckets.get(canon(p)) || []) {
          if (B.t === ct || h.adj.includes(B.t)) continue;
          if (link(Gr, h, A, Gr.W[B.t], B)) h.adj.push(B.t);
        }
      }
    }
  }
  Gr.heads.set(ct, h);
  return h;
}
export const tileW = (L, Gr, st, t) => (t === HEAD ? head(Gr, L, st.c) : Gr.W[t]);

// ---------- state & rules ----------
// st = { m: mech values, lift: lift poses, p: player tile, c: companion tile, cm: companion follows?,
//        s: [railIndex, dir] per sentinel (flattened), latch: latched plates bitmask, g: glimmer taken }
export function init(L) {
  const st = { m: L.mechs.map((G) => G.start), lift: L.lifts.map(() => 0), p: L.player, c: L.comp, cm: L.comp >= 0 ? 1 : 0, s: [], latch: 0, g: 0 };
  for (const S of L.sentinels) st.s.push(S.start, S.dir);
  st.lift = settle(L, st);
  return st;
}
export const graphOf = (L, st) => graph(L, st.m, st.lift);
export const sentTiles = (L, st) => L.sentinels.map((S, i) => S.rail[st.s[2 * i]]);
const stranded = (L, Gr, st) => Gr.conflict || [st.p, st.c, ...sentTiles(L, st)].some((t) => t >= 0 && !Gr.W[t].active) || (st.p === HEAD && !head(Gr, L, st.c));
export function pressed(L, st) {
  const on = new Set([st.p, st.c, ...sentTiles(L, st)]);
  return L.plates.map((pl, i) => on.has(pl.tile) || !!((st.latch >> i) & 1));
}
// lifts follow their plates, but never move while someone stands on them, or if that would strand or collide
export function settle(L, st) {
  const want = L.lifts.map(() => 0);
  pressed(L, st).forEach((on, i) => { if (on) for (const li of L.plates[i].lifts) want[li] = 1; });
  const held = new Set();
  for (const t of [st.p === HEAD ? st.c : st.p, st.c, ...sentTiles(L, st)]) if (t >= 0) held.add(L.tiles[t].g);
  let lift = st.lift;
  want.forEach((v, i) => {
    if (v === lift[i] || held.has(L.lifts[i].i)) return;
    const l2 = lift.slice(); l2[i] = v;
    if (!stranded(L, graph(L, st.m, l2), st)) lift = l2;
  });
  return lift;
}
export function nbrs(L, Gr, st, t) {
  if (t === HEAD) { const h = head(Gr, L, st.c); return h ? h.adj : []; }
  const h = head(Gr, L, st.c);
  return h && h.adj.includes(t) ? Gr.adj[t].concat([HEAD]) : Gr.adj[t];
}
export function bfsPath(adj, from, to, blocked) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]), q = [from];
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    for (const v of adj[u]) {
      if (prev.has(v) || (blocked && blocked.has(v) && v !== to)) continue;
      prev.set(v, u);
      if (v === to) { const out = [v]; for (let x = u; x !== -1; x = prev.get(x)) out.push(x); return out.reverse(); }
      q.push(v);
    }
  }
  return null;
}
// one tick: the player steps to `to` (or waits when to == null), then the companion, then the sentinels
export function tick(L, st, to) {
  const Gr = graphOf(L, st);
  const sT = sentTiles(L, st);
  let p = st.p, c = st.c;
  if (to != null) {
    if (!nbrs(L, Gr, st, p).includes(to) || sT.includes(to)) return null;
    if (to === c) { if (!st.cm || p === HEAD) return null; c = p; } // swap places with a following companion
    p = to;
  }
  if (c >= 0 && st.cm && p !== HEAD && !Gr.adj[c].includes(p)) {
    const path = bfsPath(Gr.adj, c, p, new Set(sT));
    if (path && path.length > 2) c = path[1];
  }
  const s = st.s.slice();
  L.sentinels.forEach((S, i) => {
    const k = s[2 * i], d = s[2 * i + 1], n = S.rail.length;
    let k2 = k + d;
    if (S.loop) k2 = (k2 + n) % n;
    const nx = k2 >= 0 && k2 < n ? S.rail[k2] : -1;
    const taken = nx === p || nx === c || L.sentinels.some((S2, j) => j !== i && S2.rail[s[2 * j]] === nx);
    if (nx >= 0 && !taken && Gr.adj[S.rail[k]].includes(nx)) s[2 * i] = k2;
    else s[2 * i + 1] = -d; // blocked or broken: turn around
  });
  const ns = { m: st.m, lift: st.lift, p, c, cm: st.cm, s, latch: st.latch, g: st.g || (p === L.glim ? 1 : 0) };
  const on = new Set([p, c, ...sentTiles(L, ns)]);
  L.plates.forEach((pl, i) => { if (pl.latch && on.has(pl.tile)) ns.latch |= 1 << i; });
  ns.lift = settle(L, ns);
  return ns;
}
// snap mechanism i to value v (one drag can travel several quarter turns / slots)
export function mech(L, st, i, v) {
  const G = L.mechs[i];
  if (v === st.m[i] || !G.dom.includes(v)) return null;
  const m = st.m.slice();
  m[i] = v;
  if (stranded(L, graph(L, m, st.lift), st)) return null;
  const ns = { ...st, m };
  ns.lift = settle(L, ns); // a lift that was waiting may now be free to move
  return ns;
}
export const toggle = (L, st) => (st.c < 0 || st.p === HEAD ? null : { ...st, cm: 1 - st.cm });
export const won = (L, st) => st.p === L.goal;
export function skey(L, st) {
  if (L.radix === undefined) {
    let r = L.mechs.reduce((a, G) => a * G.dom.length, 1) * 2 ** L.lifts.length * (L.tiles.length + 1) * (L.tiles.length + 1) * 2 * 2 ** L.plates.length * 2;
    for (const S of L.sentinels) r *= S.rail.length * 2;
    L.radix = r < 2 ** 52 ? L.tiles.length + 1 : 0;
  }
  const cfg = cfgKey(L, st.m, st.lift);
  if (!L.radix || typeof cfg !== 'number') return st.m.join(',') + '|' + st.lift.join('') + '|' + st.p + '|' + st.c + '|' + st.cm + '|' + st.s.join(',') + '|' + st.latch + '|' + st.g;
  const N = L.radix;
  let k = ((cfg * N + (st.p === HEAD ? N - 1 : st.p)) * N + (st.c + 1)) * 2 + st.cm;
  for (let i = 0; i < L.sentinels.length; i++) k = k * L.sentinels[i].rail.length * 2 + st.s[2 * i] * 2 + (st.s[2 * i + 1] > 0 ? 1 : 0);
  return (k * 2 ** L.plates.length + st.latch) * 2 + st.g;
}
const moving = (L, st, Gr) => L.sentinels.length > 0 || (st.c >= 0 && st.cm && st.p !== HEAD && !Gr.adj[st.c].includes(st.p));

export const COST = { mech: 1000, step: 1, wait: 1, toggle: 5 };
export function actions(L, st) {
  const out = [];
  const Gr = graphOf(L, st);
  for (const t of nbrs(L, Gr, st, st.p)) { const ns = tick(L, st, t); if (ns) out.push([{ t: 'step', to: t }, ns, COST.step]); }
  if (moving(L, st, Gr)) { const ns = tick(L, st, null); if (ns) out.push([{ t: 'wait' }, ns, COST.wait]); }
  L.mechs.forEach((G, i) => { for (const v of G.dom) { const ns = mech(L, st, i, v); if (ns) out.push([{ t: 'mech', i, v }, ns, COST.mech]); } });
  const ts = toggle(L, st);
  if (ts) out.push([{ t: 'toggle' }, ts, COST.toggle]);
  return out;
}
export function apply(L, st, a) {
  return a.t === 'step' ? tick(L, st, a.to) : a.t === 'wait' ? tick(L, st, null) : a.t === 'mech' ? mech(L, st, a.i, a.v) : toggle(L, st);
}
// Dijkstra over (mechanisms × lifts × player × companion × sentinels × plates): snaps cost most, then ticks
export function solve(L, st0, goal = won, cap = 600000) {
  const nodes = [{ st: st0, prev: -1, act: null, cost: 0 }];
  const best = new Map([[skey(L, st0), 0]]);
  const heap = [[0, 0]];
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [cost, id] = pop();
    const N = nodes[id];
    if (cost > N.cost) continue;
    if (goal(L, N.st)) {
      const acts = [];
      for (let x = id; nodes[x].prev >= 0; x = nodes[x].prev) acts.push(nodes[x].act);
      acts.reverse();
      return { actions: acts, turns: acts.filter((a) => a.t === 'mech').length, steps: acts.filter((a) => a.t === 'step' || a.t === 'wait').length, explored: nodes.length };
    }
    if (nodes.length > cap) return { capped: true, explored: nodes.length };
    for (const [act, ns, w] of actions(L, N.st)) {
      const k = skey(L, ns), c2 = cost + w;
      const prevId = best.get(k);
      if (prevId != null && nodes[prevId].cost <= c2) continue;
      nodes.push({ st: ns, prev: id, act, cost: c2 });
      best.set(k, nodes.length - 1);
      push([c2, nodes.length - 1]);
    }
  }
  return null;
}
// every state reachable from the start (for the drafts and the "no dead ends" report)
export function reachable(L, cap = 400000) {
  const st0 = init(L), seen = new Set([skey(L, st0)]), q = [st0];
  for (let i = 0; i < q.length && q.length < cap; i++)
    for (const [, ns] of actions(L, q[i])) { const k = skey(L, ns); if (!seen.has(k)) { seen.add(k); q.push(ns); } }
  return q;
}
// A* through the current graph for a tap (screen-distance heuristic)
export function path(L, st, to) {
  const Gr = graphOf(L, st);
  const blocked = new Set(sentTiles(L, st));
  if (!st.cm && st.c >= 0) blocked.add(st.c);
  const pos = (t) => { const w = tileW(L, Gr, st, t); return w ? scr(w.c) : [0, 0]; };
  const gp = pos(to);
  const h = (t) => { const p = pos(t); return Math.hypot(p[0] - gp[0], p[1] - gp[1]) / 1.5; }; // one step moves < 1.5 screen units: admissible
  const g = new Map([[st.p, 0]]), prev = new Map([[st.p, null]]), open = [[h(st.p), st.p]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i; // ponytail: linear-scan open list; levels have < 400 tiles
    const [f, u] = open.splice(bi, 1)[0];
    if (f > g.get(u) + h(u) + 1e-9) continue;
    if (u === to) { const out = []; for (let x = u; x != null; x = prev.get(x)) out.push(x); return out.reverse(); }
    for (const v of nbrs(L, Gr, st, u)) {
      if (blocked.has(v) && v !== to) continue;
      const ng = g.get(u) + 1;
      if (g.has(v) && g.get(v) <= ng) continue;
      g.set(v, ng); prev.set(v, u); open.push([ng + h(v), v]);
    }
  }
  return null;
}
// world points for animating a move a->b: centre, exit port, entry port, centre (+ normals).
// Across an impossible joint the exit and entry ports differ by k(1,1,1), i.e. the jump is invisible.
export function seamPts(L, Gr, st, a, b) {
  const wa = tileW(L, Gr, st, a), wb = tileW(L, Gr, st, b);
  for (const pa of wa.ports) for (const pb of wb.ports) if (canon(pa) === canon(pb)) {
    if (!near(wa.n, wb.n) && !near(pa, pb)) continue;
    return { a: wa.c, pa, pb, b: wb.c, na: wa.n, nb: wb.n, fake: !near(pa, pb) };
  }
  return { a: wa.c, pa: wa.c, pb: wb.c, b: wb.c, na: wa.n, nb: wb.n, fake: false };
}
