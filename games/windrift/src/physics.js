// Kart dynamics and every driving technique. The player and the AI feed the same input struct into stepKart,
// so both obey identical rules and timing windows (data.js WIN). Events go out through C.emit(k, type, data).
//
// Model: facing heading h, velocity heading vh, scalar speed spd along vh. Grip turning keeps vh glued to h;
// drifting lets h swing ahead of vh (slip angle), which tightens the line, sheds a little speed and fills the
// nitro gauge (集气). Releasing Shift straightens the body; once straight the 喷 light shows for WIN.micro
// seconds and a fresh ↑ press fires a 小喷. Counter-steering mid-drift straightens early (拉车头) for a first
// light while Shift is still held; the release light after it is the second spurt: 双喷.

import { WIN, TIERS, GRAV } from './data.js';
import { F, DS, nearestLocal, nearestGlobal, lateral, along, heightAt, wrap, clamp } from './track.js';

const TAU = Math.PI * 2;
export const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const HALF_W = 1.05;

export function makeKart(o) {
  return {
    id: o.id, name: o.name, isPlayer: !!o.isPlayer, st: o.stats, paint: o.paint, kartIdx: o.kartIdx,
    x: 0, y: 0, z: 0, h: 0, vh: 0, spd: 0, vy: 0, grounded: true, airT: 0, airBoosted: false, landWin: 0,
    path: 0, idx: 0, lat: 0, prog: 0, lap: 0, dist: 0, finished: false, finishTime: 0, lapStart: 0, lapTimes: [], cp: 0,
    prevDrift: false, prevSdir: 0, shiftDownT: -9, shiftFirst: false, lastPressT: -9, lastPressDir: 0,
    drift: { on: false, dir: 0, t: 0, tier: 0, kind: '', pulled: false, spurts: 0, whip: false, whipArmed: false, firstPressT: 0, lowT: 0 },
    straighten: 0, light: 0, lightAge: 0, lightTier: 0, lightDouble: false, pendTier: 0, pendDouble: false,
    snapWin: 0, lastDir: 0, chain: 0, recover: 0,
    b: { micro: 0, nitro: 0, pad: 0, start: 0, turbo: 0, magnet: 0, air: 0 }, microPow: 0, nitroPow: 0.3,
    gauge: 0, bottles: 0, seq: [],
    stun: 0, stunKind: '', spinA: 0, shield: 0, turtle: 0, fog: 0, invuln: 0, bubbleY: 0, wrongT: 0, wrong: false,
    items: [null, null], roll: [0, 0], lock: 0, rb: 1, bump: 0, wallT: 0, prevX: 0, prevZ: 0, prevY: 0, prevH: 0,
    ai: null
  };
}

export const NOIN = { up: false, down: false, steer: 0, drift: false, upTap: false, nitro: false, item1: false, item2: false, reset: false };

