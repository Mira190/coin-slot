// Folded Steps: the play controller. Owns the logic state, runs ticks, animates walkers across real and
// impossible joints, turns drags into snaps, raises lifts, keeps the undo stack and asks the solver for hints.
import * as THREE from 'three';
import * as F from './logic.js';
import { World } from './world.js';
import { Cartographer, Lintel, Warden } from './actors.js';
import { PALETTES } from './palettes.js';
import { tween, E, wait } from './tween.js';
import { FXU, RIGHT, UP } from './render.js';
import { clearMats } from './deco.js';

export const TICK = 0.34;
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class Game {
  constructor(app) {
    this.app = app; // { view, audio, fx, water, ui }
    this.busy = 0;
    this.lifting = 0; // the part of busy that is only a lift animating (taps and cranks may go on)
    this.timeScale = 1;
    this.manual = false; // debug autoplay: tick only when an action is queued
    this.queue = [];
    this.reduce = false;
    this.hintReq = 0;
    this.worker = null;
  }
  get view() { return this.app.view; }
  // ---------- level lifecycle ----------
  async load(def, opts = {}) {
    this.unload();
    this.gen = (this.gen || 0) + 1;
    this.busy = 0;
    this.lifting = 0;
    this.hintReq++; // any hint still being computed belongs to the old level
    this.hintPending = false;
    const { view, fx, water, audio } = this.app;
    this.def = def;
    this.P = PALETTES[def.pal] || PALETTES.dawn;
    this.L = F.compile(def);
    this.st = F.init(this.L);
    this.undoStack = [];
    this.turns = 0;
    this.hintUsed = false;
    this.walk = null;
    this.anim = null;
    this.won = false;
    this.dragging = null;
    this.tickT = 0;
    this.queue = [];
    view.setPalette(this.P);
    fx.setPalette(this.P);
    this.world = new World(view.scene, this.P).build(this.L);
    // camera, mist band and lake from the level's screen box; the lake sits a little under the lowest tile
    const b = this.world.bounds(def.water ?? -5, this.L.world ? this.st.m[this.L.world.mi] : null);
    const waterY = Math.max((def.water ?? -5) + 0.42, Math.floor(b.ylo - 2.2) + 0.42);
    this.waterY = waterY;
    this.waterCell = Math.round(waterY - 0.42);
    this.bounds = b;
    const fit = view.fit(b, 0.9);
    view.cam.target.copy(fit.center);
    view.cam.half = fit.half;
    this.camHome = { target: fit.center.clone(), half: fit.half };
    FXU.uMistTop.value = b.v0 - 1.6;
    FXU.uMistBot.value = b.v0 - 8.5;
    water.set(this.P, waterY, b.cx, b.cz, b.rad);
    water.pillars(this.world.pillars(F.graphOf(this.L, this.st), this.waterCell));
    const mid = fit.center.clone();
    fx.setBox(new THREE.Vector3(b.cx, (b.v0 + b.v1) / 2 + 1, b.cz).lerp(mid, 0.3), new THREE.Vector3(b.rad * 1.1, 10, b.rad * 1.1));
    fx.reduce = this.reduce;
    // walkers
    this.player = new Cartographer(view.scene, this.P);
    this.comp = this.L.comp >= 0 ? new Lintel(view.scene, this.P) : null;
    this.sents = this.L.sentinels.map((S, i) => new Warden(view.scene, this.P, i));
    this.placeAll(true);
    audio.setChapter(def.chapter || 0);
    this.app.ui.hud(this);
    if (!opts.instant) await this.intro();
    if (!opts.quiet) this.app.ui.levelStart?.(this);
  }
  unload() {
    if (!this.world) return;
    const sc = this.view.scene;
    this.world.dispose();
    this.player.dispose(sc);
    this.comp?.dispose(sc);
    this.sents.forEach((s) => s.dispose(sc));
    this.world = null;
    this.app.fx.path([]);
    this.app.fx.clearHint();
    clearMats();
  }
  async intro() {
    this.busy++;
    const gen = this.gen;
    const { view } = this.app;
    const nodes = this.world.nodes;
    const home = this.camHome;
    if (this.reduce) {
      await tween(0.5, (k) => { view.grade.uniforms.uFade.value = 1 - k; });
    } else {
      // the level rises out of the mist, group by group, while the camera settles
      nodes.forEach((n) => (n.userData.intro = 1));
      const actors = [this.player, this.comp, ...this.sents].filter(Boolean);
      actors.forEach((a) => (a.visible = false));
      view.grade.uniforms.uFade.value = 1;
      const t0 = tween(0.8, (k) => { view.grade.uniforms.uFade.value = 1 - k; }, E.out);
      await tween(1.7, (k) => {
        nodes.forEach((n, i) => {
          const d = Math.min(1, Math.max(0, (k - i * 0.06) / 0.8));
          n.userData.intro = 1 - E.soft(d);
        });
        if (gen !== this.gen) return;
        view.cam.half = home.half * (1.12 - 0.12 * E.io(k));
        this.world.sync(); this.applyIntro();
      }, E.lin);
      await t0;
      if (gen !== this.gen) return;
      nodes.forEach((n) => (n.userData.intro = 0));
      this.world.sync();
      actors.forEach((a) => { a.visible = true; a.g.scale.setScalar(0.01); });
      await tween(0.45, (k) => actors.forEach((a) => a.g.scale.setScalar(Math.max(0.01, E.back(k)))), E.lin);
    }
    this.busy--;
  }
  applyIntro() {
    for (const n of this.world.nodes) {
      const k = n.userData.intro || 0;
      if (k) { n.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, -7 * k, 0)); n.matrixWorldNeedsUpdate = true; }
    }
    this.world.root.updateMatrixWorld(true);
  }
  // ---------- placement ----------
  restPos(t, out) {
    if (t === F.HEAD) {
      const r = this.world.tileWorld(this.st.c);
      r.c.addScaledVector(r.n, 1.0);
      out.c.copy(r.c); out.n.copy(r.n);
      return out;
    }
    return this.world.tileWorld(t, out);
  }
  placeAll(snap) {
    const tmp = { c: new THREE.Vector3(), n: new THREE.Vector3() };
    const put = (a, t) => { this.restPos(t, tmp); a.place(tmp.c, tmp.n); if (snap) a.orient(0, true); };
    put(this.player, this.st.p);
    if (this.comp) { put(this.comp, this.st.c); this.comp.setFollow(!!this.st.cm); }
    F.sentTiles(this.L, this.st).forEach((t, i) => put(this.sents[i], t));
    if (snap) { this.player.fwd.set(1, 0, 1).normalize(); this.player.orient(0, true); this.player.scarfInit = false; }
    if (this.world.glim) this.world.glim.visible = !this.st.g;
  }
  // ---------- commands ----------
  // a lift still rising or sinking doesn't block input: the logic already stands in its new pose, and ticks
  // (so any walk you queue) wait for the animation
  canAct() { return this.world && !this.won && this.busy <= this.lifting && !this.dragging; }
  tapTile(t) {
    if (!this.canAct()) return false;
    if (this.manual) return false;
    const Gr = F.graphOf(this.L, this.st);
    const w = F.tileW(this.L, Gr, this.st, t);
    if (!w || (t !== F.HEAD && !w.active)) return false;
    if (t === this.st.p) { this.app.fx.tap(V3(w.c), V3(w.n)); this.walk = null; this.app.fx.path([]); return true; }
    const path = F.path(this.L, this.st, t);
    const tmp = { c: new THREE.Vector3(), n: new THREE.Vector3() };
    this.restPos(t, tmp);
    if (!path) { this.app.fx.tap(tmp.c, tmp.n, true); this.app.audio.no(this.pan(tmp.c)); return false; }
    this.app.fx.tap(tmp.c, tmp.n);
    this.pushUndo();
    this.walk = { target: t, path: path.slice(1) };
    this.app.fx.path(path.slice(1).map((x) => { const o = { c: new THREE.Vector3(), n: new THREE.Vector3() }; return this.restPos(x, o); }));
    this.app.fx.clearHint();
    this.tickT = TICK; // first step starts promptly
    return true;
  }
  toggleCompanion() {
    if (!this.canAct() || !this.comp) return false;
    const ns = F.toggle(this.L, this.st);
    if (!ns) { this.app.audio.no(); return false; }
    this.pushUndo();
    this.st = ns;
    this.comp.setFollow(!!ns.cm);
    this.app.audio.stone(!!ns.cm, this.pan(this.comp.g.position));
    this.app.fx.sparkle(this.comp.g.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 12, this.P.glow, 0.6, 0.6);
    this.app.ui.toast(ns.cm ? 'Lintel follows you.' : 'Lintel waits here.', 1600);
    this.app.fx.clearHint();
    return true;
  }
  pushUndo() {
    this.undoStack.push({ st: this.st, turns: this.turns });
    if (this.undoStack.length > 200) this.undoStack.shift();
  }
  async undo() {
    if (!this.world || this.won || this.busy || this.dragging || !this.undoStack.length) return;
    const u = this.undoStack.pop();
    await this.restore(u.st, u.turns);
  }
  async restart() {
    if (!this.world || this.busy || this.dragging) return;
    this.won = false;
    this.pushUndo();
    await this.restore(F.init(this.L), 0, true);
    this.hintUsed = false;
  }
  async restore(st, turns, fade) {
    this.busy++;
    const gen = this.gen;
    const alive = () => gen === this.gen;
    this.walk = null; this.anim = null; this.queue = [];
    this.app.fx.path([]); this.app.fx.clearHint();
    const g = this.view.grade.uniforms.uFade;
    if (fade) await tween(this.reduce ? 0.15 : 0.35, (k) => (g.value = k * 0.85));
    const vm0 = this.world.vm.slice(), vl0 = this.world.vl.slice();
    const vm1 = st.m.map((v, i) => nearestEquiv(vm0[i], v, this.L.mechs[i].src.cyc)), vl1 = st.lift.slice();
    const actors = [this.player, this.comp, ...this.sents].filter(Boolean);
    await tween(fade ? 0.01 : 0.18, (k) => actors.forEach((a) => a.g.scale.setScalar(1 - k * 0.99)));
    if (!alive()) return;
    this.st = st; this.turns = turns;
    await tween(fade || this.reduce ? 0.05 : 0.45, (k) => { if (alive()) this.world.setView(vm0.map((v, i) => v + (vm1[i] - v) * k), vl0.map((v, i) => v + (vl1[i] - v) * k)); });
    if (!alive()) return;
    this.world.setView(st.m.slice(), st.lift.slice());
    this.placeAll(true);
    await tween(0.25, (k) => actors.forEach((a) => a.g.scale.setScalar(0.01 + 0.99 * E.back(k))), E.lin);
    if (fade) await tween(0.35, (k) => (g.value = (1 - k) * 0.85));
    this.app.water.pillars(this.world.pillars(F.graphOf(this.L, this.st), this.waterCell));
    this.app.ui.hud(this);
    this.busy--;
  }
  // ---------- mechanisms ----------
  beginDrag(i) {
    if (!this.canAct()) return false;
    if (this.anim) this.finishAnim();
    this.walk = null; this.app.fx.path([]);
    this.app.fx.clearHint();
    this.dragging = { i, v0: this.world.vm[i], v: this.world.vm[i], lastTick: Math.round(this.world.vm[i] * 6), lastT: performance.now() };
    const G = this.L.mechs[i];
    if (G.kind === 'slider') this.app.audio.grind(true, 0);
    this.app.ui.dragHint?.(false);
    return true;
  }
  dragTo(v) {
    const d = this.dragging;
    if (!d) return;
    const G = this.L.mechs[d.i];
    const lo = Math.min(...G.dom), hi = Math.max(...G.dom);
    if (!G.src.cyc) v = v < lo ? lo - softClamp(lo - v) : v > hi ? hi + softClamp(v - hi) : v;
    const now = performance.now();
    const speed = Math.abs(v - d.v) / Math.max(0.001, (now - d.lastT) / 1000);
    d.v = v; d.lastT = now;
    const vm = this.world.vm.slice(); vm[d.i] = v;
    this.world.setView(vm, this.world.vl);
    const tk = Math.round(v * 6);
    if (tk !== d.lastTick) { d.lastTick = tk; if (G.kind !== 'slider') this.app.audio.tick(tk, this.pan(this.handlePos(d.i))); }
    if (G.kind === 'slider') this.app.audio.grind(true, speed);
  }
  async endDrag() {
    const d = this.dragging;
    if (!d) return;
    const G = this.L.mechs[d.i];
    this.app.audio.grind(false);
    const lo = Math.min(...G.dom), hi = Math.max(...G.dom);
    let target = Math.round(d.v);
    if (!G.src.cyc) target = Math.max(lo, Math.min(hi, target));
    const logical = G.src.cyc ? ((target % 4) + 4) % 4 : target;
    const cur = this.st.m[d.i];
    let ns = null;
    if (logical !== cur) ns = F.mech(this.L, this.st, d.i, logical);
    this.busy++;
    this.dragging = null;
    const from = d.v;
    if (!ns) {
      // spring back to where it was (the nearest equivalent turn)
      const back = nearestEquiv(from, cur, G.src.cyc);
      if (logical !== cur) { this.app.audio.no(this.pan(this.handlePos(d.i))); this.app.ui.toast(this.blockReason(d.i, logical), 1800); }
      const gen = this.gen;
      await tween(0.35, (k) => { if (gen === this.gen) { const vm = this.world.vm.slice(); vm[d.i] = from + (back - from) * k; this.world.setView(vm, this.world.vl); } }, E.back);
      if (gen !== this.gen) return false;
      const vm = this.world.vm.slice(); vm[d.i] = cur; this.world.setView(vm, this.world.vl);
      this.busy--;
      return false;
    }
    const gen = this.gen;
    await tween(Math.min(0.45, 0.18 + Math.abs(target - from) * 0.4), (k) => { if (gen === this.gen) { const vm = this.world.vm.slice(); vm[d.i] = from + (target - from) * k; this.world.setView(vm, this.world.vl); } }, E.back);
    if (gen !== this.gen) return false;
    const vm = this.world.vm.slice(); vm[d.i] = logical; this.world.setView(vm, this.world.vl);
    this.pushUndo();
    const before = this.st;
    this.st = ns;
    this.turns++;
    this.app.audio.snap(this.pan(this.handlePos(d.i)));
    if (!this.reduce) { this.view.cam.shake = 0.05; tween(0.25, (k) => (this.view.cam.shake = 0.05 * (1 - k))); }
    this.app.fx.sparkle(this.handlePos(d.i), 10, this.P.glow, 0.5, 0.5);
    this.app.water.pillars(this.world.pillars(F.graphOf(this.L, this.st), this.waterCell));
    this.app.ui.hud(this);
    this.busy--;
    if (G.kind === 'world') this.reframe();
    await this.afterChange(before, ns);
    return true;
  }
  // whole-level rotation changes the silhouette: glide the camera to the new frame
  reframe() {
    const b = this.world.bounds(this.def.water ?? -5, this.st.m[this.L.world.mi]);
    const fit = this.view.fit(b, 0.9), cam = this.view.cam;
    const t0 = cam.target.clone(), h0 = cam.half, gen = this.gen;
    this.camHome = { target: fit.center.clone(), half: fit.half };
    FXU.uMistTop.value = b.v0 - 1.6; FXU.uMistBot.value = b.v0 - 8.5;
    tween(this.reduce ? 0.01 : 0.9, (k) => { if (gen !== this.gen) return; cam.target.copy(t0).lerp(fit.center, k); cam.half = h0 + (fit.half - h0) * k; }, E.io);
  }
  blockReason(i, v) {
    const m = this.st.m.slice(); m[i] = v;
    const Gr = F.graph(this.L, m, this.st.lift);
    if (Gr.conflict) return 'The stones would collide.';
    return 'Someone would be left standing on nothing.';
  }
  handlePos(i) { const h = this.world.handles[i]; return h ? h.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(); }
  pan(p) { const s = this.view.toScreen(p); return (s.x / this.view.w) * 2 - 1; }
  // lifts and plates that changed between two states: sounds, reveals, splashes
  async afterChange(a, b) {
    const L = this.L, gen = this.gen;
    const pa = F.pressed(L, a), pb = F.pressed(L, b);
    pa.forEach((on, i) => { if (on !== pb[i]) this.app.audio.plate(pb[i], this.pan(this.world.plates[i].getWorldPosition(new THREE.Vector3()))); });
    const moved = b.lift.map((v, j) => v !== a.lift[j]);
    if (!moved.some(Boolean)) return;
    this.busy++; this.lifting++;
    const reveal = moved.some((m, j) => m && b.lift[j] === 1 && L.plates.some((pl) => pl.latch && pl.lifts.includes(j)));
    const up = moved.some((m, j) => m && b.lift[j] === 1);
    if (up) this.app.audio.reveal(); else this.app.audio.plate(false);
    const dur = this.reduce ? 0.35 : reveal ? 2.2 : up ? 1.0 : 0.7;
    const cam = this.view.cam, h0 = cam.half;
    if (up) moved.forEach((m, j) => { if (!m) return; const G = L.lifts[j]; const c = this.liftCenter(G); this.app.fx.splash(new THREE.Vector3(c.x, this.waterY, c.z), reveal ? 70 : 30); this.app.water.ripple(c.x, c.z, 1.4); });
    const v0 = this.world.vl.slice();
    // a latched reveal draws the eye: the camera leans toward what is rising, then settles back
    const t0 = cam.target.clone();
    const focus = reveal ? this.liftTop(L.lifts[moved.indexOf(true)]) : null;
    const lean = focus ? focus.clone().sub(t0).multiplyScalar(0.35) : null;
    await tween(dur, (k) => {
      this.world.setView(this.world.vm, this.world.vl.map((v, j) => (moved[j] ? v0[j] + (b.lift[j] - v0[j]) * k : v)));
      if (reveal && !this.reduce) {
        const s = Math.sin(k * Math.PI);
        cam.half = h0 * (1 - s * 0.08);
        cam.target.copy(t0).addScaledVector(lean, s);
      }
    }, E.lin);
    if (gen !== this.gen) return;
    cam.target.copy(t0);
    cam.half = h0;
    this.world.setView(this.world.vm, this.world.vl.map((v, j) => (moved[j] ? b.lift[j] : v)));
    if (reveal && !this.reduce) this.app.fx.sparkle(this.liftTop(L.lifts[moved.indexOf(true)]), 40);
    this.app.water.pillars(this.world.pillars(F.graphOf(L, this.st), this.waterCell));
    this.busy--; this.lifting--;
  }
  liftCenter(G) { const cs = G.cells; const c = cs.reduce((s, x) => [s[0] + x[0], s[1] + x[1], s[2] + x[2]], [0, 0, 0]).map((v) => v / cs.length); const p = V3(c); this.world.root.localToWorld(p); return p; }
  liftTop(G) { let top = G.cells[0]; for (const c of G.cells) if (c[1] > top[1]) top = c; const p = V3(top).add(new THREE.Vector3(0, 0.8, 0)); this.world.root.localToWorld(p); return p; }
  // ---------- ticks ----------
  needTick() {
    if (this.manual) return this.queue.length > 0;
    if (this.walk && this.walk.path.length) return true;
    const Gr = F.graphOf(this.L, this.st);
    if (this.L.sentinels.length) return true;
    return this.st.c >= 0 && this.st.cm && this.st.p !== F.HEAD && !Gr.adj[this.st.c].includes(this.st.p) && !!F.bfsPath(Gr.adj, this.st.c, this.st.p);
  }
  doTick() {
    const L = this.L, st = this.st;
    let to = null;
    if (this.manual) {
      const a = this.queue.shift();
      if (a.t === 'step') to = a.to;
    } else if (this.walk && this.walk.path.length) {
      let next = this.walk.path[0];
      const Gr = F.graphOf(L, st);
      const sT = F.sentTiles(L, st);
      if (!F.nbrs(L, Gr, st, st.p).includes(next) || (next === st.c && !st.cm)) {
        const p = F.path(L, st, this.walk.target);
        if (p && p.length > 1) { this.walk.path = p.slice(1); this.walk.done = 0; next = this.walk.path[0]; this.app.fx.path(this.walk.path.map((x) => this.restPos(x, { c: new THREE.Vector3(), n: new THREE.Vector3() }))); }
        else { this.stopWalk(); next = null; }
      }
      if (next != null && sT.includes(next)) {
        // a warden stands in the way: stop, and it complains
        const i = sT.indexOf(next);
        this.sents[i].cry(); this.app.audio.cry(this.pan(this.sents[i].g.position));
        this.stopWalk();
        next = null;
      }
      to = next;
    }
    let ns = F.tick(L, st, to);
    if (!ns) { this.stopWalk(); to = null; ns = F.tick(L, st, null); }
    if (to != null && this.walk) {
      this.walk.path.shift();
      this.walk.done = (this.walk.done || 0) + 1;
      this.app.fx.eatBead(this.walk.done - 1);
      if (!this.walk.path.length) this.stopWalk();
    }
    this.startAnim(st, ns);
    this.st = ns;
    if (!this.anim) {
      // nobody moved (a warden turning round, a wait): settle plates and lifts right away
      this.pendingChange = null;
      this.afterChange(st, ns);
    }
    return ns;
  }
  stopWalk() { this.walk = null; this.app.fx.path([]); }
  startAnim(a, b) {
    const L = this.L;
    const Gr = F.graphOf(L, a);
    const seg = (x, y, st) => (x === y ? null : F.seamPts(L, Gr, st, x, y));
    const anim = { t: 0, dur: TICK, parts: [] };
    const pSeg = seg(a.p, b.p, a);
    if (pSeg) {
      anim.parts.push({ actor: this.player, s: pSeg });
      const h = pSeg.b[1];
      this.app.audio.step(h, this.pan(V3(pSeg.b)), pSeg.nb[1] === 1 ? 'stone' : 'wall');
    }
    if (this.comp && a.c !== b.c) {
      // the companion may have swapped into the player's old tile
      const cs = F.seamPts(L, Gr, a, a.c, b.c);
      anim.parts.push({ actor: this.comp, s: cs });
    }
    const sa = F.sentTiles(L, a), sb = F.sentTiles(L, b);
    L.sentinels.forEach((S, i) => {
      if (sa[i] !== sb[i]) anim.parts.push({ actor: this.sents[i], s: F.seamPts(L, Gr, a, sa[i], sb[i]) });
      else if (a.s[2 * i + 1] !== b.s[2 * i + 1]) {
        // it turned round: if a walker blocked it, it cries
        const k = a.s[2 * i], d = a.s[2 * i + 1], n = S.rail.length;
        let k2 = k + d; if (S.loop) k2 = (k2 + n) % n;
        const want = k2 >= 0 && k2 < n ? S.rail[k2] : -1;
        if (want >= 0 && (want === b.p || want === b.c)) { this.sents[i].cry(); this.app.audio.cry(this.pan(this.sents[i].g.position)); }
        if (want >= 0) { const w = F.tileW(L, Gr, a, want); if (w) this.sents[i].face(V3(w.c).sub(this.sents[i].g.position).multiplyScalar(-1)); }
      }
    });
    for (const p of anim.parts) { p.actor.moving = true; p.actor.face(V3(p.s.b).sub(V3(p.s.a))); }
    this.anim = anim.parts.length ? anim : null;
    if (b.g && !a.g) this.collectGlimmer();
    this.pendingChange = [a, b];
  }
  finishAnim() {
    if (!this.anim) return;
    for (const p of this.anim.parts) p.actor.moving = false;
    this.anim = null;
    this.placeAll(false);
  }
  collectGlimmer() {
    const gl = this.world.glim;
    if (!gl) return;
    const p = gl.getWorldPosition(new THREE.Vector3());
    this.app.fx.sparkle(p, 45, '#ffffff', 1, 1.6);
    this.app.audio.glimmer(this.pan(p));
    tween(0.4, (k) => gl.scale.setScalar(1 - k)).then(() => (gl.visible = false));
    this.app.ui.hud(this);
    this.app.ui.toast('A glimmer of the old map.', 1600);
  }
  // ---------- per frame ----------
  update(dt, t) {
    if (!this.world) return;
    dt *= this.timeScale;
    // walker animation for the current tick
    if (this.anim) {
      const A = this.anim;
      A.t += dt;
      const k = Math.min(1, A.t / A.dur);
      for (const p of A.parts) moveAlong(p.actor, p.s, k);
      if (k >= 1) {
        this.finishAnim();
        const pc = this.pendingChange; this.pendingChange = null;
        if (pc) this.afterChange(pc[0], pc[1]);
        if (F.won(this.L, this.st) && !this.won) this.win();
      }
    } else this.placeAll(false);
    // one tick per TICK seconds; a tick's walk animation lasts exactly one TICK, so motion is continuous
    if (!this.busy && !this.dragging && !this.won) {
      this.tickT += dt;
      if (!this.anim && this.needTick() && (this.manual || this.tickT >= TICK)) { this.tickT = 0; this.doTick(); }
      else if (!this.anim) this.tickT = Math.min(this.tickT, TICK);
    }
    this.player.update(dt, t);
    this.comp?.update(dt, t);
    this.sents.forEach((s) => s.update(dt, t));
    // Lintel looks at the player when idle
    if (this.comp && !this.comp.moving) this.comp.face(this.player.g.position.clone().sub(this.comp.g.position));
    this.world.animate(dt, t, this.st);
  }
  // ---------- win ----------
  async win() {
    const gen = this.gen;
    this.won = true;
    this.busy++;
    this.walk = null;
    this.app.fx.path([]);
    const gate = this.world.goal;
    const glyph = gate.userData.glyph;
    const p0 = glyph.getWorldPosition(new THREE.Vector3());
    this.app.audio.win();
    const target = this.player.g.position.clone().addScaledVector(this.player.up, 0.55);
    await tween(this.reduce ? 0.3 : 0.9, (k) => { const p = p0.clone().lerp(target, E.io(k)); gate.worldToLocal(p); glyph.position.copy(p); glyph.scale.setScalar(1 + k * 0.6); });
    if (gen !== this.gen) return;
    this.app.fx.sparkle(target, 80, this.P.glow, 2, 2.2);
    glyph.visible = false;
    if (!this.reduce) await tween(0.8, (k) => { this.view.cam.half = this.camHome.half * (1 - 0.05 * E.io(k)); });
    if (gen !== this.gen) return;
    this.busy--;
    const stars = [true, !!this.st.g, this.turns <= (this.def.par ?? 99) && !this.hintUsed];
    this.app.onWin(this, stars);
  }
  // ---------- hints (solver in a worker) ----------
  hint() {
    if (!this.canAct()) return;
    this.hintUsed = true;
    this.app.ui.hud(this);
    if (!this.worker) {
      try { this.worker = new Worker(new URL('./hint-worker.js', import.meta.url), { type: 'module' }); } catch (e) { this.worker = null; }
      if (this.worker) this.worker.onmessage = (e) => this.onHint(e.data);
    }
    const id = ++this.hintReq;
    this.hintPending = true;
    this.app.ui.toast('Reading the map…', 8000);
    const msg = { id, def: this.def, st: this.st };
    if (this.worker) this.worker.postMessage(msg);
    else setTimeout(() => { const L = F.compile(this.def); const r = F.solve(L, this.st, F.won, 300000); this.onHint({ id, r: r && r.actions ? { actions: r.actions.slice(0, 60) } : null }); }, 30);
  }
  onHint({ id, r }) {
    if (id !== this.hintReq || !this.world || this.won) return;
    this.hintPending = false;
    const ui = this.app.ui, fx = this.app.fx;
    if (!r || !r.actions || !r.actions.length) { ui.toast('Even the map is unsure. Try undoing a few steps.', 2600); return; }
    const acts = r.actions;
    const a = acts[0];
    if (a.t === 'step') {
      let last = a.to;
      for (const b of acts) { if (b.t !== 'step') break; last = b.to; }
      const p = this.restPos(last, { c: new THREE.Vector3(), n: new THREE.Vector3() });
      fx.showHint(p.c, p.n);
      ui.toast('Walk to the glowing ring.', 2600);
    } else if (a.t === 'wait') {
      ui.toast(this.L.sentinels.length ? 'Wait. Let the warden walk on.' : 'Wait a moment for Lintel.', 2400);
    } else if (a.t === 'mech' && this.L.mechs[a.i]) {
      const G = this.L.mechs[a.i];
      const hp = this.handlePos(a.i);
      fx.showHint(hp, new THREE.Vector3(1, 1, 1).normalize());
      const cur = this.st.m[a.i];
      let d = a.v - cur;
      if (G.src.cyc) { d = ((d % 4) + 4) % 4; if (d === 3) d = -1; }
      const what = G.kind === 'slider' ? `Slide the glowing handle ${Math.abs(d) > 1 ? Math.abs(d) + ' places' : 'one place'}.` : G.kind === 'world' ? `Turn the great wheel ${Math.abs(d) === 2 ? 'a half turn' : 'a quarter turn'}.` : `Turn the glowing crank ${Math.abs(d) === 2 ? 'a half turn' : 'a quarter turn'}.`;
      ui.toast(what, 3000);
      ui.dragHint?.(true, hp, G, d);
    } else if (a.t === 'toggle' && this.comp) {
      fx.showHint(this.comp.g.position.clone().add(new THREE.Vector3(0, 1.02, 0)), new THREE.Vector3(0, 1, 0));
      ui.toast(this.st.cm ? 'Tap Lintel so it waits here.' : 'Tap Lintel so it follows you.', 2600);
    }
  }
}

// move an actor along a seam path: centre -> exit port, (invisible jump), entry port -> centre
function moveAlong(actor, s, k) {
  const a = V3(s.a), pa = V3(s.pa), pb = V3(s.pb), b = V3(s.b);
  const na = V3(s.na), nb = V3(s.nb);
  const pos = new THREE.Vector3();
  if (k < 0.5) pos.copy(a).lerp(pa, k * 2);
  else pos.copy(pb).lerp(b, (k - 0.5) * 2);
  let n = na;
  if (!na.equals(nb)) { const f = Math.min(1, Math.max(0, (k - 0.3) / 0.4)); n = na.clone().lerp(nb, f).normalize(); }
  actor.place(pos, n);
  if (k >= 1) actor.moving = false;
}
function nearestEquiv(from, v, cyc) {
  if (!cyc) return v;
  const k = Math.round((from - v) / 4);
  return v + 4 * k;
}
const softClamp = (x) => 0.35 * (1 - Math.exp(-x / 0.35));
export { RIGHT, UP };
