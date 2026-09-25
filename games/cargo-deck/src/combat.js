// Shooting, penetration, damage, knife, grenades. Shared by the player and the bots.
import * as THREE from 'three';
import { WEAPONS, GRENADES, MULT, spreadOf, falloffMult } from './weapons.js';
import { WATER_Y } from './sea.js';
import { buildGrenade } from './gunmodels.js';

const D2R = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _o = V(), _d = V(), _t = V();
const NADE_TPL = {};

export function eyeHeight(a) { return 1.62 - 0.5 * a.crouchAmt; }
export function eyePos(a, out = V()) { return out.set(a.pos.x, a.pos.y + eyeHeight(a), a.pos.z); }
export function dirFrom(yaw, pitch, out = V()) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
export function aimDir(a, out = V()) { return dirFrom(a.yaw + a.recoil.y * D2R, a.pitch + a.recoil.p * D2R, out); }
export function curWeapon(a) { return a.load.guns[a.slot] || null; }

// ------------------------------------------------------------------------------------------------ weapon timers
export function updateWeapons(game, a, dt) {
  const w = curWeapon(a);
  if (a.switchT > 0) a.switchT -= dt;
  if (!w) return;
  const def = w.def;
  // reload progress
  if (w.reloading) {
    w.reloadT -= dt;
    if (def.shellReload) {
      if (w.reloadT <= 0) {
        if (w.mag < def.mag && w.reserve > 0) { w.mag++; w.reserve--; game.sound(a, 'shellin'); }
        if (w.mag >= def.mag || w.reserve <= 0) { w.reloading = false; if (w.needPump) { w.pumpT = def.pump; w.needPump = false; game.anim(a, 'pump', def.pump); game.sound(a, 'pump'); } }
        else { w.reloadT = def.reload; game.anim(a, 'shell', def.reload); }
      }
    } else if (w.reloadT <= 0) {
      const need = def.mag - w.mag, take = Math.min(need, w.reserve);
      w.mag += take; w.reserve -= take; w.reloading = false;
    } else {
      // foley cues at fixed points of the animation
      const u = 1 - w.reloadT / w.reloadLen;
      if (!w.cue1 && u > 0.14) { w.cue1 = true; game.sound(a, 'magout'); }
      if (!w.cue2 && u > 0.6) { w.cue2 = true; game.sound(a, 'magin'); }
      if (!w.cue3 && w.reloadEmpty && u > 0.76) { w.cue3 = true; game.sound(a, def.kind === 'sniper' ? 'bolt' : 'bolt'); }
    }
  }
  if (w.boltT > 0) { w.boltT -= dt; }
  if (w.pumpT > 0) w.pumpT -= dt;
  // recoil recovery + spread heat
  const idle = game.time - (a.lastShot || 0);
  if (idle > 60 / def.rpm + 0.06) {
    const k = Math.min(1, def.recover * dt * 0.35);
    a.recoil.p -= a.recoil.p * k * 1.6; a.recoil.y -= a.recoil.y * k * 1.6;
    if (idle > 0.32) w.shots = 0;
  }
  w.heat = Math.max(0, w.heat - def.spread.recover * dt);
  // knife windups
  if (a.knifeT > 0) { a.knifeT -= dt; if (a.knifeT <= 0 && a.knifePending) { a.knifePending = false; knifeHit(game, a, a.knifeHeavy); } }
  if (a.nadeT > 0) { a.nadeT -= dt; if (a.nadeT <= 0 && a.nadePending) { a.nadePending = false; releaseGrenade(game, a); } }
}
export function canFire(game, a) {
  const w = curWeapon(a);
  if (!w || !a.alive || a.switchT > 0 || w.reloading && !w.def.shellReload) return false;
  if (w.boltT > 0 || w.pumpT > 0 || game.time < w.next) return false;
  return true;
}
export function startReload(game, a) {
  const w = curWeapon(a);
  if (!w || w.reloading || w.def.kind === 'knife' || w.mag >= w.def.mag || w.reserve <= 0 || a.switchT > 0) return false;
  const def = w.def;
  w.reloading = true; w.cue1 = w.cue2 = w.cue3 = false;
  w.reloadEmpty = w.mag === 0;
  if (def.shellReload) { w.reloadT = def.reload + 0.25; w.needPump = w.mag === 0; game.anim(a, 'shell', def.reload + 0.25); }
  else { w.reloadT = w.reloadLen = w.reloadEmpty ? def.reloadEmpty : def.reload; game.anim(a, w.reloadEmpty ? 'reloadEmpty' : 'reload', w.reloadT); }
  a.ads = 0;
  return true;
}
export function switchTo(game, a, slot) {
  if (slot === a.slot && !a.nadeSel) return;
  const w = a.load.guns[slot];
  if (!w) return;
  const cw = curWeapon(a); if (cw) { cw.reloading = false; }
  a.lastSlot = a.slot; a.slot = slot; a.nadeSel = null;
  a.switchT = 0.42 + (w.def.kind === 'sniper' ? 0.1 : 0);
  a.ads = 0; a.knifePending = false;
  game.onSwitch(a, w.id);
  game.sound(a, 'draw');
  // auto reload if empty
  if (w.mag === 0 && w.reserve > 0) game.after(a.switchT + 0.03, () => { if (a.slot === slot && a.alive) startReload(game, a); });
}

