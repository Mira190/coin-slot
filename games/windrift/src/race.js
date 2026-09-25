// Race controller: grid, countdown, fixed-step simulation, laps/checkpoints, standings, rubber-banding and
// item mode. No rendering here, so the same code runs headless for tests.

import { KARTS, RIVALS, PAINTS, STEP, WIN } from './data.js';
import { DS, wrap, along, progressOf } from './track.js';
import { makeKart, stepKart, collideKarts, placeOnTrack, countdownInput, onGo, lateStart, NOIN, useNitro } from './physics.js';
import { makeAI, aiInput, aiCountdown, aiSeed } from './ai.js';
import { makeItems, stepItems, useItem } from './items.js';

export const COUNTDOWN = 3.2;

export function createRace(opt) {
  const T = opt.T, mode = opt.mode, laps = opt.laps || T.def.laps || 3;
  aiSeed(opt.seed || (Date.now() % 100000));
  const R = {
    T, mode, laps, karts: [], ranks: [], state: 'countdown', cd: COUNTDOWN, time: 0, sinceGo: 0, events: [], later: [],
    items: null, player: null, doneT: 0, finishOrder: []
  };
  const emit = (k, type, data) => R.events.push({ k, type, data, t: R.time });
  R.C = {
    T, mode, time: 0, dt: STEP, emit, karts: R.karts, racing: false,
    aheadOf: (k) => R.aheadOf(k), behindOf: (k) => R.behindOf(k)
  };

  // grid: player plus seven rivals (time trial: player only)
  const pk = KARTS[opt.kartIdx];
  const player = makeKart({ id: 0, name: { zh: '你', en: 'YOU' }, isPlayer: true, stats: pk, paint: PAINTS[opt.paint].c, kartIdx: opt.kartIdx });
  player.ai = makeAI(0.93);
  R.player = player;
  const entrants = [player];
  if (mode !== 'tt') {
    const skills = [0.8, 0.84, 0.87, 0.9, 0.92, 0.95, 0.98];
    RIVALS.forEach((rv, q) => {
      const k = makeKart({ id: q + 1, name: rv, stats: KARTS[rv.kart], paint: PAINTS[rv.paint].c, kartIdx: rv.kart });
      k.ai = makeAI(skills[q] * (opt.difficulty || 1));
      entrants.push(k);
    });
  }
  // grid slots: 2 columns, staggered, behind the line. Player starts 5th.
  const order = entrants.slice(1).sort((a, b) => b.ai.skill - a.ai.skill);
  if (mode !== 'tt') order.splice(Math.min(4, order.length), 0, player); else order.push(player);
  const M = T.main;
  order.forEach((k, slot) => {
    const back = 8 + slot * 5.5, i = wrap(M, -Math.round(back / DS));
    const lat = (slot % 2 ? -1 : 1) * 4.2;
    placeOnTrack(T, k, 0, i, lat);
    k.lap = 0; k.prog = i; k.cp = 2; k.dist = -(M.n - i);
    k.gridSlot = slot;
    R.karts.push(k);
  });
  R.ranks = R.karts.slice();
  if (mode === 'item') R.items = makeItems(T);

  R.aheadOf = (k) => { const r = R.ranks.indexOf(k); return r > 0 ? R.ranks[r - 1] : null; };
  R.behindOf = (k) => { const r = R.ranks.indexOf(k); return r >= 0 && r < R.ranks.length - 1 ? R.ranks[r + 1] : null; };

  R.step = (pin) => step(R, pin || NOIN);
  return R;
}

