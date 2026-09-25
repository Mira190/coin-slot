// Item race (道具赛): item boxes, two slots with a roulette, and the ten items' effects.
// Pure logic; world.js/fx.js draw boxes, projectiles and drops from this state.

import { ITEMS, itemOdds } from './data.js';
import { DS, wrap, nearestLocal, lateral } from './track.js';
import { hitKart, boost, angDiff } from './physics.js';

let uid = 1;
const rnd = Math.random;

export function makeItems(T) {
  const boxes = [];
  for (const b of T.boxes) {
    const P = T.paths[b.path], i = b.i;
    for (const f of [-0.62, -0.31, 0, 0.31, 0.62]) {
      const lat = f * P.hw[i];
      boxes.push({ x: P.x[i] + P.nx[i] * lat, y: P.y[i] + 1.2, z: P.z[i] + P.nz[i] * lat, active: true, t: 0, id: uid++ });
    }
  }
  return { boxes, shots: [], drops: [], clouds: [] };
}

function pick(R, k) {
  const rank = R.ranks.indexOf(k), n = R.karts.length;
  const odds = itemOdds(n > 1 ? rank / (n - 1) : 0, rank === 0);
  let sum = 0; for (const key in odds) sum += odds[key];
  let r = rnd() * sum;
  for (const key in odds) { r -= odds[key]; if (r <= 0) return key; }
  return 'turbo';
}

export function stepItems(R, dt) {
  const I = R.items, C = R.C;
  // boxes
  for (const b of I.boxes) {
    if (!b.active) { b.t -= dt; if (b.t <= 0) b.active = true; continue; }
    for (const k of R.karts) {
      const dx = k.x - b.x, dz = k.z - b.z;
      if (dx * dx + dz * dz < 5.3 && Math.abs(k.y + 0.8 - b.y) < 2.2) {
        b.active = false; b.t = 2.5;
        const slot = k.items[0] == null ? 0 : k.items[1] == null ? 1 : -1;
        if (slot >= 0) { k.items[slot] = pick(R, k); k.roll[slot] = 0.9; }
        C.emit(k, 'box', { slot, x: b.x, y: b.y, z: b.z });
        break;
      }
    }
  }
  for (const k of R.karts) for (let s = 0; s < 2; s++) if (k.roll[s] > 0) { k.roll[s] -= dt; if (k.roll[s] <= 0) C.emit(k, 'itemReady', { slot: s, item: k.items[s] }); }

  // homing shots follow the road, then dive at the target
  for (const s of I.shots) {
    s.t += dt;
    const tg = s.target;
    const P = R.T.paths[s.path];
    if (tg && !tg.finished) {
      const dx = tg.x - s.x, dz = tg.z - s.z, dy = tg.y + 0.8 - s.y, d = Math.hypot(dx, dz);
      tg.lock = Math.max(tg.lock, 0.2);
      if (d < 22 || s.t > 6) {
        const v = s.speed * dt / Math.max(d, 0.01);
        s.x += dx * Math.min(1, v); s.z += dz * Math.min(1, v); s.y += dy * Math.min(1, v * 1.5);
        s.h = Math.atan2(dx, dz);
        if (d < 1.9 && Math.abs(dy) < 2.5) {
          s.dead = true;
          const hit = hitKart(tg, C, s.kind, s.owner);
          C.emit(tg, 'boom', { x: s.x, y: s.y, z: s.z, kind: s.kind, hit });
        }
        continue;
      }
    }
    // along the road
    const step = s.speed * dt / DS;
    s.u += step;
    if (!P.closed && s.u >= P.n - 1) { const B = P; s.path = 0; s.u = B.to + (s.u - (B.n - 1)); }
    const Q = R.T.paths[s.path], i0 = Math.floor(s.u), f = s.u - i0, i = wrap(Q, i0), j = wrap(Q, i0 + 1);
    const lat = s.lat * 0.97;
    s.lat = lat;
    s.x = Q.x[i] + (Q.x[j] - Q.x[i]) * f + Q.nx[i] * lat;
    s.z = Q.z[i] + (Q.z[j] - Q.z[i]) * f + Q.nz[i] * lat;
    s.y = Q.y[i] + (Q.y[j] - Q.y[i]) * f + (s.kind === 'bubble' ? 3.2 : s.kind === 'tornado' ? 0.2 : 1.1);
    s.h = Math.atan2(Q.tx[i], Q.tz[i]);
    if (!tg) {
      for (const k of R.karts) if (k !== s.owner && Math.hypot(k.x - s.x, k.z - s.z) < 2 && Math.abs(k.y - s.y) < 2.5) {
        s.dead = true; const hit = hitKart(k, C, s.kind, s.owner); C.emit(k, 'boom', { x: s.x, y: s.y, z: s.z, kind: s.kind, hit }); break;
      }
    }
    if (s.t > 9) s.dead = true;
  }
  I.shots = I.shots.filter((s) => !s.dead);

  // bananas on the road
  for (const d of I.drops) {
    d.t += dt;
    for (const k of R.karts) {
      if (k === d.owner && d.t < 1) continue;
      const dx = k.x - d.x, dz = k.z - d.z;
      if (dx * dx + dz * dz < 2.6 && Math.abs(k.y - d.y) < 1.6) {
        d.dead = true; hitKart(k, C, 'banana', d.owner); C.emit(k, 'slip', { x: d.x, y: d.y, z: d.z }); break;
      }
    }
    if (d.t > 45) d.dead = true;
  }
  I.drops = I.drops.filter((d) => !d.dead);
  for (const c of I.clouds) c.t -= dt;
  I.clouds = I.clouds.filter((c) => c.t > 0);

  // magnet: pull toward the target
  for (const k of R.karts) {
    if (k.b.magnet > 0 && k.magTarget) {
      const tg = k.magTarget, want = Math.atan2(tg.x - k.x, tg.z - k.z);
      const e = angDiff(want, k.vh);
      if (Math.abs(e) < 1.2) { k.vh += e * Math.min(1, 2.5 * dt); k.h += e * Math.min(1, 2.5 * dt); }
      tg.slow = Math.max(tg.slow || 0, 0.3);
      if (Math.hypot(tg.x - k.x, tg.z - k.z) < 4) k.b.magnet = Math.min(k.b.magnet, 0.2);
    }
  }
}