// ------------------------------------------------------------------------------------------------ firing
export function tryFire(game, a) {
  const w = curWeapon(a);
  if (!canFire(game, a)) return false;
  const def = w.def;
  if (def.kind === 'knife') return knife(game, a, false);
  if (w.mag <= 0) {
    if (!a.dryClick || game.time - a.dryClick > 0.3) { a.dryClick = game.time; game.sound(a, 'dry'); }
    if (w.reserve > 0 && !w.reloading) startReload(game, a);
    return false;
  }
  if (def.shellReload && w.reloading) { w.reloading = false; } // shotgun can interrupt its reload
  w.mag--; w.next = game.time + 60 / def.rpm; a.lastShot = game.time;
  a.spawnProt = 0;
  const pellets = def.pellets || 1;
  const sp = spreadOf(w, a) * D2R;
  const o = eyePos(a, V());
  const base = aimDir(a, V());
  // perpendicular basis for the spread cone
  const up = Math.abs(base.y) > 0.99 ? V(1, 0, 0) : V(0, 1, 0);
  const rt = V().crossVectors(base, up).normalize(), u2 = V().crossVectors(rt, base).normalize();
  let firstHit = null, hitSomeone = false;
  for (let i = 0; i < pellets; i++) {
    const r = Math.sqrt(Math.random()) * Math.tan(sp), th = Math.random() * Math.PI * 2;
    const d = base.clone().addScaledVector(rt, Math.cos(th) * r).addScaledVector(u2, Math.sin(th) * r).normalize();
    const res = hitscan(game, a, o, d, def, i === 0);
    if (!firstHit) firstHit = res;
    if (res.actor) hitSomeone = true;
  }
  if (hitSomeone) a.stats.hits++;
  // recoil pattern + spread heat
  const pat = def.recoil[Math.min(w.shots, def.recoil.length - 1)];
  const rk = a.isBot ? a.recoilComp : 1;
  a.recoil.y += pat[0] * rk; a.recoil.p += pat[1] * rk;
  w.heat = Math.min(def.spread.maxHeat, w.heat + def.spread.perShot);
  w.shots++;
  if (def.bolt) { w.boltT = def.bolt; game.anim(a, 'bolt', def.bolt); game.after(0.35, () => game.sound(a, 'bolt')); a.ads = 0; }
  if (def.pump) { w.pumpT = def.pump; game.anim(a, 'pump', def.pump); game.after(0.18, () => game.sound(a, 'pump')); }
  game.onFire(a, w, firstHit);
  if (w.mag === 0 && w.reserve > 0 && !a.isBot) game.after(0.26, () => { if (curWeapon(a) === w && a.alive && w.mag === 0) startReload(game, a); });
  return true;
}

