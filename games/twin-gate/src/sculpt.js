// Level sculpting: add solid AABBs (newest wins where they overlap) and hollow out rooms, then merge
// coplanar neighbours. Produces the box list world.build() expects.
import { carve } from './world.js';

export class Sculpt {
  constructor() { this.b = []; }
  // [x0,y0,z0,x1,y1,z1], surface, flags ('n' = casts no shadow)
  solid(x0, y0, z0, x1, y1, z1, s = 'M', f = '') {
    const box = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), s, f];
    this.b = carve(this.b, box); this.b.push(box); return this;
  }
  hollow(x0, y0, z0, x1, y1, z1) {
    this.b = carve(this.b, [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)]); return this;
  }
  // A room: solid shell (thickness t) around an interior, with per-side surfaces, then hollowed.
  // sides: { floor, ceil, xn, xp, zn, zp } default 'M'; the ceiling casts no shadow.
  room(x0, y0, z0, x1, y1, z1, sides = {}, t = 1) {
    const S = (k) => sides[k] || sides.all || 'M';
    this.solid(x0 - t, y0 - t, z0 - t, x1 + t, y0, z1 + t, S('floor'));
    this.solid(x0 - t, y1, z0 - t, x1 + t, y1 + t, z1 + t, S('ceil'), 'n');
    this.solid(x0 - t, y0, z0 - t, x0, y1, z1 + t, S('xn'));
    this.solid(x1, y0, z0 - t, x1 + t, y1, z1 + t, S('xp'));
    this.solid(x0, y0, z0 - t, x1, y1, z0, S('zn'));
    this.solid(x0, y0, z1, x1, y1, z1 + t, S('zp'));
    return this.hollow(x0, y0, z0, x1, y1, z1);
  }
  // Paint a region of existing solid with another surface (only where solid already exists).
  paint(x0, y0, z0, x1, y1, z1, s) {
    const h = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    const add = [];
    for (const b of this.b) {
      const i = [Math.max(b[0], h[0]), Math.max(b[1], h[1]), Math.max(b[2], h[2]), Math.min(b[3], h[3]), Math.min(b[4], h[4]), Math.min(b[5], h[5])];
      if (i[0] < i[3] && i[1] < i[4] && i[2] < i[5]) add.push([...i, s, b[7] || '']);
    }
    this.b = carve(this.b, h); this.b.push(...add); return this;
  }
  result() { return mergeBoxes(this.b); }
}

// Greedy merge of boxes sharing a full face with identical surface/flags.
export function mergeBoxes(list) {
  let bs = list.map((b) => b.slice());
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (a[6] !== b[6] || (a[7] || '') !== (b[7] || '')) continue;
      for (let ax = 0; ax < 3; ax++) {
        const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
        if (Math.abs(a[o1] - b[o1]) > 1e-6 || Math.abs(a[o1 + 3] - b[o1 + 3]) > 1e-6 || Math.abs(a[o2] - b[o2]) > 1e-6 || Math.abs(a[o2 + 3] - b[o2 + 3]) > 1e-6) continue;
        if (Math.abs(a[ax + 3] - b[ax]) < 1e-6 || Math.abs(b[ax + 3] - a[ax]) < 1e-6) {
          const m = a.slice(); m[ax] = Math.min(a[ax], b[ax]); m[ax + 3] = Math.max(a[ax + 3], b[ax + 3]);
          bs[i] = m; bs.splice(j, 1); changed = true; break outer;
        }
      }
    }
  }
  return bs;
}
