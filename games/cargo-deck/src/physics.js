// Collision world: yaw-rotated boxes, a uniform grid, cylinder movers with step-up, and ray casts that report
// entry/exit so bullets can measure how much cover they punch through. No three.js here (node can run it).

export const GRAVITY = 18;
export const STEP_H = 0.45;
const CELL = 2;

export class CollisionWorld {
  constructor(boxes) {
    this.boxes = boxes.map((b, i) => {
      const cs = Math.cos(b.ry || 0), sn = Math.sin(b.ry || 0);
      const hx = b.sx / 2, hz = b.sz / 2;
      // world AABB of the rotated footprint
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      return {
        i, src: b, cx: b.x, cz: b.z, hx, hz, cs, sn, y0: b.y - b.sy / 2, y1: b.y + b.sy / 2,
        minX: b.x - ex, maxX: b.x + ex, minZ: b.z - ez, maxZ: b.z + ez,
        solid: b.solid !== false, shot: b.shot !== false, pc: b.pc === undefined ? Infinity : b.pc, mat: b.mat || 'steel',
      };
    });
    this.dynamic = []; // movable boxes (none yet, kept for doors later)
    this.grid = new Map();
    for (const b of this.boxes) this._insert(b);
    this._stamp = 0;
    this._seen = new Int32Array(this.boxes.length + 64);
  }
  _key(ix, iz) { return ix * 4096 + iz; }
  _insert(b) {
    for (let ix = Math.floor(b.minX / CELL); ix <= Math.floor(b.maxX / CELL); ix++) {
      for (let iz = Math.floor(b.minZ / CELL); iz <= Math.floor(b.maxZ / CELL); iz++) {
        const k = this._key(ix, iz);
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(b);
      }
    }
  }
  // boxes whose footprint AABB touches the given rectangle
  query(x0, z0, x1, z1, out = []) {
    out.length = 0;
    const st = ++this._stamp;
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
        const a = this.grid.get(this._key(ix, iz));
        if (!a) continue;
        for (const b of a) {
          if (this._seen[b.i] === st) continue;
          this._seen[b.i] = st;
          if (b.maxX < x0 || b.minX > x1 || b.maxZ < z0 || b.minZ > z1) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  // circle (x,z,r) vs box footprint: returns push-out vector in _push or false
  _circle(b, x, z, r) {
    const dx = x - b.cx, dz = z - b.cz;
    const u = dx * b.cs - dz * b.sn, v = dx * b.sn + dz * b.cs;
    const qu = u < -b.hx ? -b.hx : u > b.hx ? b.hx : u;
    const qv = v < -b.hz ? -b.hz : v > b.hz ? b.hz : v;
    let du = u - qu, dv = v - qv;
    const d2 = du * du + dv * dv;
    if (d2 >= r * r) return false;
    let pu, pv;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2), k = (r - d) / d;
      pu = du * k; pv = dv * k;
    } else {
      // centre inside: leave along the shallowest face
      const px = b.hx - Math.abs(u), pz = b.hz - Math.abs(v);
      if (px < pz) { pu = (u < 0 ? -1 : 1) * (px + r); pv = 0; } else { pu = 0; pv = (v < 0 ? -1 : 1) * (pz + r); }
    }
    // local -> world: u axis = (cs, -sn), v axis = (sn, cs)
    this._px = pu * b.cs + pv * b.sn;
    this._pz = -pu * b.sn + pv * b.cs;
    return true;
  }
  overlapsCircle(b, x, z, r) {
    const dx = x - b.cx, dz = z - b.cz;
    const u = dx * b.cs - dz * b.sn, v = dx * b.sn + dz * b.cs;
    const qu = Math.max(-b.hx, Math.min(b.hx, u)), qv = Math.max(-b.hz, Math.min(b.hz, v));
    return (u - qu) ** 2 + (v - qv) ** 2 < r * r;
  }
  pointInBox(b, x, y, z, pad = 0) {
    if (y < b.y0 - pad || y > b.y1 + pad) return false;
    const dx = x - b.cx, dz = z - b.cz;
    const u = dx * b.cs - dz * b.sn, v = dx * b.sn + dz * b.cs;
    return Math.abs(u) <= b.hx + pad && Math.abs(v) <= b.hz + pad;
  }