// ---- boosts ------------------------------------------------------------------------------------
function pushSeq(k, C, ch) {
  const t = C.time;
  k.seq = k.seq.filter((e) => t - e.t < 1.6); k.seq.push({ c: ch, t });
  const s = k.seq.map((e) => e.c).join('');
  const combo = s.endsWith('WCW') ? 'WCW' : s.endsWith('CWW') ? 'CWW' : s.endsWith('CW') ? 'CW' : '';
  if (combo) { C.emit(k, 'combo', { combo }); if (combo !== 'CW') k.seq = []; }
}
function addGauge(k, C, v) {
  if (C.mode === 'item') return;
  k.gauge += v;
  while (k.gauge >= 1) {
    if (k.bottles < 2) { k.bottles++; k.gauge -= 1; C.emit(k, 'bottle', { n: k.bottles }); }
    else { k.gauge = 1; break; }
  }
}
export function boost(k, C, kind, o = {}) {
  const b = k.b, st = k.st;
  if (kind === 'micro') {
    const tier = o.tier || 0, perfect = !!o.perfect;
    b.micro = Math.max(b.micro, (0.5 + 0.1 * tier) * (perfect ? 1.2 : 1));
    k.microPow = Math.max(b.micro > 0 ? k.microPow : 0, (0.1 + 0.022 * tier + (perfect ? 0.03 : 0)) * st.micro);
    addGauge(k, C, (perfect ? 0.06 : 0.035) * st.drift);
    C.emit(k, 'micro', { perfect, dbl: !!o.dbl, tier, chain: k.chain });
    pushSeq(k, C, 'W');
  } else if (kind === 'air' || kind === 'land') {
    b.micro = Math.max(b.micro, kind === 'air' ? 0.6 : 0.75);
    k.microPow = Math.max(k.microPow, (kind === 'air' ? 0.12 : 0.14) * st.micro);
    C.emit(k, kind === 'air' ? 'airBoost' : 'landBoost', {});
    pushSeq(k, C, 'W');
  } else if (kind === 'start') {
    b.start = o.perfect ? 1.5 : 1.2; C.emit(k, 'start', { perfect: !!o.perfect });
  } else if (kind === 'nitro') {
    b.nitro = Math.max(0, b.nitro) + 2.3 * Math.sqrt(st.nitro);
    k.nitroPow = 0.3 * Math.sqrt(st.nitro);
    C.emit(k, 'nitro', {});
    pushSeq(k, C, 'C');
  } else if (kind === 'pad') {
    if (b.pad < 0.3) C.emit(k, 'pad', {});
    b.pad = 1.0;
  } else if (kind === 'turbo') {
    b.turbo = 2.4; C.emit(k, 'turbo', {});
  }
}
export function useNitro(k, C) {
  if (k.bottles <= 0 || k.stun > 0 || C.mode === 'item') return false;
  k.bottles--; boost(k, C, 'nitro'); return true;
}
export const boosting = (k) => k.b.micro > 0 || k.b.nitro > 0 || k.b.pad > 0 || k.b.start > 0 || k.b.turbo > 0 || k.b.magnet > 0;

// ---- drift ------------------------------------------------------------------------------------
function startDrift(k, C, dir, kind) {
  const d = k.drift, keepT = kind === 'snap' ? d.t : 0;
  Object.assign(d, { on: true, dir, t: keepT, tier: 0, kind, pulled: false, spurts: 0, whip: false, whipArmed: false, firstPressT: C.time, lowT: 0 });
  k.h += dir * (kind === 'snap' ? 0.24 : 0.15);
  if (kind === 'snap') { k.chain++; addGauge(k, C, 0.04 * k.st.drift); C.emit(k, 'snap', {}); }
  else if (kind === 'chain') { k.chain++; C.emit(k, 'chain', {}); }
  else k.chain = 0;
  k.snapWin = 0;
  k.straighten = 0; // a pending light is cancelled by the next drift (an already-lit one can still be tapped)
}
function endDrift(k, C, why) {
  const d = k.drift;
  if (!d.on) return;
  d.on = false; k.recover = 0.3;
  if (why !== 'release') { k.straighten = 0; return; }
  k.lastDir = d.dir; k.snapWin = d.t >= 0.2 ? WIN.snap : 0;
  if (d.t < WIN.tap && !d.pulled) { addGauge(k, C, 0.025 * k.st.drift); C.emit(k, 'tap', {}); }
  else if (d.whip) C.emit(k, 'whipEnd', {});
  if (d.t >= 0.12) { k.straighten = WIN.straighten; k.pendTier = d.tier; k.pendDouble = d.spurts >= 1 || k.chain > 0 && k.chainSpurt; }
}
function openLight(k, C, tier, dbl) {
  k.light = WIN.micro; k.lightAge = 0; k.lightTier = tier; k.lightDouble = dbl;
  C.emit(k, 'light', { dbl });
}

// ---- hits -------------------------------------------------------------------------------------
export function hitKart(k, C, kind, from) {
  if (k.invuln > 0 || k.finished && k.isPlayer) return false;
  if (k.shield > 0 && kind !== 'magnet') { k.shield = 0; C.emit(k, 'blocked', { kind }); return false; }
  const w = 1.15 - 0.15 * k.st.weight;
  endDrift(k, C, 'hit'); k.light = 0; k.straighten = 0;
  if (kind === 'missile') { k.stun = 1.3 * w; k.stunKind = 'tumble'; k.vy = 9; k.grounded = false; k.spd *= 0.3; k.b.nitro = 0; k.b.micro = 0; }
  else if (kind === 'banana') { k.stun = 1.0 * w; k.stunKind = 'spin'; k.spd *= 0.45; }
  else if (kind === 'bubble') { k.stun = 1.6 * w; k.stunKind = 'bubble'; k.spd *= 0.35; }
  else if (kind === 'turtle') { k.turtle = 3.2 * w; }
  else if (kind === 'devil') { k.devil = 3.2 * w; }
  else if (kind === 'tornado') { k.stun = 1.7 * w; k.stunKind = 'tornado'; k.vy = 13; k.grounded = false; k.spd *= 0.35; k.b.nitro = 0; k.b.micro = 0; }
  else if (kind === 'fog') { k.fog = 3.6; }
  else if (kind === 'wall') { k.stun = 0.4; k.stunKind = 'spin'; }
  C.emit(k, 'hit', { kind, from });
  return true;
}