// walk a ray through the world and the other soldiers; handles penetration and applies damage
export function hitscan(game, a, o, d, def, fx = true) {
  const range = 400;
  const hits = game.coll.raycastAll(o.x, o.y, o.z, d.x, d.y, d.z, range, true);
  // soldiers along the ray
  const bodies = [];
  for (const b of game.actors) {
    if (b === a || !b.alive || b.team === a.team) continue;
    const r = b.soldier.raycast(o, d, range, game.frame);
    if (r) bodies.push({ t: r.t, part: r.part, b });
  }
  bodies.sort((x, y) => x.t - y.t);
  let power = def.pen, mult = 1, wall = false, i = 0, j = 0, end = range, endN = null, endMat = null;
  while (true) {
    const wh = hits[i], bh = bodies[j];
    if (bh && (!wh || bh.t < wh.t)) {
      const p = o.clone().addScaledVector(d, bh.t);
      const dmg = def.dmg * mult * MULT[bh.part] * falloffMult(def, bh.t);
      game.damage(bh.b, dmg, { attacker: a, weapon: def.id, part: bh.part, dir: d.clone(), pos: p, wall, dist: bh.t });
      if (fx) game.fx.blood(p, d, bh.part === 'head');
      game.audio.impact('flesh', p);
      return { t: bh.t, actor: bh.b, part: bh.part, pos: p };
    }
    if (!wh) break;
    const bx = wh.box;
    const pe = o.clone().addScaledVector(d, wh.t), n = V(wh.nx, wh.ny, wh.nz);
    if (bx.pc === Infinity || power < bx.pc) {
      end = wh.t; endN = n; endMat = bx.mat;
      if (fx) { game.fx.impact(pe, n, bx.mat); if (Math.random() < 0.5) game.audio.impact(bx.mat, pe); }
      break;
    }
    // punch through: entry + exit holes, lose power and damage
    power -= bx.pc; mult *= Math.max(0.3, 1 - bx.pc * 0.32); wall = true;
    if (fx) { game.fx.impact(pe, n, bx.mat); game.fx.impact(o.clone().addScaledVector(d, wh.tOut), n.clone().negate(), bx.mat, true); }
    i++;
  }
  // into the sea?
  if (!endN && d.y < 0) { const tw = (WATER_Y - o.y) / d.y; if (tw < range) { end = tw; if (fx) game.fx.splash(o.clone().addScaledVector(d, tw)); } }
  return { t: end, pos: o.clone().addScaledVector(d, Math.min(end, 300)), mat: endMat };
}

// ------------------------------------------------------------------------------------------------ knife
function knife(game, a, heavy) {
  const w = curWeapon(a), def = w.def;
  w.next = game.time + 60 / (heavy ? def.rpm2 : def.rpm);
  a.knifeT = heavy ? 0.32 : 0.12; a.knifePending = true; a.knifeHeavy = heavy;
  game.anim(a, heavy ? 'stab' : 'slash', heavy ? 0.9 : 0.42);
  game.sound(a, 'swing');
  a.lastShot = game.time; a.spawnProt = 0;
  return true;
}
export function knifeAlt(game, a) { const w = curWeapon(a); if (!w || w.def.kind !== 'knife' || !canFire(game, a)) return false; return knife(game, a, true); }
function knifeHit(game, a, heavy) {
  if (!a.alive) return;
  const def = WEAPONS.knife, o = eyePos(a, V()), d = aimDir(a, V());
  let best = null;
  for (const b of game.actors) {
    if (b === a || !b.alive || b.team === a.team) continue;
    // sweep a few rays in a small fan
    for (const off of heavy ? [0] : [-0.35, -0.15, 0, 0.15, 0.35]) {
      const dd = dirFrom(a.yaw + off, a.pitch - 0.05, V());
      const r = b.soldier.raycast(o, dd, def.range, game.frame);
      if (r && (!best || r.t < best.t)) best = { t: r.t, part: r.part, b };
    }
  }
  if (best && game.coll.los(o.x, o.y, o.z, best.b.pos.x, best.b.pos.y + 1.2, best.b.pos.z)) {
    // backstab: attacker behind the victim (facing the same way) doubles the slash
    const fb = dirFrom(best.b.yaw, 0, V()), back = fb.dot(d) > 0.5;
    const dmg = (heavy ? def.dmg2 : def.dmg) * (best.part === 'head' ? 1.5 : 1) * (back ? 2 : 1);
    const p = o.clone().addScaledVector(d, best.t);
    game.damage(best.b, dmg, { attacker: a, weapon: 'knife', part: best.part, dir: d, pos: p, wall: false, dist: best.t });
    game.fx.blood(p, d, true);
    game.sound(a, 'stab');
  } else {
    const h = game.coll.raycast(o.x, o.y, o.z, d.x, d.y, d.z, def.range);
    if (h) { const p = o.clone().addScaledVector(d, h.t); game.fx.impact(p, V(h.nx, h.ny, h.nz), h.box.mat); game.audio.impact(h.box.mat, p); }
  }
}

