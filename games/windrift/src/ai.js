// Rival drivers. They produce the same input struct as the keyboard, so they drift, straighten, tap ↑ in the
// 喷 light (sometimes perfect, sometimes late), pull the nose for 双喷, fire nitro on straights, use items,
// take shortcuts by temperament, and rubber-band toward the player.

import { WIN } from './data.js';
import { DS, F, wrap, clamp, nearestGlobal } from './track.js';
import { angDiff } from './physics.js';

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const aiSeed = (s) => { seed = s | 0 || 1; };

export function makeAI(skill) {
  return {
    skill, lane: (rnd() - 0.5) * 3.2, laneT: 0, laneBias: 0,
    take: 0, decided: -1, shortcutP: 0.35 + skill * 0.55,
    tapAt: -1, pullPlan: false, releaseAt: -1, nitroCD: 1 + rnd() * 2, itemCD: 1 + rnd() * 2, stuckT: 0, startAt: 0,
    upWas: false, airTap: false, landTap: false, mistakes: 0
  };
}

// step along the route this AI intends to drive (loop, or into a branch it chose to take)
function adv(T, ai, p, j, n) {
  // just past the fork but not yet handed over to the shortcut (it peels away gradually): keep following it
  if (p === 0 && ai.take) { const past = (j - T.paths[ai.take].from + T.N) % T.N; if (past < 12) { p = ai.take; j = past; } }
  for (let s = 0; s < n; s++) {
    if (p === 0) {
      if (ai.take && T.paths[ai.take].from === j) { p = ai.take; j = 0; continue; }
      j = (j + 1) % T.N;
    } else {
      const B = T.paths[p];
      if (j >= B.n - 1) { p = 0; j = B.to; } else j++;
    }
  }
  return [p, j];
}

function rGrip(k, v) { return v / Math.max(0.3, k.st.handling * (1.75 - 0.82 * clamp((v - 18) / 26, 0, 1))); }

