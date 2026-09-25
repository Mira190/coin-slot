// Bot brains: perception (FOV + line of sight + smoke/flash + hearing), team callouts shared as intel,
// roles (rush / hold / flank) that pick goals on the nav graph by map area, reaction time + aim error by skill,
// cover selection with peek-and-shoot, strafing, crouching, grenades, stuck recovery.
import * as THREE from 'three';
import { eyePos, aimDir, curWeapon, tryFire, startReload, switchTo, throwGrenade, dirFrom } from './combat.js';
import { zoneAt } from './mapdata.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export const SKILL = [
  { react: [0.55, 0.85], err: 3.2, turn: 2.8, head: 0.12, comp: 0.35, burst: 0.8, strafe: 0.35 },
  { react: [0.3, 0.5], err: 2.0, turn: 5.0, head: 0.28, comp: 0.6, burst: 1.0, strafe: 0.6 },
  { react: [0.17, 0.3], err: 1.2, turn: 7.5, head: 0.45, comp: 0.85, burst: 1.2, strafe: 0.85 },
];
const ROLE_WEAPONS = { hold: ['longbolt', 'longbolt', 'vk12', 'r4'], rush: ['wasp', 'breacher', 'vk12', 'wasp'], flank: ['r4', 'wasp', 'vk12'] };
export function botWeapon(role) { return pick(ROLE_WEAPONS[role]); }

// node sets per team (team 0 owns the stern half: 's_' nodes; team 1 the bow half: 'b_')
function own(team) { return team === 0 ? 's_' : 'b_'; }
function foe(team) { return team === 0 ? 'b_' : 's_'; }
const HOLD = ['br_win_l', 'br_win_m', 'br_win_r', 'walk_a', 'walk_b', 'green_top', 'sec_top', 'hb_in', 'crates_e', 'first_n', 'slant_n'];
const RUSH = ['sec_w', 'corr_w', 'first_n', 'first_s', 'door_m_out', 'door_l_out', 'crates_s', 'green_n', 'mid_a', 'slant_s'];
const MIDS = ['mid_o', 'vp_n', 'vp_s'];
const FLANK = ['pipe_in', 'pipe_b', 'pipe_d', 'pipe_x', 'pipe_out'];