function progress(R, k) {
  const T = R.T, N = T.N;
  const prev = k.prog;
  let p = progressOf(T, k.path, k.idx, k.x, k.z);
  p = ((p % N) + N) % N;
  k.prog = p;
  // checkpoints at 1/3 and 2/3 of the loop keep laps honest
  if (k.cp === 0 && p > N / 3 && p < N / 2) k.cp = 1;
  if (k.cp === 1 && p > (2 * N) / 3 && p < (5 * N) / 6) k.cp = 2;
  if (prev > N * 0.75 && p < N * 0.25) {
    if (k.cp === 2) {
      k.cp = 0;
      if (k.lap >= 1 && !k.finished) {
        const lt = R.time - k.lapStart;
        k.lapTimes.push(lt);
        R.C.emit(k, 'lap', { lap: k.lap, time: lt });
      }
      k.lap++; k.lapStart = R.time;
      if (k.lap > R.laps && !k.finished) {
        k.finished = true; k.finishTime = R.time; R.finishOrder.push(k);
        R.C.emit(k, 'finish', { place: R.finishOrder.length, time: R.time });
      } else if (k.lap === R.laps && k.lap > 1) R.C.emit(k, 'finalLap', {});
    } else k.backLap = true;
  } else if (prev < N * 0.25 && p > N * 0.75) {
    // rolled backwards over the line
    if (k.lap > 0 && k.cp === 0) { k.lap--; k.cp = 2; }
  }
  k.dist = (k.lap - 1) * N + p;
}

function rank(R) {
  R.ranks.sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.dist - a.dist;
  });
}

function step(R, pin) {
  const C = R.C, dt = STEP;
  if (R.state === 'countdown') {
    R.cd -= dt;
    for (const k of R.karts) {
      const inp = k.isPlayer ? pin : aiCountdown(k, R.cd);
      countdownInput(k, inp, R.cd, C);
      k.rev = inp.up;
    }
    if (R.cd <= 0) {
      R.state = 'race'; R.time = 0; R.sinceGo = 0; C.racing = true;
      for (const k of R.karts) { onGo(k, C); k.lapStart = 0; }
      C.emit(R.player, 'go', {});
    }
    return;
  }
  if (R.state !== 'race' && R.state !== 'done') return;
  R.time += dt; R.sinceGo += dt; C.time = R.time;
  for (const l of R.later) { l.t -= dt; if (l.t <= 0) { l.fn(); l.dead = true; } }
  R.later = R.later.filter((l) => !l.dead);

  // rubber band toward the player (AI only)
  const P = R.player, N = R.T.N;
  for (const k of R.karts) {
    if (k.isPlayer) { k.rb = 1; continue; }
    const gap = (P.dist - k.dist) * DS; // + = AI behind the player
    const band = R.mode === 'item' ? 1.4 : 1;
    const base = 0.955 + 0.05 * k.ai.skill;
    k.rb = base * (1 + Math.max(-0.075, Math.min(0.1, ((gap > 0 ? gap - 30 : gap + 60) / 1300) * band)));
    if (P.finished) k.rb = base;
  }

  for (const k of R.karts) {
    let inp;
    if (!k.isPlayer || k.finished || R.autopilot) inp = aiInput(k, C);
    else { inp = pin; if (R.sinceGo < 0.5) lateStart(k, inp, R.sinceGo, C); }
    stepKart(k, inp, dt, C);
    if (R.mode === 'item') {
      if (inp.item1 || (inp.nitro && R.mode === 'item')) useItem(R, k, 0);
      if (inp.item2) useItem(R, k, 1);
    }
  }
  collideKarts(R.karts, C);
  if (R.items) stepItems(R, dt);
  for (const k of R.karts) progress(R, k);
  rank(R);

  if (P.finished && R.state === 'race') { R.state = 'done'; R.doneT = 0; }
  // everyone else is home: give the player 25 s, then close the race (unfinished = estimated time)
  if (R.state === 'race' && R.karts.length > 1 && R.karts.every((k) => k.finished || k.isPlayer)) {
    R.allInT = (R.allInT || 0) + dt;
    if (R.allInT > 25) { R.state = 'done'; R.doneT = 0; R.over = true; }
  }
  if (R.state === 'done') {
    R.doneT += dt;
    if (R.doneT > 14 || R.karts.every((k) => k.finished)) R.over = true;
  }
}

// Final standings; unfinished racers get an estimated time from their pace.
export function standings(R) {
  const N = R.T.N;
  return R.ranks.map((k, i) => {
    let time = k.finishTime, est = false;
    if (!k.finished) {
      const total = R.laps * N, done = Math.max(N * 0.05, k.dist);
      time = Math.max(R.time * (total / done), R.time + 0.1 * (i + 1)); est = true;
    }
    const best = k.lapTimes.length ? Math.min(...k.lapTimes) : null;
    return { k, place: i + 1, time, est, best };
  });
}