// ---- road queries ----------------------------------------------------------------------------
export function groundY(T, k) {
  const P = T.paths[k.path];
  if (P.fl[k.idx] & F.GAP) return -80;
  return heightAt(P, k.idx, k.x, k.z);
}
function locate(T, k) {
  let P = T.paths[k.path];
  let i = nearestLocal(P, k.x, k.z, k.idx, 5);
  // walked off the end of a branch: back onto the loop
  if (!P.closed && (i >= P.n - 1 || i <= 0)) {
    const M = T.main, g = i <= 0 ? P.from : P.to;
    k.path = 0; P = M; i = nearestLocal(M, k.x, k.z, g, 14);
  }
  k.idx = i;
  let lat = lateral(P, i, k.x, k.z);
  if (P.near[i] && Math.abs(lat) > P.hw[i] * 0.45) {
    for (const q of P.near[i]) {
      const Q = T.paths[q];
      const g = q === 0 ? Math.round(P.prog[i]) % T.N : nearestGlobal(Q, k.x, k.z, P.y[i]);
      const j = nearestLocal(Q, k.x, k.z, g, q === 0 ? 14 : 4);
      const lq = lateral(Q, j, k.x, k.z);
      if (Math.abs(lq) < Q.hw[j] - 0.4 && Math.abs(Q.y[j] - P.y[i]) < 2.5 && (Math.abs(lq) / Q.hw[j] < Math.abs(lat) / P.hw[i])) {
        if (!Q.closed && (j <= 0 || j >= Q.n - 1)) continue;
        k.path = q; k.idx = j; P = Q; i = j; lat = lq; break;
      }
    }
  }
  k.lat = lat;
  return P;
}

export function placeOnTrack(T, k, pathId, i, lat) {
  const P = T.paths[pathId];
  k.path = pathId; k.idx = i;
  k.x = P.x[i] + P.nx[i] * lat; k.z = P.z[i] + P.nz[i] * lat;
  k.y = P.y[i]; k.vy = 0; k.grounded = true; k.airT = 0;
  k.h = k.vh = Math.atan2(P.tx[i], P.tz[i]);
  k.prevX = k.x; k.prevZ = k.z; k.prevY = k.y; k.prevH = k.h;
}

export function resetKart(T, k, C) {
  let P = T.paths[k.path], i = k.idx;
  for (let s = 0; s < 40 && (P.fl[i] & (F.GAP | F.RAMP)); s++) i = wrap(P, i + 1);
  if (!P.closed && (i > P.n - 4)) { k.path = 0; P = T.main; i = nearestLocal(P, k.x, k.z, P.to || 0, 20); }
  placeOnTrack(T, k, k.path, i, clamp(k.lat, -P.hw[i] + 2.5, P.hw[i] - 2.5) * 0.5);
  k.spd = 0; k.stun = 0; k.spinA = 0; k.drift.on = false; k.light = 0; k.straighten = 0;
  Object.keys(k.b).forEach((key) => (k.b[key] = 0));
  k.invuln = 1.5; k.wrongT = 0; k.wrong = false;
  C.emit(k, 'reset', {});
}

// ---- countdown: engine revs and the 起步喷 window -----------------------------------------------
export function countdownInput(k, inp, toGo, C) {
  if (inp.upTap && !k.startTried) {
    k.startTried = true;
    if (toGo <= WIN.start[1] && toGo >= 0) k.startQueued = { perfect: toGo < 0.12 };
    else C.emit(k, 'early', {});
  }
}
export function onGo(k, C) {
  if (k.startQueued) boost(k, C, 'start', k.startQueued);
  k.startQueued = null;
}
export function lateStart(k, inp, sinceGo, C) {
  if (inp.upTap && !k.startTried && sinceGo <= -WIN.start[0]) { k.startTried = true; boost(k, C, 'start', { perfect: sinceGo < 0.05 }); }
  else if (inp.upTap) k.startTried = true;
}