export class Brain {
  constructor(game, a, role, skill) {
    this.g = game; this.a = a; this.role = role; this.S = SKILL[skill];
    this.path = null; this.pi = 0; this.goal = null; this.goalT = 0;
    this.target = null; this.seen = new Map(); // actor -> { t, pos }
    this.reactAt = 0; this.err = V(); this.errT = 0; this.track = 0;
    this.nextPerceive = Math.random() * 0.15; this.strafeT = 0; this.strafeDir = 1;
    this.cover = null; this.coverState = null; this.coverT = 0; this.peek = null;
    this.stuckT = 0; this.lastPos = a.pos.clone(); this.jumpT = 0;
    this.burstLeft = 0; this.burstRest = 0; this.holdT = 0; this.watch = null;
    this.nadeCD = rand(8, 16); this.radioCD = 0; this.said = new Set();
    this.heard = null; this.crouchT = 0; this.flankStage = 0;
    a.recoilComp = 1 - this.S.comp * 0.8;
  }
  reset() { this.path = null; this.goal = null; this.target = null; this.seen.clear(); this.cover = null; this.coverState = null; this.flankStage = 0; this.heard = null; this.nadeCD = rand(6, 14); }
  say(msg, key, cd = 6) {
    const g = this.g;
    if (key && this.said.has(key)) return;
    if (this.radioCD > 0) return;
    this.radioCD = cd;
    if (key) { this.said.add(key); setTimeout(() => this.said.delete(key), 20000); }
    g.radio(this.a, msg);
  }
  // ---------------------------------------------------------------------------------------------- perception
  perceive() {
    const g = this.g, a = this.a;
    const eye = eyePos(a, V()), look = aimDir(a, V());
    let best = null, bestScore = Infinity;
    const blind = (a.blind || 0) > 0.6;
    for (const e of g.actors) {
      if (!e.alive || e.team === a.team) continue;
      const tgt = V(e.pos.x, e.pos.y + 1.2 - e.crouchAmt * 0.45, e.pos.z);
      const to = tgt.clone().sub(eye), d = to.length();
      if (d > 95 || blind) continue;
      to.divideScalar(d);
      const fov = look.dot(to);
      const aware = d < 4.5 || fov > 0.34 || (this.target === e && fov > -0.2);
      if (!aware) continue;
      if (!g.coll.los(eye.x, eye.y, eye.z, tgt.x, tgt.y, tgt.z)) {
        // try the head too (enemy peeking over cover)
        const hd = V(e.pos.x, e.pos.y + 1.62 - e.crouchAmt * 0.5, e.pos.z);
        if (!g.coll.los(eye.x, eye.y, eye.z, hd.x, hd.y, hd.z)) continue;
      }
      if (g.fx.smokeBlocks(eye, tgt)) continue;
      const first = !this.seen.has(e) || g.time - this.seen.get(e).t > 3;
      this.seen.set(e, { t: g.time, pos: e.pos.clone() });
      if (first) {
        g.intel(a.team, e.pos, a);
        if (Math.random() < 0.7) this.say(`Contact, ${zoneAt(e.pos.x, e.pos.y + 0.5, e.pos.z)}!`, null, 4);
      }
      // prefer close targets and ones looking at us
      const threat = aimDir(e, V()).dot(to.clone().negate()) > 0.9 ? 0.7 : 1;
      const sc = d * threat * (e === this.target ? 0.7 : 1);
      if (sc < bestScore) { bestScore = sc; best = e; }
    }
    if (best && best !== this.target) {
      const d = best.pos.distanceTo(a.pos);
      this.reactAt = g.time + rand(...this.S.react) * (d > 40 ? 1.25 : 1) * ((a.blind || 0) > 0 ? 2 : 1);
      this.track = 0;
      this.err.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).multiplyScalar(this.S.err * (0.6 + d / 40));
    }
    this.target = best;
  }
  hear(pos, loud, who) {
    if (!who || who.team === this.a.team) return;
    const d = pos.distanceTo(this.a.pos);
    if (d < loud) this.heard = { pos: pos.clone(), t: this.g.time };
  }
  // ---------------------------------------------------------------------------------------------- goals
  pickGoal() {
    const g = this.g, a = this.a, N = g.nav;
    const intel = g.teamIntel(a.team).filter((i) => g.time - i.t < 12);
    let id = null;
    if (this.role === 'hold') {
      id = own(a.team) + pick(HOLD);
    } else if (this.role === 'flank') {
      if (this.flankStage < FLANK.length && !intel.some((i) => /Pipe Exit/.test(i.zone) && i.zone.startsWith(a.team === 0 ? 'Stern' : 'Bow'))) { id = own(a.team) + FLANK[this.flankStage]; this.flankStage++; if (this.flankStage === 1) this.say('Taking the pipe.', 'flank'); }
      else id = foe(a.team) + pick(['green_n', 'green_e', 'door_l_out', 'first_s', 'cab_door_l', 'drums']);
    } else {
      if (intel.length && Math.random() < 0.6) {
        const it = intel[intel.length - 1];
        const n = N.nearest(it.pos.x, it.pos.y, it.pos.z);
        id = n.id;
      } else id = Math.random() < 0.35 ? pick(MIDS) : foe(a.team) + pick(RUSH);
      if (Math.random() < 0.25) this.say(`Pushing ${N.byId[id] ? N.byId[id].zone : 'up'}.`, 'rush' + id, 10);
    }
    const node = N.byId[id];
    if (!node) return;
    this.setGoal(node);
  }
  setGoal(node) {
    const g = this.g, a = this.a, N = g.nav;
    const from = N.nearestVisible(a.pos.x, a.pos.y, a.pos.z, a.onGround);
    const p = N.path(from, node, (n) => this._danger(n));
    if (!p) { this.path = null; return; }
    this.path = p; this.pi = 0; this.goal = node; this.goalT = g.time;
    // the start node is usually one we just passed: skip ahead to nodes we can walk straight to, so a re-plan
    // never turns the bot around (that back-and-forth was most of the "stuck" events)
    for (let k = 0; k < 2 && a.onGround && this.pi + 1 < p.length; k++) {
      const n = p[this.pi + 1];
      if (Math.abs(n.y - a.pos.y) > 0.3 || Math.hypot(n.x - a.pos.x, n.z - a.pos.z) > Math.hypot(n.x - p[this.pi].x, n.z - p[this.pi].z) + 0.5 || !N.walk(a.pos, n)) break;
      this.pi++;
    }
  }
  _danger(n) {
    // small extra cost near recent enemy sightings so routes spread out
    let c = 0;
    for (const i of this.g.teamIntel(this.a.team)) if (this.g.time - i.t < 8) { const d = Math.hypot(i.pos.x - n.x, i.pos.z - n.z); if (d < 10) c += (10 - d) * 0.4; }
    return c;
  }
  // ---------------------------------------------------------------------------------------------- cover
  findCover(threat) {
    const g = this.g, a = this.a, N = g.nav, C = g.coll;
    const te = eyePos(threat, V());
    let best = null, bs = -Infinity;
    for (const n of N.nodes) {
      if (!n.cover) continue;
      const d = Math.hypot(n.x - a.pos.x, n.z - a.pos.z);
      if (d > 11 || Math.abs(n.y - a.pos.y) > 1.5) continue;
      const hiddenStand = !C.los(te.x, te.y, te.z, n.x, n.y + 1.5, n.z);
      const hiddenCrouch = !C.los(te.x, te.y, te.z, n.x, n.y + 0.95, n.z);
      if (!hiddenCrouch) continue;
      // peek spot: stand up (low cover) or step sideways
      let peek = null;
      if (!hiddenStand) peek = { x: n.x, z: n.z, stand: true };
      else {
        const dx = te.x - n.x, dz = te.z - n.z, L = Math.hypot(dx, dz) || 1, px = -dz / L, pz = dx / L;
        for (const s of [1.1, -1.1]) {
          const x = n.x + px * s, z = n.z + pz * s;
          if (C.blocked(x, n.y + 0.05, z, 0.35, 1.7)) continue;
          if (C.los(te.x, te.y, te.z, x, n.y + 1.5, z)) { peek = { x, z, stand: false }; break; }
        }
      }
      const dt = Math.hypot(n.x - te.x, n.z - te.z);
      const sc = -d * 0.7 + (peek ? 4 : -2) + (dt < 5 ? -6 : 0) + (hiddenStand ? 0.5 : 0);
      if (sc > bs) { bs = sc; best = { node: n, peek, low: !hiddenStand }; }
    }
    return best;
  }
  // ---------------------------------------------------------------------------------------------- update
  update(dt) {
    const g = this.g, a = this.a;
    if (!a.alive) return;
    this.radioCD -= dt; this.nadeCD -= dt;
    if (g.freeze) { a.move.set(0, 0); return; }
    this.nextPerceive -= dt;
    if (this.nextPerceive <= 0) { this.nextPerceive = 0.1 + Math.random() * 0.06; this.perceive(); }
    const w = curWeapon(a);
    // swap to pistol when the primary is dry and there is no time to reload
    if (w && w.def.slot === 0 && w.mag === 0 && w.reserve === 0 && a.load.guns[1].mag + a.load.guns[1].reserve > 0) switchTo(g, a, 1);
    else if (w && w.mag === 0 && !w.reloading && w.reserve > 0) startReload(g, a);
    if (a.hp < 45 && !this.saidHurt) { this.saidHurt = true; this.say("I'm hit!", null, 2); }
    const T = this.target;
    let lookAt = null, wantMove = null, crouch = false, walk = false, ads = false;
    if (T && T.alive) {
      const tp = V(T.pos.x, T.pos.y + (Math.random() < this.S.head ? 1.6 - T.crouchAmt * 0.5 : 1.25 - T.crouchAmt * 0.4), T.pos.z);
      this.track += dt;
      const settle = Math.exp(-this.track * 2.2);
      lookAt = tp.add(this.err.clone().multiplyScalar(settle * 0.1 * tp.distanceTo(a.pos) * 0.1 + settle * 0.35));
      const dist = T.pos.distanceTo(a.pos);
      const kind = w ? w.def.kind : 'rifle';
      ads = (kind === 'sniper' || (kind === 'rifle' && dist > 22)) && Math.hypot(a.vel.x, a.vel.z) < 1.5;
      // cover logic: go hide when hurt or reloading, then peek
      if (!this.cover && (a.hp < 60 || (w && w.reloading)) && Math.random() < 0.08) this.cover = this.findCover(T);
      if (this.cover) {
        const c = this.cover;
        if (!this.coverState) { this.coverState = 'go'; this.setGoal(c.node); }
        if (this.coverState === 'go' && (!this.path || a.pos.distanceTo(V(c.node.x, c.node.y, c.node.z)) < 0.8)) { this.coverState = 'hide'; this.coverT = rand(0.5, 1.3); this.path = null; }
        if (this.coverState === 'hide') {
          crouch = c.low; wantMove = V(c.node.x, c.node.y, c.node.z);
          this.coverT -= dt;
          if (w && w.mag < w.def.mag * 0.5 && !w.reloading) startReload(g, a);
          if (this.coverT <= 0 && !(w && w.reloading)) { this.coverState = c.peek ? 'peek' : 'out'; this.coverT = rand(0.7, 1.5); }
        } else if (this.coverState === 'peek') {
          const pk = c.peek;
          wantMove = V(pk.x, c.node.y, pk.z); crouch = false;
          this.coverT -= dt;
          if (this.coverT <= 0 || (w && w.mag === 0)) { this.coverState = 'hide'; this.coverT = rand(0.6, 1.4); this.peeks = (this.peeks || 0) + 1; if (this.peeks > 3) { this.cover = null; this.coverState = null; this.peeks = 0; } }
        } else if (this.coverState === 'out') { this.cover = null; this.coverState = null; }
      } else {
        // strafe while shooting, sometimes crouch at range
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = rand(0.35, 1.1); this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.crouchT = Math.random() < 0.3 && dist > 12 ? rand(0.6, 1.4) : 0; }
        this.crouchT -= dt; crouch = this.crouchT > 0;
        if (kind === 'sniper' || kind === 'rifle' && dist > 30) { wantMove = null; }
        else if (Math.random() < this.S.strafe) {
          const to = T.pos.clone().sub(a.pos); to.y = 0; to.normalize();
          const side = V(-to.z, 0, to.x);
          const back = dist < 6 && kind !== 'shotgun' && kind !== 'knife' ? -0.5 : kind === 'shotgun' || kind === 'smg' ? 0.6 : 0;
          const at = () => a.pos.clone().addScaledVector(side, 2 * this.strafeDir).addScaledVector(to, back * 2);
          const bad = (p) => g.coll.blocked(p.x, a.pos.y + 0.3, p.z, 0.3, 1.2);
          // strafing into a wall pins the bot: turn round at once, and stand if both sides are blocked
          wantMove = at();
          if (bad(wantMove)) { this.strafeDir *= -1; wantMove = at(); if (bad(wantMove)) wantMove = null; }
        }
      }
      // fire control
      const aimErr = Math.acos(clamp(aimDir(a, V()).dot(lookAt.clone().sub(eyePos(a, V())).normalize()), -1, 1));
      const ok = g.time >= this.reactAt && aimErr < (w && w.def.kind === 'sniper' ? 0.012 : 0.04 + 1 / (dist + 8));
      if (w && ok && (!this.coverState || this.coverState === 'peek' || this.coverState === 'out')) {
        if (w.def.kind === 'sniper' && a.ads < 0.9) { /* wait for the scope */ }
        else if (w.def.kind === 'shotgun' && dist > 22) { /* too far */ }
        else if (this.burstRest > 0) this.burstRest -= dt;
        else {
          if (this.burstLeft <= 0) this.burstLeft = w.def.auto ? Math.round(clamp((40 - dist) / 6, 2, 8) * this.S.burst) : 1;
          if (tryFire(g, a)) { this.burstLeft--; if (this.burstLeft <= 0) this.burstRest = w.def.auto ? rand(0.15, 0.45) * (dist / 20 + 0.5) : rand(0.25, 0.6); }
        }
      }
      // grenade at a target hiding behind low cover at medium range
      if (this.nadeCD <= 0 && dist > 9 && dist < 26 && a.load.nades.frag > 0 && Math.random() < 0.02) this.lob(T.pos, 'frag');
      this.lastTargetPos = T.pos.clone();
      this.lostT = g.time;
    } else {
      this.target = null;
      // lost sight: stay in cover a moment (targets flicker in and out behind boxes) instead of running off and back
      if (this.cover && g.time - this.lostT > 1.5) { this.cover = null; this.coverState = null; }
      // recently lost contact: pre-aim, investigate if pushing
      const recent = this.lastTargetPos && g.time - this.lostT < 4;
      if (recent) {
        lookAt = this.lastTargetPos.clone().add(V(0, 1.3, 0));
        if (this.role !== 'hold' && !this.cover && (!this.goal || g.time - this.goalT > 1.5)) { const n = g.nav.nearest(this.lastTargetPos.x, this.lastTargetPos.y, this.lastTargetPos.z); if (n && (n !== this.goal || !this.path)) this.setGoal(n); }
        if (this.nadeCD <= 0 && a.load.nades.frag > 0 && Math.random() < 0.01) this.lob(this.lastTargetPos, 'frag');
        if (this.role !== 'hold' && this.nadeCD <= 0 && a.load.nades.flash > 0 && this.lastTargetPos.distanceTo(a.pos) < 18 && Math.random() < 0.02) this.lob(this.lastTargetPos, 'flash');
      } else if (this.heard && g.time - this.heard.t < 3) {
        lookAt = this.heard.pos.clone().add(V(0, 1.2, 0));
      }
      if (w && w.mag < w.def.mag * 0.4 && !w.reloading && w.reserve > 0) startReload(g, a);
      if (a.slot !== 0 && a.load.guns[0].mag + a.load.guns[0].reserve > 0) switchTo(g, a, 0);
      // roles
      const moving = this.path && this.pi < this.path.length;
      if (this.cover && !moving) { const c = this.cover.node; wantMove = V(c.x, c.y, c.z); crouch = this.cover.low; }
      else if (!moving) {
        if (this.role === 'hold' && this.goal && a.pos.distanceTo(V(this.goal.x, this.goal.y, this.goal.z)) < 1.2) {
          this.holdT += dt;
          crouch = this.goal.snipe && Math.random() < 0.004 ? !this.crouchHold : this.crouchHold;
          this.crouchHold = crouch;
          if (!this.watch || Math.random() < 0.004) this.watch = this._watchPoint();
          if (this.holdT > rand(18, 40)) { this.holdT = 0; this.pickGoal(); }
          ads = w && w.def.kind === 'sniper' && Math.random() < 0.9;
          if (!lookAt) lookAt = this.watch;
        } else this.pickGoal();
        // utility on the move: smoke an alley when pushing through
        if (this.role === 'rush' && this.nadeCD <= 0 && a.load.nades.smoke > 0 && Math.random() < 0.3) {
          const it = g.teamIntel(a.team).slice(-1)[0];
          if (it && it.pos.distanceTo(a.pos) < 28 && it.pos.distanceTo(a.pos) > 10) this.lob(it.pos.clone().lerp(a.pos, 0.35), 'smoke');
        }
      }
      walk = this.role === 'flank' && this.flankStage > 2 && this.flankStage < FLANK.length + 1;
    }
    // path following
    if (!wantMove && this.path && this.pi < this.path.length && !(this.role === 'hold' && T && this.goal && this.goal.snipe && a.pos.distanceTo(V(this.goal.x, this.goal.y, this.goal.z)) < 2)) {
      const n = this.path[this.pi];
      const dx = n.x - a.pos.x, dz = n.z - a.pos.z, dh = Math.hypot(dx, dz);
      const last = this.pi === this.path.length - 1;
      const prevN = this.path[this.pi - 1];
      // fell off the route (next node is a floor above and not a jump): plan again from here
      if (a.onGround && (prevN ? a.pos.y < Math.min(prevN.y, n.y) - 0.8 : a.pos.y < n.y - 2.5)) { this.path = null; this.goal = null; }
      else if (dh < (last ? 0.5 : 0.75) && Math.abs(n.y - a.pos.y) < 0.9) this.pi++;
      else {
        wantMove = V(n.x, n.y, n.z);
        // jump links: hop + tuck when the next node is well above us and close
        const prev = this.path[this.pi - 1];
        if (a.onGround && n.y > a.pos.y + 0.45 && dh < 1.7 && this.jumpT <= 0) { a.wantJump = true; this.jumpT = 0.6; }
        if (prev && !lookAt) lookAt = V(n.x + dx * 2, n.y + 1.5, n.z + dz * 2);
        // pinned (pushed off the route in a fight, or cornered): re-plan from here instead of pressing on
        if (a.onGround && n.y < a.pos.y + 0.45 && Math.hypot(a.vel.x, a.vel.z) < 0.5) { this.pinT = (this.pinT || 0) + dt; if (this.pinT > 0.35 && this.goal) { this.pinT = 0; this.setGoal(this.goal); } }
        else this.pinT = 0;
      }
    }
    this.jumpT -= dt;
    if (!a.onGround && a.vel.y < 2.5 && this.jumpT > 0) crouch = true; // tuck to clear the ledge
    // stuck detection: only while heading somewhere, not while standing on the cover / peek spot it wants
    if (!wantMove || Math.hypot(wantMove.x - a.pos.x, wantMove.z - a.pos.z) < 0.6) { this.stuckT = 0; this.lastPos.copy(a.pos); }
    else {
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        if (a.pos.distanceTo(this.lastPos) < 0.35) { a.wantJump = a.onGround; this.jumpT = 0.6; this.g.stuckEvents = (this.g.stuckEvents || 0) + 1; (this.g.stuckLog || (this.g.stuckLog = [])).push([+a.pos.x.toFixed(1), +a.pos.y.toFixed(1), +a.pos.z.toFixed(1), this.goal && this.goal.id, this.path && this.path[this.pi] && this.path[this.pi].id, this.coverState, !!this.target, wantMove && [+wantMove.x.toFixed(1), +wantMove.z.toFixed(1)]]); this.path = null; if (this.cover) { this.cover = null; this.coverState = null; } this._unstick = (this._unstick || 0) + 1; if (this._unstick > 2) { this._unstick = 0; this.pickGoal(); } }
        this.stuckT = 0; this.lastPos.copy(a.pos);
      }
    }
    // steering -> movement intent (world direction), look -> yaw/pitch with a turn-rate limit
    a.move.set(0, 0);
    if (wantMove) {
      const dx = wantMove.x - a.pos.x, dz = wantMove.z - a.pos.z, l = Math.hypot(dx, dz);
      if (l > 0.12) a.move.set(dx / l, dz / l);
    }
    if (!lookAt && a.move.lengthSq() > 0) lookAt = V(a.pos.x + a.move.x * 5, a.pos.y + 1.55, a.pos.z + a.move.y * 5);
    if (lookAt) {
      const e = eyePos(a, V());
      const dx = lookAt.x - e.x, dy = lookAt.y - e.y, dz = lookAt.z - e.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const blindK = (a.blind || 0) > 0.5 ? 0.25 : 1;
      const turn = this.S.turn * (T ? 1 : 0.6) * dt * blindK;
      const dyaw = angDiff(a.yaw, yaw);
      a.yaw += clamp(dyaw, -turn, turn) + (T ? 0 : 0);
      a.pitch += clamp(pitch - a.pitch, -turn, turn);
    }
    a.wantCrouch = crouch; a.walking = walk; a.ads = ads ? Math.min(1, a.ads + dt * 5) : Math.max(0, a.ads - dt * 6);
    // recoil control: bots pull down a share of the kick
    a.recoil.p *= 1 - this.S.comp * dt * 4;
  }
  _watchPoint() {
    // look toward the enemy side along a lane, biased by recent intel
    const g = this.g, a = this.a;
    const it = g.teamIntel(a.team).slice(-1)[0];
    if (it && g.time - it.t < 15) return it.pos.clone().add(V(0, 1.3, 0));
    const sx = a.team === 0 ? 1 : -1;
    return V(a.pos.x + sx * 30, 1.4, rand(-9, 9));
  }
  // lob a grenade toward a point: solve launch pitch for a fixed speed
  lob(target, kind) {
    const g = this.g, a = this.a;
    if (a.nadeT > 0) return;
    const e = eyePos(a, V()), dx = target.x - e.x, dz = target.z - e.z, dy = target.y - e.y;
    const R = Math.hypot(dx, dz), v = clamp(R * 0.9 + 6, 8, 17), G = 16;
    const disc = v ** 4 - G * (G * R * R + 2 * dy * v * v);
    if (disc < 0) return;
    const ang = Math.atan((v * v - Math.sqrt(disc)) / (G * R));
    a.yaw = Math.atan2(-dx, -dz);
    a.throwPitch = ang - 0.12; a.throwSpeed = v;
    if (throwGrenade(g, a, kind)) {
      this.nadeCD = rand(14, 26);
      this.say(kind === 'frag' ? 'Frag out!' : kind === 'smoke' ? 'Smoke out!' : 'Flash out!', null, 1);
    }
  }
}