export function aiInput(k, C) {
  const T = C.T, ai = k.ai, inp = { up: true, down: false, steer: 0, drift: false, upTap: false, nitro: false, item1: false, item2: false, reset: false };
  const t = C.time, a = Math.abs(k.spd), sk = ai.skill;

  // choose shortcuts once per approach
  if (k.path === 0) {
    for (let q = 1; q < T.paths.length; q++) {
      const B = T.paths[q], dAhead = ((B.from - k.idx) % T.N + T.N) % T.N;
      if (dAhead > 0 && dAhead < 45 && ai.decided !== q * 1000 + k.lap) {
        ai.decided = q * 1000 + k.lap;
        ai.take = rnd() < ai.shortcutP * (C.mode === 'item' ? 0.8 : 1) ? q : 0;
      }
    }
  }

  // lane wander + overtaking: slide the lane offset away from a kart right ahead
  ai.laneT -= C.dt;
  if (ai.laneT <= 0) { ai.laneT = 2 + rnd() * 3; ai.lane = (rnd() - 0.5) * 3.4; }
  let dodge = 0;
  for (const o of C.karts) {
    if (o === k || o.ghost) continue;
    const dx = o.x - k.x, dz = o.z - k.z, fwd = dx * Math.sin(k.vh) + dz * Math.cos(k.vh);
    const side = dx * Math.cos(k.vh) - dz * Math.sin(k.vh);
    if (fwd > 0 && fwd < 9 && Math.abs(side) < 2.6 && Math.abs(o.y - k.y) < 2 && o.spd < k.spd + 1) dodge += side >= 0 ? -2.6 : 2.6;
  }
  ai.laneBias += (dodge - ai.laneBias) * Math.min(1, 3 * C.dt);
  const lane = clamp(ai.lane + ai.laneBias, -2.4, 2.4);

  // lining up for a shortcut mouth: steer into it on grip, no drifting past it
  const forkNear = ai.take && k.path === 0 && (((T.paths[ai.take].from - k.idx + T.N) % T.N) < 30 || ((k.idx - T.paths[ai.take].from + T.N) % T.N) < 12);
  // corner planning: tightest racing-line radius right ahead, and the speed the bends in the braking window allow. A drift turns the velocity at most ~1.55 rad/s × slip, and slip takes time to build, so a
  // bend of radius r is taken at ≈ 1.55 r − 4 (ice ×0.65; on grip into a shortcut mouth only ≈ 1.05 r), brought
  // back to here over the braking distance (planned at 28 u/s²)
  const look = Math.round((a * 1.1 + 12) / DS);
  let minRnear = 9999, cornerDir = 0, vAllow = 999;
  { let p = k.path, j = k.idx;
    for (let s = 0; s < look; s += 2) {
      [p, j] = adv(T, ai, p, j, 2); const Q = T.paths[p], r = Q.rad[j];
      if (s < 16 && r < minRnear) { minRnear = r; cornerDir = Math.sign(Q.kap[j]); }
      const v = (r * (forkNear ? 1.05 : 1.55) - 4) * (Q.fl[j] & F.ICE ? 0.65 : 1);
      vAllow = Math.min(vAllow, Math.sqrt(v * v + 56 * (s + 2) * DS));
    } }
  const rg = rGrip(k, a);

  // target point along the route (shorter lookahead when the next bend is tight)
  const L = clamp(5 + a * 0.3, 6, 8 + minRnear * 0.6), n = Math.max(2, Math.round(L / DS));
  const [tp, ti] = adv(T, ai, k.path, k.idx, n);
  const P = T.paths[tp];
  const off = clamp(P.line[ti] + lane, -P.hw[ti] + 2.6, P.hw[ti] - 2.6);
  const tx = P.x[ti] + P.nx[ti] * off, tz = P.z[ti] + P.nz[ti] * off;
  const psi = Math.atan2(tx - k.x, tz - k.z);
  let err = angDiff(psi, k.vh);
  if (k.fog > 0) err += Math.sin(t * 3.1 + k.id) * 0.25;
  // keep off the walls: project the slide 0.4 s ahead; if it would reach the barrier, lean the aim away from it
  { const Q = T.paths[k.path], hp = Math.atan2(Q.tx[k.idx], Q.tz[k.idx]);
    const latV = Math.sin(angDiff(k.vh, hp)) * a, pred = k.lat + latV * 0.4, side = Math.sign(pred);
    const over = Math.abs(pred) - (Q.hw[k.idx] - 1.95);
    const open = (side > 0 ? Q.openL : Q.openR)[wrap(Q, k.idx + 3)] || (side > 0 ? Q.openL : Q.openR)[k.idx];
    if (!open && over > 0 && latV * side > 0) err -= side * Math.min(0.3, over * 0.06); }
  const d = k.drift;

  if (d.on && forkNear) { inp.drift = false; inp.steer = clamp(err * 2.8, -1, 1); }
  else if (d.on) {
    inp.drift = true;
    // the velocity keeps swinging after Shift is let go (车身回正), so judge the exit ahead of it by ~⅓ of the slip
    const e = err * d.dir - 0.35 * Math.abs(angDiff(k.h, k.vh));
    inp.steer = d.dir * (e > 0.1 ? 1 : e > -0.03 ? 0 : -1);
    // near the exit (or overshooting), pull the nose straight for the first light of 双喷, or just let go
    const exiting = minRnear > rg * 1.1 && e < 0.12;
    if ((exiting || e < -0.14) && d.t > 0.3) {
      if (ai.pullPlan && !d.pulled && e > -0.3) inp.steer = -d.dir;
      else inp.drift = false;
    }
    if (e < -0.35) inp.drift = false; // overshooting badly: straighten up
    if (d.pulled && k.light <= 0 && d.spurts > 0) inp.drift = false;
    if (d.pulled && k.light <= 0 && d.spurts === 0 && k.lightAge > 0.2) inp.drift = false;
    if (d.t > 3.2) inp.drift = false;
  } else if (!forkNear && k.grounded && a > 20 && minRnear < rg * 1.05 && cornerDir && Math.sign(err) === cornerDir && Math.abs(err) > 0.05 && k.stun <= 0) {
    inp.drift = true; inp.steer = cornerDir;
    ai.pullPlan = rnd() < sk * 0.75;
  } else {
    inp.steer = clamp(err * 2.8, -1, 1);
  }
  // brake for the bends ahead (drifting or not)
  if (k.grounded) { if (a > vAllow + 1) inp.up = false; if (a > vAllow + 4) inp.down = true; }

  // tap ↑ in the light, with human-ish reaction time (skipped when the boost would carry it too fast into a bend)
  if (k.light > 0) {
    if (ai.tapAt < 0) ai.tapAt = t + 0.03 + rnd() * (0.06 + (1 - sk) * 0.5) + (rnd() < 0.1 * (1.2 - sk) ? 0.3 : 0);
    if (t >= ai.tapAt && a * 1.2 < vAllow + 3) { inp.upTap = true; ai.tapAt = -1; }
  } else ai.tapAt = -1;
  // jumps: 空喷 then 落地喷
  if (!k.grounded && k.airT > 0.16 && !k.airBoosted && rnd() < sk * 0.2) inp.upTap = true;
  if (k.grounded && k.landWin > 0 && k.landWin < 0.3 && rnd() < sk * 0.5) inp.upTap = true;

  // nitro on straights (or when far behind the player)
  ai.nitroCD -= C.dt;
  // (not while pointing off the road, lining up for a shortcut, or just after entering one)
  const Q0 = T.paths[k.path], lined = Math.abs(angDiff(k.vh, Math.atan2(Q0.tx[k.idx], Q0.tz[k.idx]))) < 0.25;
  if (k.bottles > 0 && k.b.nitro <= 0 && ai.nitroCD <= 0 && !d.on && lined && !forkNear && !(k.path > 0 && k.idx < 12)) {
    let straight = true, rMin = 9999;
    { let p = k.path, j = k.idx; for (let s = 0; s < 45; s += 3) { [p, j] = adv(T, ai, p, j, 3); rMin = Math.min(rMin, T.paths[p].rad[j]); if (rMin < 70) straight = false; } }
    if (straight || k.bottles === 2 && rMin > 45) { inp.nitro = true; ai.nitroCD = 0.8 + rnd() * 2.5 * (1.2 - sk); }
  }

  // items
  if (C.mode === 'item' && k.items[0] && k.roll[0] <= 0) {
    ai.itemCD -= C.dt;
    if (ai.itemCD <= 0 && wantItem(k, C, k.items[0])) { inp.item1 = true; ai.itemCD = 0.6 + rnd() * 1.6; }
  }

  // stuck → reset
  if (a < 2.5 && k.stun <= 0 && C.racing) { ai.stuckT += C.dt; if (ai.stuckT > 1.6) { inp.reset = true; ai.stuckT = 0; } } else ai.stuckT = 0;
  if (k.wrong) { ai.stuckT += C.dt; }
  return inp;
}

function wantItem(k, C, it) {
  const ahead = C.aheadOf(k), behind = C.behindOf(k);
  switch (it) {
    case 'missile': case 'magnet': case 'devil': case 'tornado': return !!ahead && ahead.dist - k.dist < (it === 'missile' ? 260 : 90) && ahead.dist - k.dist > 4;
    case 'banana': return (behind && k.dist - behind.dist < 25) || k.lock > 0 || rnd() < 0.02;
    case 'angel': return k.lock > 0 || rnd() < 0.03;
    case 'turbo': return k.grounded && k.stun <= 0;
    default: return true;
  }
}

// countdown: rev and try for the 起步喷 window (skill decides how close to GO they press)
export function aiCountdown(k, toGo) {
  const ai = k.ai;
  if (!ai.startAt) ai.startAt = rnd() < ai.skill * 0.8 ? 0.02 + rnd() * 0.25 : 0.4 + rnd() * 0.6;
  const press = toGo <= ai.startAt && !ai.upWas;
  if (press) ai.upWas = true;
  return { up: toGo <= ai.startAt, down: false, steer: 0, drift: false, upTap: press, nitro: false, item1: false, item2: false, reset: false };
}
