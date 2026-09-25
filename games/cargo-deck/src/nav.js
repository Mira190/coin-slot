// Nav graph over the hand-placed map nodes. Edges are discovered by actually walking a test cylinder between
// nearby nodes with the game's own collision (so stairs, rails and gaps are respected); jump links come from
// mapdata. A* for paths, plus helpers for cover and callouts.
import { navNodes, navLinks, zoneAt } from './mapdata.js';

export class NavGraph {
  constructor(world) {
    this.world = world;
    this.nodes = navNodes.map((n, i) => ({ ...n, i, adj: [], zone: zoneAt(n.x, n.y + 0.5, n.z), snipe: n.f.includes('s'), cover: n.f.includes('c'), hold: n.f.includes('h'), perch: n.f.includes('p') }));
    this.byId = Object.fromEntries(this.nodes.map((n) => [n.id, n]));
    this.edgeCount = 0;
  }
  // walk a test mover from a to b; true if it arrives
  walk(a, b, speed = 4) {
    const m = { pos: { x: a.x, y: a.y, z: a.z }, vel: { x: 0, y: 0, z: 0 }, r: 0.36, h: 1.7, onGround: true };
    const D = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil((D / speed + 0.8) * 30);
    const floor = Math.min(a.y, b.y) - 0.5;
    for (let s = 0; s < steps; s++) {
      const dx = b.x - m.pos.x, dz = b.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.45 && Math.abs(m.pos.y - b.y) < 0.4) return true;
      m.vel.x = (dx / (d || 1)) * speed; m.vel.z = (dz / (d || 1)) * speed;
      this.world.move(m, 1 / 30);
      if (m.pos.y < floor) return false;
    }
    return false;
  }
  build(maxDist = 13) {
    const N = this.nodes;
    for (let i = 0; i < N.length; i++) {
      for (let j = i + 1; j < N.length; j++) {
        const a = N[i], b = N[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > maxDist || Math.abs(a.y - b.y) > 3.6) continue;
        // straight, clear corridor only (no sliding round corners)
        const W = this.world;
        if (!W.los(a.x, a.y + 0.6, a.z, b.x, b.y + 0.6, b.z) || !W.los(a.x, a.y + 1.3, a.z, b.x, b.y + 1.3, b.z)) continue;
        // a body-wide corridor: two more rays offset sideways so paths don't graze door jambs and box corners
        const px = -(b.z - a.z) / (d || 1) * 0.28, pz = (b.x - a.x) / (d || 1) * 0.28;
        if (!W.los(a.x + px, a.y + 0.7, a.z + pz, b.x + px, b.y + 0.7, b.z + pz) || !W.los(a.x - px, a.y + 0.7, a.z - pz, b.x - px, b.y + 0.7, b.z - pz)) continue;
        if (this.walk(a, b)) this._link(a, b, d, 0);
        if (this.walk(b, a)) this._link(b, a, d, 0);
      }
    }
    for (const [ia, ib] of navLinks) {
      const a = this.byId[ia], b = this.byId[ib];
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z) + 1.5;
      this._link(a, b, d, a.y < b.y - 0.4 ? 1 : 0);
      this._link(b, a, d, b.y < a.y - 0.4 ? 1 : 0);
    }
    return this;
  }
  _link(a, b, d, jump) {
    if (a.adj.some((e) => e.to === b.i)) return;
    a.adj.push({ to: b.i, d, jump });
    this.edgeCount++;
  }
  // restore from a compact edge list [[from, to, jump], ...]
  load(list) {
    for (const [f, t, j] of list) {
      const a = this.nodes[f], b = this.nodes[t];
      this._link(a, b, Math.hypot(a.x - b.x, a.z - b.z) + (j ? 1.5 : 0), j);
    }
    return this;
  }
  dump() {
    const out = [];
    for (const a of this.nodes) for (const e of a.adj) out.push([a.i, e.to, e.jump]);
    return out;
  }
  nearest(x, y, z, filter) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = Math.hypot(n.x - x, (n.y - y) * 3, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  // nearest node we can actually see from (x,y,z) at chest height and, with `body`, walk straight to
  // (a node seen over a crate or through a gap is no start for a path); falls back to visible, then plain nearest
  nearestVisible(x, y, z, body) {
    const cand = this.nodes.map((n) => [Math.hypot(n.x - x, (n.y - y) * 3, n.z - z), n]).sort((a, b) => a[0] - b[0]);
    let seen = null;
    for (let k = 0; k < Math.min(6, cand.length); k++) {
      const n = cand[k][1];
      if (!this.world.los(x, y + 0.9, z, n.x, n.y + 0.9, n.z)) continue;
      if (!body || this.walk({ x, y, z }, n)) return n;
      seen = seen || n;
    }
    return seen || cand[0][1];
  }
  // A* with an optional per-node extra cost (danger map)
  path(from, to, extra) {
    if (from === to) return [from];
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity), f = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open = [from.i];
    g[from.i] = 0; f[from.i] = this._h(from, to);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (cur === to.i) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const e of this.nodes[cur].adj) {
        if (closed[e.to]) continue;
        const ng = g[cur] + e.d + (extra ? extra(this.nodes[e.to]) : 0);
        if (ng < g[e.to]) {
          g[e.to] = ng; prev[e.to] = cur; f[e.to] = ng + this._h(this.nodes[e.to], to);
          open.push(e.to);
        }
      }
    }
    if (prev[to.i] < 0) return null;
    const out = [];
    for (let c = to.i; c >= 0; c = prev[c]) out.push(this.nodes[c]);
    return out.reverse();
  }
  _h(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  edge(a, b) { return a.adj.find((e) => e.to === b.i); }
  // how many nodes can reach every other node (debug)
  reachable(from) {
    const seen = new Set([from.i]), st = [from.i];
    while (st.length) for (const e of this.nodes[st.pop()].adj) if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to); }
    return seen;
  }
}