export function useItem(R, k, slot) {
  if (k.stun > 0) return false;
  const it = k.items[slot];
  if (!it || k.roll[slot] > 0) return false;
  k.items[slot] = null;
  if (slot === 0 && k.items[1] && k.roll[1] <= 0) { k.items[0] = k.items[1]; k.items[1] = null; }
  const C = R.C, I = R.items;
  const ahead = R.aheadOf(k), leader = R.ranks[0] !== k ? R.ranks[0] : R.ranks[1];
  C.emit(k, 'use', { item: it });
  const P = R.T.paths[k.path];
  const shot = (kind, target, speed) => {
    I.shots.push({ id: uid++, kind, owner: k, target, path: k.path, u: k.idx + 1.5, lat: k.lat, x: k.x, y: k.y + 1.1, z: k.z, h: k.h, t: 0, speed });
    if (target) { target.lock = 1; C.emit(target, 'locked', { kind, from: k }); }
  };
  switch (it) {
    case 'missile': shot('missile', ahead && ahead.dist - k.dist < 400 ? ahead : null, 72); break;
    case 'bubble': shot('bubble', leader && leader !== k ? leader : null, 58); break;
    case 'devil': shot('devil', ahead && ahead.dist - k.dist < 400 ? ahead : null, 64); break;
    case 'tornado': shot('tornado', ahead && ahead.dist - k.dist < 300 ? ahead : null, 46); break;
    case 'banana': {
      const bx = k.x - Math.sin(k.h) * 3.2, bz = k.z - Math.cos(k.h) * 3.2;
      I.drops.push({ id: uid++, x: bx, y: k.y, z: bz, owner: k, t: 0 });
      break;
    }
    case 'fog': {
      const ahead3 = R.ranks.slice(0, R.ranks.indexOf(k)).slice(-3);
      for (const o of ahead3) { const hit = hitKart(o, C, 'fog', k); if (hit) I.clouds.push({ id: uid++, k: o, t: 3.6 }); }
      break;
    }
    case 'magnet':
      if (ahead && ahead.dist - k.dist < 110) { k.b.magnet = 2.6; k.magTarget = ahead; C.emit(ahead, 'magnetized', { from: k }); }
      else boost(k, C, 'turbo');
      break;
    case 'angel': k.shield = 8; C.emit(k, 'shield', {}); break;
    case 'turbo': boost(k, C, 'turbo'); break;
    case 'turtle': {
      const tg = leader && leader !== k ? leader : null;
      if (tg) { R.later.push({ t: 0.7, fn: () => { if (hitKart(tg, C, 'turtle', k)) C.emit(tg, 'turtled', {}); } }); C.emit(tg, 'locked', { kind: 'turtle', from: k }); }
      break;
    }
  }
  return true;
}

export { ITEMS };