// ---- main step -------------------------------------------------------------------------------
export function stepKart(k, inp, dt, C) {
  const T = C.T, st = k.st, b = k.b, t = C.time;
  k.prevX = k.x; k.prevZ = k.z; k.prevY = k.y; k.prevH = k.h + k.spinA;
  for (const key in b) if (b[key] > 0) b[key] = Math.max(0, b[key] - dt);
  if (b.micro <= 0) k.microPow = 0;
  k.recover = Math.max(0, k.recover - dt); k.snapWin = Math.max(0, k.snapWin - dt); k.landWin = Math.max(0, k.landWin - dt);
  k.shield = Math.max(0, k.shield - dt); k.turtle = Math.max(0, k.turtle - dt); k.fog = Math.max(0, k.fog - dt);
  k.invuln = Math.max(0, k.invuln - dt); k.slow = Math.max(0, (k.slow || 0) - dt); k.bump = Math.max(0, k.bump - dt); k.lock = Math.max(0, k.lock - dt);
  if (k.stun > 0) { k.stun -= dt; if (k.stun <= 0) { k.stun = 0; k.spinA = 0; } }

  const ctrl = k.stun <= 0;
  let steer = ctrl ? clamp(inp.steer, -1, 1) : 0;
  // 恶魔: controls reversed (rivals catch on after a moment)
  if (k.devil > 0) { k.devil = Math.max(0, k.devil - dt); if (k.isPlayer || k.devil > 2.3) steer = -steer; }
  const sdir = steer > 0.25 ? 1 : steer < -0.25 ? -1 : 0;
  const press = sdir !== 0 && sdir !== k.prevSdir;
  k.prevSdir = sdir;
  const shiftDown = inp.drift && !k.prevDrift;
  k.prevDrift = inp.drift;
  if (shiftDown) { k.shiftDownT = t; k.shiftFirst = sdir === 0; }
  if (inp.reset && ctrl) { resetKart(T, k, C); return; }

  // ---- drift state machine
  const d = k.drift;
  let slip = angDiff(k.h, k.vh);
  if (d.on) {
    d.t += dt;
    let tier = 0; for (let q = 1; q < TIERS.length; q++) if (d.t >= TIERS[q].t) tier = q;
    if (tier > d.tier) { d.tier = tier; C.emit(k, 'tier', { tier }); }
    if (!inp.drift || !ctrl) endDrift(k, C, ctrl ? 'release' : 'hit');
    else if (Math.abs(k.spd) < 9) endDrift(k, C, 'slow');
    else {
      // 甩尾: Shift held first, then the direction tapped twice
      if (d.whipArmed && !d.whip && press && sdir === d.dir && t - d.firstPressT < WIN.whip) {
        d.whip = true; k.h += d.dir * 0.3; C.emit(k, 'whip', {});
      }
      // 拉车头: counter-steer until nearly straight → first light (Shift still held)
      if (!d.pulled && sdir === -d.dir && d.t > 0.3 && Math.abs(slip) < WIN.pullSlip) {
        d.pulled = true; openLight(k, C, d.tier, false);
      }
      // held counter-steer with the nose straight for a while: the drift ends by itself
      if (sdir === -d.dir && Math.abs(slip) < 0.06) { d.lowT += dt; if (d.lowT > 0.45) endDrift(k, C, 'release'); } else d.lowT = 0;
    }
  } else if (ctrl && inp.drift && sdir !== 0 && k.spd > 14 && k.grounded) {
    let kind = 'normal';
    if (k.snapWin > 0 && t - k.shiftDownT < 0.12) kind = sdir === k.lastDir ? 'snap' : 'chain';
    startDrift(k, C, sdir, kind);
    if (k.shiftFirst && t - k.shiftDownT < 1.5 && kind === 'normal') { d.whipArmed = true; d.firstPressT = t; }
  }

  // straighten → the 喷 light
  slip = angDiff(k.h, k.vh);
  if (k.straighten > 0) {
    k.straighten -= dt;
    if (Math.abs(slip) < 0.14 || k.straighten <= 0) { k.straighten = 0; openLight(k, C, k.pendTier, k.pendDouble); }
  }
  if (k.light > 0) { k.lightAge += dt; k.light -= dt; if (k.light <= 0) { k.light = 0; C.emit(k, 'lightOut', {}); } }

  // ↑ taps: 空喷 / 落地喷 / 小喷 / 双喷
  if (inp.upTap && ctrl) {
    if (!k.grounded && k.airT > WIN.airMin && !k.airBoosted) { k.airBoosted = true; boost(k, C, 'air'); }
    else if (k.grounded && k.landWin > 0) { k.landWin = 0; boost(k, C, 'land'); }
    else if (k.light > 0) {
      const perfect = k.lightAge <= WIN.perfect;
      const dbl = k.lightDouble;
      k.light = 0;
      boost(k, C, 'micro', { tier: k.lightTier, perfect, dbl });
      if (d.on) { d.spurts++; }
      k.chainSpurt = true;
    } else if (k.straighten > 0) C.emit(k, 'tooEarly', {});
  }
  if (!d.on && k.straighten <= 0 && k.light <= 0 && k.snapWin <= 0) k.chainSpurt = false;
  if (inp.nitro && ctrl) useNitro(k, C);

  // ---- speed
  const P0 = T.paths[k.path];
  const onIce = (P0.fl[k.idx] & F.ICE) !== 0;
  const stairs = P0.kind === 'stairs';
  let top = st.top * k.rb * (k.turtle > 0 ? 0.62 : 1) * (k.slow > 0 ? 0.88 : 1) * (stairs ? 0.9 : 1);
  let add = 0;
  if (b.nitro > 0) add += k.nitroPow;
  if (b.micro > 0) add += k.microPow;
  if (b.pad > 0) add += 0.22;
  if (b.start > 0) add += 0.24;
  if (b.turbo > 0) add += 0.28;
  if (b.magnet > 0) add += 0.25;
  add = Math.min(add, 0.58);
  const vmax = top * (1 + add);
  if (k.stun > 0) {
    k.spd *= Math.pow(k.stunKind === 'bubble' ? 0.25 : 0.45, dt);
    if (k.stunKind === 'spin') k.spinA += dt * 11;
    else if (k.stunKind === 'tumble') k.spinA += dt * 7;
    else if (k.stunKind === 'tornado') k.spinA += dt * 16;
  } else if (!k.grounded) {
    // keep momentum in the air, boosts still push a little
    if (add > 0 && k.spd < vmax) k.spd += 12 * add * dt;
  } else {
    // braking cancels a boost's push (it used to out-accelerate the brakes)
    if (add > 0 && !(inp.down && ctrl)) { if (k.spd < vmax) k.spd = Math.min(vmax, k.spd + (st.accel * 1.4 + 70 * add) * dt); }
    else if (inp.up && k.spd >= -0.5) { if (k.spd < vmax) k.spd += st.accel * (1 - (k.spd / vmax) ** 2) * (d.on ? 0.6 : 1) * dt; }
    if (k.spd > vmax) k.spd = Math.max(vmax, k.spd - ((k.spd - vmax) * 0.9 + 3) * dt);
    if (!inp.up && add <= 0) k.spd -= Math.sign(k.spd) * Math.min(Math.abs(k.spd), (onIce ? 3 : 7) * dt);
    if (inp.down && ctrl) {
      if (k.spd > 0.5) k.spd = Math.max(0, k.spd - 40 * dt);
      else k.spd = Math.max(-13, k.spd - 16 * dt);
    }
    // slopes
    const P = T.paths[k.path], j = wrap(P, k.idx + 1), i0 = wrap(P, k.idx - 1);
    if (!(P.fl[k.idx] & (F.RAMP | F.GAP))) {
      const slope = (P.y[j] - P.y[i0]) / (2 * DS) * Math.cos(angDiff(k.vh, Math.atan2(P.tx[k.idx], P.tz[k.idx])));
      if (Math.abs(slope) < 0.6) k.spd -= GRAV * slope * 0.42 * dt;
    }
  }

  // ---- steering
  const a = Math.abs(k.spd);
  if (k.grounded && k.stun <= 0) {
    if (d.on) {
      const into = sdir === d.dir ? 1 : sdir === 0 ? 0 : -1;
      if (into === -1) {
        // 拉车头: counter-steer swings the nose back toward the direction of travel; the path keeps most of its line
        k.h -= d.dir * st.handling * 2.3 * dt;
        k.vh += angDiff(k.h, k.vh) * Math.min(1, 1.1 * dt);
        if (angDiff(k.h, k.vh) * d.dir < 0) k.h = k.vh;
      } else {
        const yaw = d.dir * st.handling * (into === 1 ? 1.95 : 1.28) * (d.whip ? 1.12 : 1) * clamp(a / 18, 0.5, 1);
        k.h += yaw * dt;
        k.vh += angDiff(k.h, k.vh) * Math.min(1, 1.55 * (onIce ? 0.6 : 1) * dt);
      }
      slip = angDiff(k.h, k.vh);
      const lim = d.whip ? 1.05 : 0.9;
      if (Math.abs(slip) > lim) { k.vh = k.h - Math.sign(slip) * lim; slip = Math.sign(slip) * lim; }
      k.spd -= Math.abs(slip) * (d.whip ? 2.2 : 4.2) * dt;
      if (Math.abs(slip) > 0.12) addGauge(k, C, clamp(a / st.top, 0, 1.2) * clamp(Math.abs(slip) / 0.5, 0, 1.25) * 0.3 * st.drift * dt);
    } else {
      const hi = clamp((a - 18) / 26, 0, 1);
      const yaw = steer * st.handling * (1.75 - 0.82 * hi) * clamp(a / 8, 0, 1) * (k.spd < 0 ? -1 : 1);
      if (k.recover > 0) {
        // 车身回正: after a drift the body swings back in line with the direction of travel
        const s0 = angDiff(k.h, k.vh);
        k.h -= s0 * Math.min(1, 9 * dt);
        k.vh += s0 * Math.min(1, 1.6 * dt);
      }
      k.h += yaw * dt;
      const grip = onIce ? 2.6 : k.recover > 0 ? 5 : 11;
      k.vh += angDiff(k.h, k.vh) * Math.min(1, grip * dt);
      // on ice the tail keeps sliding: a little free gauge for style
      if (onIce && Math.abs(angDiff(k.h, k.vh)) > 0.15 && a > 20) addGauge(k, C, 0.05 * dt);
    }
  } else if (!k.grounded && k.stun <= 0) {
    k.h += steer * 0.9 * dt;
    k.vh += angDiff(k.h, k.vh) * Math.min(1, 0.8 * dt);
  }

  // ---- integrate
  k.x += Math.sin(k.vh) * k.spd * dt;
  k.z += Math.cos(k.vh) * k.spd * dt;
  const P = locate(T, k);

  // walls
  const i = k.idx, hw = P.hw[i];
  const lim = hw - HALF_W, over = Math.abs(k.lat) - lim;
  if (over > 0) {
    const side = Math.sign(k.lat);
    const open = side > 0 ? P.openL[i] : P.openR[i];
    const lim2 = open ? hw + 7 : lim;
    const over2 = Math.abs(k.lat) - lim2;
    if (over2 > 0) {
      k.x -= P.nx[i] * side * over2; k.z -= P.nz[i] * side * over2; k.lat -= side * over2;
      const hp = Math.atan2(P.tx[i], P.tz[i]);
      const fwd = Math.cos(angDiff(k.vh, hp)) >= 0 ? hp : hp + Math.PI;
      const rel = angDiff(k.vh, fwd);
      if (Math.sin(rel) * side * Math.sign(k.spd || 1) > 0) {
        const impact = Math.abs(Math.sin(rel));
        k.spd *= 1 - Math.min(0.7, impact * 0.75 + 0.03);
        k.vh = fwd - side * 0.04 * Math.sign(k.spd || 1);
        const s2 = angDiff(k.h, k.vh);
        if (Math.abs(s2) > 0.5) k.h = k.vh + Math.sign(s2) * 0.5;
        if (impact > 0.32 && d.on) endDrift(k, C, 'hit');
        if (k.wallT <= 0) C.emit(k, 'wall', { impact, x: k.x - P.nx[i] * side * -HALF_W, z: k.z - P.nz[i] * side * -HALF_W, side });
        k.wallT = 0.25;
      }
    }
  }
  k.wallT = Math.max(0, k.wallT - dt);

  // pads
  if (P.fl[i] & F.PAD) for (const p of T.padsByPath[k.path][i] || []) if (Math.abs(k.lat - p.lat) < 3.2 && k.grounded) boost(k, C, 'pad');

  // ---- vertical
  const gy = groundY(T, k);
  if (k.grounded) {
    const yb = k.y + k.vy * dt - 0.5 * GRAV * dt * dt;
    if (gy < yb - 0.06) { k.grounded = false; k.airT = 0; k.airBoosted = false; k.y = yb; k.vy -= GRAV * dt; }
    else {
      // vertical speed comes from the road's slope along the direction of travel (not from position steps,
      // so moving between overlapping road pieces never launches the kart)
      // use the segment behind the kart so a ramp's lip keeps its upward slope until the road drops away
      const Q = T.paths[k.path], c = Math.cos(angDiff(k.vh, Math.atan2(Q.tx[k.idx], Q.tz[k.idx]))) * Math.sign(k.spd || 1);
      const ja = c >= 0 ? wrap(Q, k.idx - 1) : k.idx, jb = c >= 0 ? k.idx : wrap(Q, k.idx + 1);
      const dq = Math.abs(Q.y[jb] - Q.y[ja]) < 1.2 ? (Q.y[jb] - Q.y[ja]) / DS : 0;
      k.vy = clamp(dq * c * Math.abs(k.spd), -30, 30);
      k.y = gy;
    }
    if (k.stunKind === 'tumble' && k.stun > 0) { /* launched by hitKart */ }
  } else {
    k.airT += dt; k.vy -= GRAV * dt; k.y += k.vy * dt;
    if (k.y <= gy) {
      const hard = k.airT;
      k.y = gy; k.vy = 0; k.grounded = true;
      if (hard > 0.3 && k.stun <= 0) { k.landWin = WIN.land; C.emit(k, 'land', { air: hard }); }
      if ((k.stunKind === 'tumble' || k.stunKind === 'tornado') && k.stun > 0.3) k.stun = 0.3;
    }
    if (k.y < gy - 1 && gy < -50 && k.y < P.y[i] - 9) { resetKart(T, k, C); return; }
  }
  if (!k.grounded && k.airT > 5) resetKart(T, k, C);

  // ---- wrong way
  const hp = Math.atan2(P.tx[i], P.tz[i]);
  if (Math.abs(angDiff(k.h, hp)) > 2.1 && k.spd > 4) k.wrongT += dt; else k.wrongT = Math.max(0, k.wrongT - dt * 2);
  k.wrong = k.wrongT > 1.1;
}