// ------------------------------------------------------------------------------------------------ grenades
export function throwGrenade(game, a, kind) {
  if (!a.alive || (a.load.nades[kind] || 0) <= 0 || a.nadeT > 0) return false;
  a.load.nades[kind]--;
  a.nadeKind = kind; a.nadeT = 0.42; a.nadePending = true;
  game.anim(a, 'throw', 0.7);
  game.sound(a, 'pin');
  return true;
}
function releaseGrenade(game, a) {
  if (!a.alive) return;
  const kind = a.nadeKind, o = eyePos(a, V());
  const d = aimDir(a, V());
  const pitch = a.throwPitch != null ? a.throwPitch : a.pitch;
  const dd = dirFrom(a.yaw, pitch + 0.12, V());
  const speed = a.throwSpeed || 15;
  const vel = dd.multiplyScalar(speed).add(V(a.vel.x * 0.6, 0, a.vel.z * 0.6));
  o.addScaledVector(d, 0.4);
  const T = NADE_TPL[kind] || (NADE_TPL[kind] = buildGrenade(kind));
  const mesh = T.clone(); mesh.scale.setScalar(1.4); // clones share the template's geometry
  mesh.position.copy(o); game.R.scene.add(mesh);
  game.nades.push({ kind, owner: a, pos: o, vel, t: 0, fuse: GRENADES[kind].fuse, mesh, spin: V(Math.random() * 10, Math.random() * 10, 0), rest: false });
  game.sound(a, 'throw');
  a.throwPitch = null; a.throwSpeed = null;
  game.onThrow(a, kind);
}
export function updateGrenades(game, dt) {
  const C = game.coll;
  for (let i = game.nades.length - 1; i >= 0; i--) {
    const g = game.nades[i];
    g.t += dt;
    if (!g.rest) {
      g.vel.y -= 16 * dt;
      const step = g.vel.clone().multiplyScalar(dt), L = step.length();
      if (L > 1e-5) {
        const d = step.clone().divideScalar(L);
        const h = C.raycast(g.pos.x, g.pos.y, g.pos.z, d.x, d.y, d.z, L + 0.06, false);
        if (h && h.t < L + 0.06) {
          const n = V(h.nx, h.ny, h.nz);
          g.pos.addScaledVector(d, Math.max(0, h.t - 0.06));
          const vn = g.vel.dot(n);
          g.vel.addScaledVector(n, -1.55 * vn).multiplyScalar(0.62);
          if (Math.abs(vn) > 2) game.audio.sfx2('bounce', g.pos, Math.min(1, Math.abs(vn) / 8), 35);
          if (n.y > 0.6 && g.vel.length() < 0.8) { g.rest = true; g.vel.set(0, 0, 0); }
        } else g.pos.add(step);
      }
      if (g.pos.y < WATER_Y) { g.rest = true; g.sunk = true; }
      g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.y += g.spin.y * dt;
    }
    g.mesh.position.copy(g.pos);
    if (g.t >= g.fuse) { detonate(game, g); game.R.scene.remove(g.mesh); game.nades.splice(i, 1); }
  }
}
function detonate(game, g) {
  const p = g.pos;
  if (g.sunk) { game.fx.splash(p); return; }
  if (g.kind === 'frag') {
    game.fx.explosion(p);
    game.audio.sfx2('explode', p, 1.4, 300);
    for (const b of game.actors) {
      if (!b.alive) continue;
      if (b.team === g.owner.team && b !== g.owner) continue; // no team damage, but your own frag hurts you
      const c = V(b.pos.x, b.pos.y + 1.0, b.pos.z), dist = c.distanceTo(p);
      const R = GRENADES.frag.radius;
      if (dist > R) continue;
      const cover = game.coll.los(p.x, p.y + 0.3, p.z, c.x, c.y, c.z) ? 1 : game.coll.los(p.x, p.y + 0.3, p.z, c.x, c.y + 0.7, c.z) ? 0.6 : 0.15;
      const dmg = GRENADES.frag.dmg * Math.pow(1 - dist / R, 1.3) * cover;
      if (dmg > 2) game.damage(b, dmg, { attacker: g.owner, weapon: 'frag', part: 'chest', dir: c.clone().sub(p).normalize(), pos: c, wall: false, dist, explosive: true });
    }
    game.shake(p, 1.0);
  } else if (g.kind === 'flash') {
    game.fx.flashbang(p);
    game.audio.sfx2('flashbang', p, 1.3, 200);
    for (const b of game.actors) {
      if (!b.alive) continue;
      const e = eyePos(b, V()), dist = e.distanceTo(p);
      if (dist > GRENADES.flash.radius || !game.coll.los(p.x, p.y + 0.2, p.z, e.x, e.y, e.z)) continue;
      const look = aimDir(b, V()), to = p.clone().sub(e).normalize();
      const facing = Math.max(0, look.dot(to));
      const s = (0.35 + 0.65 * facing) * (1 - dist / GRENADES.flash.radius);
      b.blind = Math.max(b.blind || 0, 0.6 + s * 4.2);
      if (b === game.player) game.onFlashed(s);
    }
  } else {
    game.fx.smokeCloud(p.clone(), GRENADES.smoke.life, GRENADES.smoke.radius);
    game.audio.sfx2('smoke', p, 0.8, 50);
  }
}
