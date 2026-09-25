// Match orchestration: actors (player + 9 bots), shared movement physics, separation, spawning, damage and
// kills, medals, modes (team deathmatch / elimination rounds), ammo pickups, team intel, and the camera
// (first person, death cam that frames the killer, spectating in elimination).
import * as THREE from 'three';
import { spawns, pickups as PICKUPS, zoneAt, TEAM_NAMES } from './mapdata.js';
import { makeLoadout, WEAPONS, GRENADES, PRIMARIES } from './weapons.js';
import { Soldier } from './soldier.js';
import { Brain, botWeapon } from './bots.js';
import { eyePos, eyeHeight, aimDir, curWeapon, updateWeapons, updateGrenades, switchTo, dirFrom } from './combat.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const NAMES = [['Hale', 'Orso', 'Brandt', 'Kwan', 'Mercer'], ['Vargas', 'Rook', 'Dmitri', 'Asano', 'Silva']];
export const MODES = {
  tdm: { id: 'tdm', name: 'Team deathmatch', time: 480, limit: 60, respawn: 3.5, prot: 2.2, desc: 'First squad to 60 kills, or the higher score after 8:00. Respawn in your cabin after 3.5 s. Ammo crates refill your reserves.' },
  elim: { id: 'elim', name: 'Elimination', roundTime: 120, wins: 5, freeze: 3.5, desc: 'No respawns. Wipe the other squad to take the round; the round clock favours the team with more alive. First to 5 rounds wins.' },
};