// ---- kart vs kart -----------------------------------------------------------------------------
export function collideKarts(ks, C) {
  for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
    const A = ks[a], B = ks[b];
    if (A.ghost || B.ghost) continue;
    const dx = B.x - A.x, dz = B.z - A.z, d2 = dx * dx + dz * dz;
    if (d2 > 5.6 || Math.abs(A.y - B.y) > 1.6 || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = 2.36 - d;
    const ma = A.st.weight, mb = B.st.weight, sa = mb / (ma + mb), sb = ma / (ma + mb);
    A.x -= nx * pen * sa; A.z -= nz * pen * sa; B.x += nx * pen * sb; B.z += nz * pen * sb;
    let avx = Math.sin(A.vh) * A.spd, avz = Math.cos(A.vh) * A.spd, bvx = Math.sin(B.vh) * B.spd, bvz = Math.cos(B.vh) * B.spd;
    const rel = (bvx - avx) * nx + (bvz - avz) * nz;
    if (rel < 0) {
      const j = -(1.35) * rel / (1 / ma + 1 / mb);
      avx -= (j / ma) * nx; avz -= (j / ma) * nz; bvx += (j / mb) * nx; bvz += (j / mb) * nz;
      const upd = (K, vx, vz) => {
        const s = Math.hypot(vx, vz); if (s < 0.01) return;
        const hv = Math.atan2(vx, vz), fwd = Math.cos(angDiff(hv, K.h)) >= 0;
        let nv = fwd ? hv : hv + Math.PI;
        const dv = angDiff(nv, K.h);
        if (Math.abs(dv) > 0.7) nv = K.h + Math.sign(dv) * 0.7; // a shove, not a spin
        K.vh = nv; K.spd = fwd ? s : -s;
      };
      upd(A, avx, avz); upd(B, bvx, bvz);
      if (-rel > 3 && A.bump <= 0 && B.bump <= 0) { A.bump = B.bump = 0.3; C.emit(A, 'bump', { other: B, rel: -rel }); }
    }
  }
}