  // highest walkable top under the circle within [yMin, yMax]; returns {y, box} or null
  groundAt(x, z, r, yMin, yMax) {
    const c = this.query(x - r, z - r, x + r, z + r, this._q1 || (this._q1 = []));
    let best = -Infinity, bb = null;
    for (const b of c) {
      if (!b.solid || b.y1 > yMax || b.y1 < yMin || b.y1 <= best) continue;
      if (this.overlapsCircle(b, x, z, r)) { best = b.y1; bb = b; }
    }
    return bb ? { y: best, box: bb } : null;
  }
  // true if a cylinder at (x, y..y+h, z) with radius r intersects any solid box
  blocked(x, y, z, r, h) {
    const c = this.query(x - r, z - r, x + r, z + r, this._q2 || (this._q2 = []));
    for (const b of c) {
      if (!b.solid || b.y1 <= y + 0.01 || b.y0 >= y + h) continue;
      if (this.overlapsCircle(b, x, z, r)) return true;
    }
    return false;
  }

  // Move a cylinder actor: a = { pos:{x,y,z}, vel:{x,y,z}, r, h, onGround }. Returns the ground box (or null).
  move(a, dt) {
    const p = a.pos, v = a.vel;
    if (!a.onGround) v.y -= GRAVITY * dt;
    // horizontal, in substeps no longer than 0.15 m
    const dist = Math.hypot(v.x, v.z) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.15));
    const sdt = dt / n;
    const cand = this._q3 || (this._q3 = []);
    for (let s = 0; s < n; s++) {
      p.x += v.x * sdt; p.z += v.z * sdt;
      const stepTop = p.y + (a.onGround ? STEP_H : 0.05);
      for (let it = 0; it < 3; it++) {
        let any = false;
        this.query(p.x - a.r, p.z - a.r, p.x + a.r, p.z + a.r, cand);
        for (const b of cand) {
          if (!b.solid || b.y1 <= stepTop || b.y0 >= p.y + a.h) continue;
          if (this._circle(b, p.x, p.z, a.r)) {
            p.x += this._px; p.z += this._pz; any = true;
            // kill velocity into the wall
            const l = Math.hypot(this._px, this._pz);
            if (l > 1e-6) {
              const nx = this._px / l, nz = this._pz / l, d = v.x * nx + v.z * nz;
              if (d < 0) { v.x -= d * nx; v.z -= d * nz; }
            }
          }
        }
        if (!any) break;
      }
    }
    // vertical
    const ny = p.y + v.y * dt;
    let ground = null;
    if (v.y <= 0) {
      const up = a.onGround ? STEP_H : 0.02;
      const down = a.onGround ? 0.32 : 0;
      const g = this.groundAt(p.x, p.z, a.r * 0.92, Math.min(ny, p.y - down) - 0.001, p.y + up);
      if (g && g.y >= ny - 0.001 - down) {
        // stepping up needs head room
        if (g.y > p.y + 0.01 && this.blocked(p.x, g.y, p.z, a.r * 0.9, a.h)) {
          p.y = ny; a.onGround = false;
        } else {
          a.landSpeed = a.onGround ? 0 : -v.y;
          p.y = g.y; v.y = 0; a.onGround = true; ground = g.box;
        }
      } else { p.y = ny; a.onGround = false; }
    } else {
      // rising: stop at ceilings
      const c = this.query(p.x - a.r, p.z - a.r, p.x + a.r, p.z + a.r, cand);
      let ceil = Infinity;
      for (const b of c) {
        if (!b.solid || b.y0 < p.y + a.h - 0.02 || b.y0 > ny + a.h) continue;
        if (this.overlapsCircle(b, p.x, p.z, a.r * 0.9)) ceil = Math.min(ceil, b.y0);
      }
      if (ceil < Infinity) { p.y = ceil - a.h; v.y = 0; } else p.y = ny;
      a.onGround = false;
    }
    a.ground = ground;
    return ground;
  }

  // push a standing cylinder out of walls without moving it (after actor separation)
  resolve(a) {
    const p = a.pos, cand = this._q4 || (this._q4 = []);
    const stepTop = p.y + (a.onGround ? STEP_H : 0.05);
    for (let it = 0; it < 3; it++) {
      let any = false;
      this.query(p.x - a.r, p.z - a.r, p.x + a.r, p.z + a.r, cand);
      for (const b of cand) {
        if (!b.solid || b.y1 <= stepTop || b.y0 >= p.y + a.h) continue;
        if (this._circle(b, p.x, p.z, a.r)) { p.x += this._px; p.z += this._pz; any = true; }
      }
      if (!any) break;
    }
  }
  // Ray vs one box in its local frame; returns [tIn, tOut, axis, sign] or null
  _rayBox(b, ox, oy, oz, dx, dy, dz, tMax) {
    const rx = ox - b.cx, rz = oz - b.cz;
    const ou = rx * b.cs - rz * b.sn, ov = rx * b.sn + rz * b.cs;
    const du = dx * b.cs - dz * b.sn, dv = dx * b.sn + dz * b.cs;
    const oyc = oy - (b.y0 + b.y1) / 2, hy = (b.y1 - b.y0) / 2;
    let tIn = -Infinity, tOut = Infinity, ax = -1, sg = 0;
    const slab = (o, d, h, axis) => {
      if (Math.abs(d) < 1e-12) return o >= -h && o <= h;
      let t1 = (-h - o) / d, t2 = (h - o) / d, s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tIn) { tIn = t1; ax = axis; sg = s; }
      if (t2 < tOut) tOut = t2;
      return tIn <= tOut;
    };
    if (!slab(ou, du, b.hx, 0) || !slab(oyc, dy, hy, 1) || !slab(ov, dv, b.hz, 2)) return null;
    if (tOut < 0 || tIn > tMax) return null;
    return [tIn, tOut, ax, sg];
  }
  // All hits along a ray (sorted by entry). opts.shot: only bullet-blocking boxes. Each hit:
  // { t, tOut, box, nx, ny, nz }
  raycastAll(ox, oy, oz, dx, dy, dz, tMax, shotOnly = true, out = []) {
    out.length = 0;
    const ex = ox + dx * tMax, ez = oz + dz * tMax;
    // walk the grid cells along the ray (coarse: AABB of the segment when short, DDA when long)
    const c = this._raycand(ox, oz, ex, ez);
    for (const b of c) {
      if (shotOnly ? !b.shot : !b.solid) continue;
      const r = this._rayBox(b, ox, oy, oz, dx, dy, dz, tMax);
      if (!r) continue;
      let nx = 0, ny = 0, nz = 0;
      const s = r[3];
      if (r[2] === 0) { nx = s * b.cs; nz = -s * b.sn; } else if (r[2] === 1) { ny = s; } else if (r[2] === 2) { nx = s * b.sn; nz = s * b.cs; }
      out.push({ t: Math.max(0, r[0]), tOut: r[1], box: b, nx, ny, nz, inside: r[0] < 0 });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }
  raycast(ox, oy, oz, dx, dy, dz, tMax, shotOnly = true) {
    const h = this.raycastAll(ox, oy, oz, dx, dy, dz, tMax, shotOnly, this._rh || (this._rh = []));
    return h.length ? h[0] : null;
  }
  // line of sight between two points (bullet-blocking boxes only, penetrable crates count as blocking)
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return true;
    const ix = dx / L, iy = dy / L, iz = dz / L;
    const c = this._raycand(ax, az, bx, bz);
    for (const b of c) {
      if (!b.shot) continue;
      if (this._rayBox(b, ax, ay, az, ix, iy, iz, L)) return false;
    }
    return true;
  }
  _raycand(x0, z0, x1, z1) {
    const out = this._rc || (this._rc = []);
    out.length = 0;
    const st = ++this._stamp;
    // DDA over grid cells
    let ix = Math.floor(x0 / CELL), iz = Math.floor(z0 / CELL);
    const jx = Math.floor(x1 / CELL), jz = Math.floor(z1 / CELL);
    const dx = x1 - x0, dz = z1 - z0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? Math.abs(CELL / dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? Math.abs(CELL / dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? ((sx > 0 ? (ix + 1) * CELL - x0 : x0 - ix * CELL) / Math.abs(dx)) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? ((sz > 0 ? (iz + 1) * CELL - z0 : z0 - iz * CELL) / Math.abs(dz)) : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      const a = this.grid.get(this._key(ix, iz));
      if (a) for (const b of a) { if (this._seen[b.i] !== st) { this._seen[b.i] = st; out.push(b); } }
      if (ix === jx && iz === jz) break;
      if (tmx < tmz) { tmx += tdx; ix += sx; } else { tmz += tdz; iz += sz; }
    }
    return out;
  }
  // surface material under a point (for footsteps)
  surfaceAt(x, y, z) {
    const g = this.groundAt(x, z, 0.2, y - 0.3, y + 0.05);
    return g ? g.box.mat : 'steel';
  }
}