export class Game {
  constructor(sys) {
    Object.assign(this, sys); // R, W, coll, nav, fx, audio, hud, vm, input, settings
    this.actors = []; this.nades = []; this.pickups = []; this.timers = [];
    this.time = 0; this.frame = 0; this.state = 'menu'; this.freeze = false;
    this.intelLog = [[], []];
    this.shakeAmt = 0; this.flinch = V(); this.camYaw = 0; this.camPitch = 0;
    this._buildPickups();
  }
  // ------------------------------------------------------------------------------------------------ setup
  newMatch(opts) {
    // free the previous match's soldiers (their merged geometry is unique; materials are shared)
    for (const a of this.actors) { this.R.scene.remove(a.soldier.group); a.soldier.dispose(); }
    for (const n of this.nades) this.R.scene.remove(n.mesh);
    this.actors = []; this.nades = []; this.timers = [];
    this.mode = MODES[opts.mode] || MODES.tdm;
    this.opts = opts;
    this.scores = [0, 0]; this.roundWins = [0, 0]; this.round = 0;
    this.time = 0; this.matchT = this.mode.time || 0; this.intelLog = [[], []];
    this.firstBlood = false; this.over = false; this.result = null;
    this.freeze = false; this.roundOver = false; this.tense = false; this.clutchVs = 0; this.deathCam = null;
    this.fx.smokes.length = 0;
    const skill = opts.difficulty ?? 1;
    // player
    const P = this.player = this._makeActor(0, 'You', opts.primary || 'r4', false);
    P.soldier.group.visible = false;
    // bots: roles mixed per team (player's team gets 4 bots)
    // same role mix on both sides; the player fills the fifth (rush) slot of the Sentinels
    const roles = ['hold', 'flank', 'rush', 'hold', 'rush'];
    for (let t = 0; t < 2; t++) {
      const n = t === 0 ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const role = roles[i];
        const b = this._makeActor(t, NAMES[t][i], botWeapon(role), true);
        b.role = role;
        const sk = clamp(skill + (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0), 0, 2);
        b.brain = new Brain(this, b, role, sk);
      }
    }
    this.vm.setTeam(0);
    this.pickups.forEach((p) => { p.t = 0; p.mesh.visible = true; });
    for (const p of this.drops || []) this.R.scene.remove(p.mesh);
    this.drops = [];
    if (this.mode.id === 'elim') this._startRound();
    else { for (const a of this.actors) this.spawn(a, true); this.state = 'play'; this.hud.big('Team deathmatch', 'FIRST TO 60 · 8:00', 2.2); }
    this.audio.ui('horn', 0.9);
    this.audio.setMusic('match');
    this.lastKiller = null;
    this.hud.onMatchStart(this);
  }
  _makeActor(team, name, primary, isBot) {
    const a = {
      id: this.actors.length, name, team, isBot, alive: false, hp: 100,
      pos: V(), vel: V(), move: new THREE.Vector2(), yaw: 0, pitch: 0, r: 0.35, h: 1.8, onGround: true, crouching: false, crouchAmt: 0,
      wantCrouch: false, wantJump: false, walking: false, ads: 0, recoil: { p: 0, y: 0 }, recoilComp: 1,
      primary, load: makeLoadout(primary), slot: 0, lastSlot: 1, switchT: 0, nadeSel: null,
      stats: { k: 0, d: 0, a: 0, hs: 0, score: 0, shots: 0, hits: 0 }, streak: 0, multi: 0, multiT: 0, dmgBy: new Map(),
      spawnProt: 0, deadT: 0, blind: 0, footDist: 0, lastShot: -9, role: null,
      soldier: new Soldier(team, this.actors.length + team * 3),
    };
    a.soldier.setWeapon(primary);
    this.R.scene.add(a.soldier.group);
    this.actors.push(a);
    return a;
  }
  // choose a free spawn point: nobody within 1.4 m (fixes stacking on the player), far from enemies
  spawnPoint(team) {
    const pts = spawns[team];
    let best = null, bs = -Infinity;
    for (const p of pts) {
      let near = Infinity, enemy = Infinity;
      for (const b of this.actors) {
        if (!b.alive) continue;
        const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
        near = Math.min(near, d);
        if (b.team !== team) enemy = Math.min(enemy, d);
      }
      if (near < 1.4) continue;
      const sc = Math.min(enemy, 30) + Math.random() * 6;
      if (sc > bs) { bs = sc; best = p; }
    }
    return best || pts[(Math.random() * pts.length) | 0];
  }
  spawn(a, fresh = false) {
    const p = this.spawnPoint(a.team);
    a.pos.set(p.x, 0.02, p.z); a.vel.set(0, 0, 0);
    a.yaw = p.yaw + rand(-0.2, 0.2); a.pitch = 0; a.recoil.p = a.recoil.y = 0;
    a.alive = true; a.hp = 100; a.onGround = true; a.crouching = false; a.crouchAmt = 0; a.h = 1.8; a.blind = 0; a.ads = 0;
    a.spawnProt = this.mode.prot || 0; a.dmgBy.clear(); a.streak = 0; a.nadeT = 0; a.knifeT = 0;
    if (fresh || this.mode.id === 'elim' || a.pendingPrimary) {
      if (a.pendingPrimary) { a.primary = a.pendingPrimary; a.pendingPrimary = null; }
      a.load = makeLoadout(a.primary);
    } else {
      // TDM respawn: full ammo, fresh grenades
      a.load = makeLoadout(a.primary);
    }
    a.slot = 0; a.lastSlot = 1; a.switchT = 0.3; a.nadeSel = null; a.adsToggle = false; a.knifePending = false; a.nadePending = false;
    a.soldier.reset(); a.soldier.setWeapon(a.primary); a.soldier.group.visible = !(a === this.player);
    if (a.brain) a.brain.reset();
    if (a === this.player) { this.vm.equip(a.primary); this.camYaw = a.yaw; this.deathCam = null; this.hud.onSpawn(a); }
  }
  // ------------------------------------------------------------------------------------------------ elimination rounds
  _startRound() {
    this.round++;
    for (const a of this.actors) { a.alive = false; }
    for (const a of this.actors) this.spawn(a, true);
    for (const n of this.nades) this.R.scene.remove(n.mesh);
    this.nades = [];
    this.fx.smokes.length = 0; this.clutchVs = 0;
    for (const p of this.drops) this.R.scene.remove(p.mesh);
    this.drops = [];
    this.roundT = this.mode.roundTime; this.freezeT = this.mode.freeze; this.freeze = true;
    this.state = 'play'; this.roundOver = false; this.roundKills = 0;
    this.hud.big(`Round ${this.round}`, `${this.roundWins[0]} – ${this.roundWins[1]} · FIRST TO ${this.mode.wins}`, this.mode.freeze);
    this.audio.ui('beep', 0.6);
  }
  _endRound(winner, why) {
    if (this.roundOver) return;
    this.roundOver = true;
    if (winner >= 0) this.roundWins[winner]++;
    const P = this.player;
    const me = winner === P.team;
    this.hud.big(winner < 0 ? 'Round drawn' : me ? 'Round won' : 'Round lost', why, 3.5);
    this.audio.ui(me ? 'win' : 'lose', 0.8);
    if (me && P.alive && (this.clutchVs || 0) >= 2) this.medal('clutch');
    if (this.roundWins[0] >= this.mode.wins || this.roundWins[1] >= this.mode.wins) this.after(3.5, () => this.endMatch(this.roundWins[0] > this.roundWins[1] ? 0 : 1));
    else this.after(4.2, () => this._startRound());
  }
  endMatch(winner) {
    if (this.over) return;
    this.over = true; this.state = 'end';
    const P = this.player;
    this.result = { winner, win: winner === P.team, draw: winner < 0 };
    this.audio.ui(this.result.win ? 'win' : 'lose');
    this.audio.setMusic('menu');
    this.hud.onEnd(this);
  }
  after(t, fn) { this.timers.push({ t: this.time + t, fn }); }
  // leave the match: nothing scheduled may fire behind the menu
  abort() {
    this.timers = []; this.state = 'menu'; this.freeze = false; this.deathCam = null;
    for (const n of this.nades) this.R.scene.remove(n.mesh);
    this.nades = []; this.fx.smokes.length = 0;
  }
  // ------------------------------------------------------------------------------------------------ pickups
  _buildPickups() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3f5a34, roughness: 0.6, metalness: 0.2 });
    const band = new THREE.MeshStandardMaterial({ color: 0xffc640, roughness: 0.5, emissive: new THREE.Color(0.6, 0.4, 0.05) });
    this.pickMat = { mat, band };
    this.pickups = PICKUPS.map((p) => {
      const m = this._ammoMesh();
      m.position.set(p.x, p.y + 0.02, p.z); this.R.scene.add(m);
      return { pos: V(p.x, p.y, p.z), mesh: m, t: 0, crate: true };
    });
    this.drops = [];
  }
  _ammoMesh() {
    const G = this._ammoGeo || (this._ammoGeo = { b: new THREE.BoxGeometry(0.46, 0.26, 0.28), s: new THREE.BoxGeometry(0.47, 0.05, 0.285), h: new THREE.TorusGeometry(0.06, 0.012, 5, 10, Math.PI) });
    const g = new THREE.Group();
    const b = new THREE.Mesh(G.b, this.pickMat.mat); b.position.y = 0.13; b.castShadow = true; g.add(b);
    const s = new THREE.Mesh(G.s, this.pickMat.band); s.position.y = 0.2; g.add(s);
    const h = new THREE.Mesh(G.h, this.pickMat.mat); h.position.y = 0.26; g.add(h);
    return g;
  }
  _updatePickups(dt) {
    const take = (a, p) => {
      let got = false;
      for (const w of a.load.guns) { if (w.def.kind === 'knife') continue; const cap = w.def.reserve; if (w.reserve < cap) { w.reserve = Math.min(cap, w.reserve + Math.ceil(cap * 0.6)); got = true; } }
      for (const k of ['frag', 'flash', 'smoke']) if (!a.load.nades[k] && Math.random() < (p.crate ? 0.6 : 0.3)) { a.load.nades[k] = 1; got = true; }
      if (got && a === this.player) { this.hud.pickup('+ AMMO'); this.audio.ui('magin', 0.8); }
      return got;
    };
    for (const p of this.pickups) {
      if (p.t > 0) { p.t -= dt; if (p.t <= 0) p.mesh.visible = true; continue; }
      p.mesh.rotation.y += dt * 0.8;
      for (const a of this.actors) if (a.alive && Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 1.0 && Math.abs(a.pos.y - p.pos.y) < 1.2 && take(a, p)) { p.t = 20; p.mesh.visible = false; break; }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const p = this.drops[i];
      p.t -= dt; p.mesh.rotation.y += dt;
      let used = false;
      for (const a of this.actors) if (a.alive && Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 1.0 && Math.abs(a.pos.y - p.pos.y) < 1.2 && take(a, p)) { used = true; break; }
      if (used || p.t <= 0) { this.R.scene.remove(p.mesh); this.drops.splice(i, 1); }
    }
  }
  _drop(pos) {
    const m = this._ammoMesh(); m.scale.setScalar(0.8);
    const g = this.coll.groundAt(pos.x, pos.z, 0.2, pos.y - 3, pos.y + 1.5);
    const y = g ? g.y : pos.y;
    m.position.set(pos.x, y + 0.01, pos.z); this.R.scene.add(m);
    this.drops.push({ pos: V(pos.x, y, pos.z), mesh: m, t: 25, crate: false });
  }
  // ------------------------------------------------------------------------------------------------ intel / radio / sounds
  intel(team, pos, by) {
    const L = this.intelLog[team];
    L.push({ pos: pos.clone(), zone: zoneAt(pos.x, pos.y + 0.5, pos.z), t: this.time, by });
    if (L.length > 10) L.shift();
    if (team === this.player.team) this.hud.spot(pos, this.time);
  }
  teamIntel(team) { return this.intelLog[team]; }
  radio(a, msg) { if (a.team === this.player.team) this.hud.radio(a.name, msg, false); }
  sound(a, key) {
    const self = a === this.player;
    if (self) this.audio.play(key, { gain: 0.7, verb: 0.1 });
    else this.audio.sfx2(key, a.pos, 0.8, 30);
  }
  noise(pos, loud, who) { for (const b of this.actors) if (b.brain && b.alive) b.brain.hear(pos, loud, who); }
  anim(a, name, len) { if (a === this.player) this.vm.play(name, len); else a.animT = { name, t: 0, len }; }
  onSwitch(a, id) { if (a === this.player) this.vm.equip(id); a.soldier.setWeapon(id); }
  onThrow(a, kind) { if (a === this.player) this.after(0.45, () => { if (a.alive && a.nadeSel) { const k = a.nadeSel; if (!a.load.nades[k]) { const nx = ['frag', 'flash', 'smoke'].find((n) => a.load.nades[n]); if (nx) { a.nadeSel = nx; this.vm.equip(nx); } else switchTo(this, a, a.slot); } } }); }
  onFlashed(s) { this.hud.flash(s); this.audio.ui('tinnitus', s); }
  shake(p, k) { const d = p.distanceTo(this.R.camera.position); this.shakeAmt = Math.max(this.shakeAmt, k * clamp(1 - d / 25, 0, 1)); }
  onFire(a, w, hit) {
    const def = w.def, self = a === this.player;
    const e = eyePos(a, V());
    a.stats.shots++;
    a.soldier.fire();
    // muzzle: first-person from the viewmodel, others from the soldier's gun
    let muzzle;
    if (self) {
      this.vm.fire(def);
      muzzle = this._vmToWorld(this.vm.muzzleWorld);
      const ej = this._vmToWorld(this.vm.ejectWorld);
      if (def.shell) this.after(def.kind === 'shotgun' ? 0.3 : def.kind === 'sniper' ? 0.5 : 0, () => this.fx.shell(ej, V(Math.cos(a.yaw), 0, -Math.sin(a.yaw)), def.shell));
      this.hud.fired(def);
    } else {
      const g = a.soldier.gun;
      muzzle = g ? g.pts.muzzle.clone().applyMatrix4(g.group.matrixWorld) : e.clone();
      if (def.shell && Math.random() < 0.5) this.fx.shell(muzzle.clone().lerp(e, 0.5), V(Math.cos(a.yaw), 0, -Math.sin(a.yaw)), def.shell);
    }
    if (def.kind !== 'knife') {
      this.fx.muzzle(muzzle, aimDir(a, V()), def.kind === 'sniper' || def.kind === 'shotgun' ? 1.5 : 1, !self);
      if (hit && (Math.random() < def.tracer || !self)) this.fx.tracer(self ? muzzle.clone().addScaledVector(aimDir(a, V()), 1.5) : muzzle, hit.pos, def.kind === 'sniper' ? 1.6 : 1);
      // gunshot audio: occluded if no line of sight to the listener
      const occ = !self && !this.coll.los(e.x, e.y, e.z, this.R.camera.position.x, this.R.camera.position.y, this.R.camera.position.z);
      this.audio.gun(def.sound, e, self, occ);
      this.noise(e, def.kind === 'sniper' ? 90 : 60, a);
      // near-miss whiz for the player
      const P = this.player;
      if (!self && P.alive && hit && a.team !== P.team) {
        const pe = eyePos(P, V()), ad = aimDir(a, V());
        const t = pe.clone().sub(e).dot(ad);
        if (t > 3 && t < hit.t && pe.distanceTo(e.clone().addScaledVector(ad, t)) < 1.3) this.audio.play('whiz', { pos: e.clone().addScaledVector(ad, t), gain: 0.8, maxDist: 20 });
      }
    }
  }
  _vmToWorld(p) {
    // viewmodel camera space -> world, using the main camera (same orientation)
    return p.clone().applyMatrix4(this.R.camera.matrixWorld);
  }
  // ------------------------------------------------------------------------------------------------ damage / kills
  damage(v, dmg, info) {
    if (!v.alive || dmg <= 0) return;
    if (v.spawnProt > 0) return;
    const A = info.attacker;
    if (A && A.team === v.team && A !== v) return;
    dmg = Math.round(dmg);
    v.hp -= dmg;
    if (A) { const r = v.dmgBy.get(A) || { dmg: 0, t: 0 }; r.dmg += dmg; r.t = this.time; v.dmgBy.set(A, r); }
    if (info.dir && v !== this.player) v.soldier.hit(info.dir, info.part);
    if (v === this.player) { this.hud.hurt(info, dmg); this.audio.ui('hurt', 0.8); this.flinch.set(rand(-1, 1) * 0.015, 0.02, 0); if (A && A !== v) this.hud.damageFrom(A.pos); }
    if (A === this.player && v !== A) { this.hud.hitmark(info.part === 'head', v.hp <= 0); this.audio.ui(info.part === 'head' ? 'headshot' : 'hitmark', 0.7); }
    if (v.brain && A && A !== v) { v.brain.seen.set(A, { t: this.time, pos: A.pos.clone() }); if (!v.brain.target) { v.brain.target = A; v.brain.reactAt = this.time + 0.25; } }
    if (v.hp <= 0) this.kill(v, info);
  }
  kill(v, info) {
    const A = info.attacker, P = this.player;
    v.alive = false; v.hp = 0; v.stats.d++; v.deadT = 0; v.streak = 0;
    v.killer = A; v.killInfo = info;
    const force = info.explosive ? 9 : info.weapon === 'longbolt' || info.weapon === 'breacher' ? 7 : info.weapon === 'knife' ? 3 : 4;
    v.soldier.die(info.dir || V(0, 0, 1), info.part || 'chest', force, v.vel);
    v.soldier.group.visible = true;
    const hs = info.part === 'head' && !info.explosive;
    if (A && A !== v) {
      A.stats.k++; A.streak++; A.stats.score += 100 + (hs ? 50 : 0);
      if (hs) A.stats.hs++;
      if (this.mode.id === 'tdm') this.scores[A.team]++;
      // assists: anyone else who did 40+ damage in the last 8 s
      for (const [b, r] of v.dmgBy) if (b !== A && b.team !== v.team && r.dmg >= 40 && this.time - r.t < 8) { b.stats.a++; b.stats.score += 50; if (b === P) this.hud.pickup('ASSIST +50'); }
      if (A === P) this._playerKill(v, info, hs);
      if (A.brain && Math.random() < 0.4) A.brain.say(pick(['Enemy down.', 'Got one.', 'Tango down.']), null, 3);
    } else if (this.mode.id === 'tdm') this.scores[v.team] = Math.max(0, this.scores[v.team] - 1);
    this.hud.feed(A, v, info, hs);
    if (v === P) this._playerDied(info);
    if (v.brain && A && A.team === P.team && A !== P && Math.random() < 0.3) { /* teammate kill chatter handled above */ }
    this._drop(v.pos);
    this.noise(v.pos, 20, A);
    if (!this.firstBlood && A && A !== v) { this.firstBlood = true; if (A === P) this.medal('first'); }
    // mode checks
    if (this.mode.id === 'tdm' && (this.scores[0] >= this.mode.limit || this.scores[1] >= this.mode.limit)) this.after(1.2, () => this.endMatch(this.scores[0] >= this.mode.limit ? 0 : 1));
    if (this.mode.id === 'elim' && !this.roundOver) {
      const alive = [0, 1].map((t) => this.actors.filter((a) => a.team === t && a.alive).length);
      if (v.team === P.team && P.alive && alive[P.team] === 1 && !this.clutchVs) this.clutchVs = alive[1 - P.team];
      if (alive[0] === 0 || alive[1] === 0) this._endRound(alive[0] === 0 ? 1 : 0, alive[0] === 0 ? `${TEAM_NAMES[1]} wiped the ${TEAM_NAMES[0]}` : `${TEAM_NAMES[0]} wiped the ${TEAM_NAMES[1]}`);
    }
  }
  _playerKill(v, info, hs) {
    const P = this.player;
    this.audio.ui('kill', 0.8);
    P.multi = this.time - P.multiT < 4 ? P.multi + 1 : 1; P.multiT = this.time;
    const m = [];
    if (P.multi === 2) m.push('double'); else if (P.multi === 3) m.push('triple'); else if (P.multi === 4) m.push('multi'); else if (P.multi >= 5) m.push('rampage');
    if (hs) m.push('headshot');
    if (info.wall) m.push('wallbang');
    if (info.weapon === 'knife') m.push('knife');
    if (info.weapon === 'frag') m.push('boom');
    if (info.dist > 50 && info.weapon !== 'frag') m.push('longshot');
    if (info.dist < 2.2 && info.weapon !== 'knife' && info.weapon !== 'frag') m.push('pointblank');
    if (this.lastKiller === v) { m.push('revenge'); this.lastKiller = null; }
    if (P.hp < 25) m.push('laststand');
    if (this.mode.id === 'elim') { this.roundKills = (this.roundKills || 0) + 1; if (this.roundKills === 5) m.push('ace'); }
    for (const k of m) this.medal(k);
    const streaks = { 3: 'On Fire', 5: 'Unstoppable', 7: 'Dominating', 10: 'Legendary', 15: 'Godlike' };
    if (streaks[P.streak]) { this.hud.banner(streaks[P.streak], P.streak + ' KILL STREAK'); this.audio.ui('medal', 1); }
  }
  medal(k) { this.hud.medal(k); this.audio.ui('medal', 0.7); if (k === 'first') this.hud.banner('First Blood', ''); }
  _playerDied(info) {
    const P = this.player;
    this.lastKiller = info.attacker && info.attacker !== P ? info.attacker : null;
    this.deathCam = { t: 0, from: eyePos(P, V()), yaw: this.camYaw, pitch: this.camPitch, killer: info.attacker, fov: this.R.camera.fov };
    this.hud.onDeath(P, info);
    this.vm.root.visible = false;
    if (this.mode.id === 'tdm') P.respawnAt = this.time + this.mode.respawn;
  }
  // ------------------------------------------------------------------------------------------------ simulation step
  step(dt) {
    this.time += dt; this.frame++;
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].t <= this.time) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
    if (this.state !== 'play') { this._stepCorpses(dt); return; }
    // clocks
    if (this.mode.id === 'tdm') {
      this.matchT -= dt;
      if (this.matchT <= 0 && !this.over) { this.matchT = 0; this.endMatch(this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1); }
      if (this.matchT < 60 && !this.tense) { this.tense = true; this.audio.setMusic('tense'); }
    } else {
      if (this.freeze) { this.freezeT -= dt; if (this.freezeT <= 0) { this.freeze = false; this.hud.big('Go!', '', 0.8); this.audio.ui('beep', 0.9); } }
      else if (!this.roundOver) {
        this.roundT -= dt;
        if (this.roundT <= 0) {
          const alive = [0, 1].map((t) => this.actors.filter((a) => a.team === t && a.alive));
          const hp = alive.map((l) => l.reduce((s, a) => s + a.hp, 0));
          const w = alive[0].length !== alive[1].length ? (alive[0].length > alive[1].length ? 0 : 1) : hp[0] !== hp[1] ? (hp[0] > hp[1] ? 0 : 1) : -1;
          this._endRound(w, 'Time: more of the squad left standing');
        }
      }
    }
    // actors
    for (const a of this.actors) {
      if (!a.alive) {
        a.deadT += dt;
        if (a.isBot && this.mode.id === 'tdm' && a.deadT > this.mode.respawn && !this.over) this.spawn(a);
        continue;
      }
      if (a.spawnProt > 0) a.spawnProt -= dt;
      if (a.blind > 0) a.blind -= dt;
      if (a.brain) a.brain.update(dt);
      this._move(a, dt);
      updateWeapons(this, a, dt);
      if (a.pos.y < -6) this.damage(a, 999, { attacker: null, weapon: 'fall', part: 'chest', dir: V(0, -1, 0), pos: a.pos.clone() });
    }
    if (this.player && !this.player.alive && this.mode.id === 'tdm' && this.time >= (this.player.respawnAt || 0) && !this.over) this.spawn(this.player);
    this._separate();
    updateGrenades(this, dt);
    this._updatePickups(dt);
    this._stepCorpses(dt);
    // soldiers pose
    for (const a of this.actors) {
      if (!a.alive) continue;
      const w = curWeapon(a);
      const an = a.animT;
      if (an) { an.t += dt; if (an.t > an.len) a.animT = null; }
      a.soldier.update(dt, {
        pos: a.pos, yaw: a.yaw, pitch: a.pitch + a.recoil.p * 0.017, vel: a.vel, onGround: a.onGround, crouch: a.crouchAmt,
        reload: w && w.reloading ? 1 - w.reloadT / (w.reloadLen || w.def.reload) : null,
        knife: an && (an.name === 'slash' || an.name === 'stab') ? an.t / an.len : null,
        throw: an && an.name === 'throw' ? an.t / an.len : null,
      });
    }
  }
  _stepCorpses(dt) { for (const a of this.actors) if (!a.alive && a.soldier.rag) a.soldier.stepRagdoll(dt, this.coll); }
  _move(a, dt) {
    const C = this.coll;
    // crouch / tuck
    if (a.wantCrouch && !a.crouching) {
      a.crouching = true;
      if (!a.onGround && !C.blocked(a.pos.x, a.pos.y + 0.5, a.pos.z, a.r * 0.95, 1.25)) { a.pos.y += 0.5; a.crouchAmt = 1; }
    } else if (!a.wantCrouch && a.crouching) {
      if (a.onGround) { if (!C.blocked(a.pos.x, a.pos.y + 0.05, a.pos.z, a.r * 0.9, 1.8)) a.crouching = false; }
      else if (!C.blocked(a.pos.x, a.pos.y - 0.5, a.pos.z, a.r * 0.9, 1.8) && !C.groundAt(a.pos.x, a.pos.z, a.r * 0.9, a.pos.y - 0.5, a.pos.y)) { a.crouching = false; a.pos.y -= 0.5; a.crouchAmt = 0; }
    }
    a.h = a.crouching ? 1.25 : 1.8;
    a.crouchAmt += ((a.crouching ? 1 : 0) - a.crouchAmt) * Math.min(1, dt * 12);
    const w = curWeapon(a);
    let speed = 5.2 * (w ? w.def.speed : 1);
    if (a.walking) speed = Math.min(speed, 2.4);
    if (a.crouching) speed = Math.min(speed, 1.9);
    if (a.ads > 0.5) speed *= 0.62;
    if (this.freeze) speed = 0;
    const wx = a.move.x * speed, wz = a.move.y * speed;
    const k = a.onGround ? Math.min(1, dt * 12) : Math.min(1, dt * 1.6);
    a.vel.x += (wx - a.vel.x) * k; a.vel.z += (wz - a.vel.z) * k;
    if (a.wantJump && a.onGround && !this.freeze) { a.vel.y = 6.0; a.onGround = false; this.sound(a, 'step_' + 'deck'); }
    a.wantJump = false;
    const wasAir = !a.onGround;
    C.move(a, dt);
    if (wasAir && a.onGround && a.landSpeed > 3) {
      if (a === this.player) { this.vm.landed(a.landSpeed); this.landDip = Math.min(0.12, a.landSpeed * 0.012); }
      this.audio.play('land', { pos: a === this.player ? null : a.pos, gain: a === this.player ? 0.4 : 0.8, maxDist: 30 });
    }
    // footsteps (running only: walking and crouching are silent)
    const hs = Math.hypot(a.vel.x, a.vel.z);
    if (a.onGround && hs > 3.0) {
      a.footDist += hs * dt;
      if (a.footDist > 2.0) {
        a.footDist = 0;
        const mat = a.ground ? (a.ground.src.cont ? 'container' : a.ground.mat) : 'deck';
        this.audio.step(mat, a.pos, a === this.player);
        this.noise(a.pos, 16, a);
      }
    } else a.footDist = Math.min(a.footDist, 1.2);
  }
  // push overlapping soldiers apart (nobody walks through anybody)
  _separate() {
    const A = this.actors;
    for (let i = 0; i < A.length; i++) {
      const a = A[i]; if (!a.alive) continue;
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j]; if (!b.alive) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        const min = a.r + b.r;
        if (d >= min) continue;
        if (d < 1e-4) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = Math.hypot(dx, dz); }
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push;
        this.coll.resolve(a); this.coll.resolve(b);
      }
    }
  }
  // ------------------------------------------------------------------------------------------------ camera
  // best death-cam position around `base` with a clear view of `focus`
  _deathSpot(base, focus) {
    const C = this.coll, cands = [base.clone()];
    const toK = focus.clone().sub(base); toK.y = 0; const L = toK.length() || 1; toK.divideScalar(L);
    for (const r of [1.2, 2.5, 4]) for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const h of [0.3, 1.4, 2.8]) cands.push(V(base.x + Math.cos(a) * r, base.y + h, base.z + Math.sin(a) * r));
    }
    for (const t of [0.25, 0.45]) for (const h of [0.5, 2]) cands.push(base.clone().addScaledVector(toK, L * t).add(V(0, h, 0)));
    let best = null, bs = Infinity;
    for (const c of cands) {
      if (C.blocked(c.x, c.y - 0.2, c.z, 0.25, 0.4)) continue;
      if (!C.los(c.x, c.y, c.z, focus.x, focus.y, focus.z) || !C.los(c.x, c.y, c.z, focus.x, focus.y + 0.5, focus.z)) continue;
      const dK = c.distanceTo(focus), down = Math.atan2(c.y - focus.y, Math.hypot(c.x - focus.x, c.z - focus.z));
      const sc = c.distanceTo(base) + (dK < 3.5 ? (3.5 - dK) * 4 : 0) + (down > 0.5 ? (down - 0.5) * 12 : 0);
      if (sc < bs) { bs = sc; best = c; }
    }
    return best;
  }
  updateCamera(dt, R) {
    const cam = R.camera, P = this.player;
    this.shakeAmt *= Math.exp(-dt * 6);
    this.flinch.multiplyScalar(Math.exp(-dt * 12));
    this.landDip = (this.landDip || 0) * Math.exp(-dt * 9);
    if (P.alive || !this.deathCam) {
      const e = eyePos(P, V());
      cam.position.set(e.x, e.y - this.landDip, e.z);
      const sh = this.shakeAmt;
      cam.rotation.set(P.pitch + P.recoil.p * 0.017453 + this.flinch.y + (Math.random() - 0.5) * sh * 0.05, P.yaw + P.recoil.y * 0.017453 + this.flinch.x + (Math.random() - 0.5) * sh * 0.05, 0, 'YXZ');
      this.camYaw = cam.rotation.y; this.camPitch = cam.rotation.x;
      return;
    }
    // death cam: rise out of the body, turn to frame the killer, keep a clear line of sight to them
    const D = this.deathCam;
    D.t += dt;
    let focus = null;
    let K = D.killer && D.killer !== P ? D.killer : null;
    if (this.mode.id === 'elim' && D.t > 4) {
      // spectate a living teammate over the shoulder
      const mates = this.actors.filter((a) => a.team === P.team && a.alive && a !== P);
      if (mates.length) {
        const m = mates[Math.floor(D.t / 8) % mates.length];
        const e = eyePos(m, V()), back = dirFrom(m.yaw, m.pitch, V());
        const want = e.clone().addScaledVector(back, -2.2).add(V(0, 0.45, 0)).addScaledVector(V(Math.cos(m.yaw), 0, -Math.sin(m.yaw)), 0.5);
        const h = this.coll.raycast(e.x, e.y + 0.3, e.z, want.x - e.x, want.y - e.y - 0.3, want.z - e.z, 1, false);
        if (h) want.lerpVectors(V(e.x, e.y + 0.3, e.z), want, Math.max(0, h.t - 0.15));
        cam.position.lerp(want, Math.min(1, dt * 10));
        const tgt = e.clone().addScaledVector(back, 20);
        cam.lookAt(tgt);
        cam.fov += ((this.baseFov || 75) - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix();
        this.hud.spectate(m.name);
        return;
      }
    }
    const body = P.soldier.center(V());
    const rise = Math.min(1, D.t / 0.8);
    const base = D.from.clone().lerp(body.clone().add(V(0, 1.6, 0)), rise * 0.5);
    base.y += rise * 0.9;
    if (K) {
      focus = K.alive ? eyePos(K, V()).add(V(0, -0.25, 0)) : K.soldier.center(V());
      // pick a vantage point near the body that actually sees the killer (re-checked twice a second)
      if (!D.spot || D.t - (D.spotT || 0) > 0.5) { D.spot = this._deathSpot(base, focus) || D.spot || base.clone(); D.spotT = D.t; }
      cam.position.lerp(D.spot, Math.min(1, dt * 3.5));
      const dx = focus.x - cam.position.x, dy = focus.y - cam.position.y, dz = focus.z - cam.position.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const k = Math.min(1, dt * 3.5);
      D.yaw += angD(D.yaw, yaw) * k; D.pitch += (pitch - D.pitch) * k;
      cam.rotation.set(D.pitch, D.yaw, 0, 'YXZ');
      // slow push-in: frame the killer at roughly a third of the screen height
      const dist = cam.position.distanceTo(focus);
      const want = clamp(2 * Math.atan(3.2 / Math.max(1, dist)) * 57.3, 16, this.baseFov || 75);
      cam.fov += ((D.t > 0.6 ? want : this.baseFov || 75) - cam.fov) * Math.min(1, dt * 2);
      cam.updateProjectionMatrix();
    } else {
      // no killer (fell / own grenade): orbit the body
      const a = D.t * 0.4;
      cam.position.lerp(body.clone().add(V(Math.cos(a) * 3, 2.2, Math.sin(a) * 3)), Math.min(1, dt * 3));
      cam.lookAt(body);
      cam.fov += ((this.baseFov || 75) - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix();
    }
  }
}
function angD(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function pick(a) { return a[(Math.random() * a.length) | 0]; }
