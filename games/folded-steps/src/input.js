// Folded Steps: pointer, touch and keyboard. Tap a tile to walk (A*), tap Lintel to make it wait or follow,
// drag a crank around its axis or a slider along its track; release snaps. Keys: Z undo, R restart, H hint.
import * as THREE from 'three';
import * as F from './logic.js';
import { VIEW, RIGHT, UP } from './render.js';

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export class Input {
  constructor(app) {
    this.app = app;
    this.el = app.view.canvas;
    this.down = null;
    this.drag = null;
    this.enabled = true;
    const el = this.el;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => this.onKey(e));
  }
  get game() { return this.app.game; }
  rayAt(x, y) { ndc.set((x / this.app.view.w) * 2 - 1, -(y / this.app.view.h) * 2 + 1); ray.setFromCamera(ndc, this.app.view.camera); return ray; }
  handleAt(x, y) {
    const w = this.game.world;
    if (!w) return -1;
    const hits = this.rayAt(x, y).intersectObjects(w.handles.map((h) => h.userData.hit), false);
    if (hits.length) return hits[0].object.userData.mech;
    // generous touch targets: any handle within ~34px of the finger
    let best = -1, bd = this.touch ? 40 : 26;
    w.handles.forEach((h, i) => { const s = this.app.view.toScreen(h.getWorldPosition(new THREE.Vector3())); const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  onDown(e) {
    this.app.audio.init();
    if (!this.enabled) return;
    if (this.app.editor && this.app.editor.active) { this.app.editor.pointer('down', e); return; }
    this.touch = e.pointerType === 'touch';
    const g = this.game;
    if (!g.world || g.won) return;
    const mi = this.handleAt(e.clientX, e.clientY);
    if (mi >= 0 && g.beginDrag(mi)) {
      try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
      this.drag = this.dragGeom(mi, e.clientX, e.clientY);
      this.el.style.cursor = 'grabbing';
      return;
    }
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
  // how pointer motion maps to a mechanism value
  dragGeom(i, x, y) {
    const g = this.game, w = g.world, G = g.L.mechs[i], view = this.app.view;
    const hp = w.handles[i].getWorldPosition(new THREE.Vector3());
    const rootM = w.root.matrixWorld;
    const v0 = w.vm[i];
    if (G.kind === 'slider') {
      const d = new THREE.Vector3(...G.src.dir).transformDirection(rootM);
      const s0 = view.toScreen(hp), s1 = view.toScreen(hp.clone().add(d));
      const sd = { x: s1.x - s0.x, y: s1.y - s0.y };
      return { i, kind: 'slide', x, y, v0, sd, l2: Math.max(40, sd.x * sd.x + sd.y * sd.y) };
    }
    const ax = G.kind === 'world' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(G.src.axis === 'x' ? 1 : 0, G.src.axis === 'y' ? 1 : 0, G.src.axis === 'z' ? 1 : 0).transformDirection(rootM);
    const pv = new THREE.Vector3(...G.src.pivot);
    if (G.kind !== 'world') pv.applyMatrix4(rootM);
    const c = pv.clone().addScaledVector(ax, hp.clone().sub(pv).dot(ax));
    const cs = view.toScreen(c);
    const sign = ax.dot(VIEW) >= 0 ? 1 : -1;
    // grabbing right on the axis gives no angle yet: start measuring once the finger leaves the centre
    const r0 = Math.hypot(x - cs.x, y - cs.y);
    return { i, kind: 'turn', cs, sign, v0, acc: 0, last: r0 >= 14 ? Math.atan2(-(y - cs.y), x - cs.x) : null, lin: 0, x, y };
  }
  onMove(e) {
    if (this.app.editor && this.app.editor.active) { this.app.editor.pointer('move', e); return; }
    const d = this.drag;
    if (d) {
      if (d.kind === 'slide') {
        const dv = ((e.clientX - d.x) * d.sd.x + (e.clientY - d.y) * d.sd.y) / d.l2;
        this.game.dragTo(d.v0 + dv);
      } else {
        const r = Math.hypot(e.clientX - d.cs.x, e.clientY - d.cs.y);
        const a = Math.atan2(-(e.clientY - d.cs.y), e.clientX - d.cs.x);
        if (r < 14 || d.last == null) { if (r >= 14) d.last = a; return; }
        let da = a - d.last;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        d.acc += da; d.last = a;
        this.game.dragTo(d.v0 + (d.sign * d.acc) / (Math.PI / 2));
      }
      return;
    }
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 12) this.down = null;
    if (!this.touch && this.game.world) this.el.style.cursor = this.handleAt(e.clientX, e.clientY) >= 0 ? 'grab' : 'pointer';
  }
  onUp(e) {
    if (this.app.editor && this.app.editor.active) { this.app.editor.pointer('up', e); return; }
    if (this.drag) { this.drag = null; this.el.style.cursor = ''; this.game.endDrag(); return; }
    const d = this.down;
    this.down = null;
    if (!d || performance.now() - d.t > 700) return;
    this.tap(e.clientX, e.clientY);
  }
  cancel() { if (this.drag) { this.drag = null; this.game.endDrag(); } this.down = null; }
  tap(x, y) {
    const g = this.game;
    if (!g.world || !g.canAct()) return;
    const r = this.rayAt(x, y);
    // Lintel: its flat head is a tile; its body is the "wait / follow" button
    if (g.comp) {
      const ch = r.intersectObject(g.comp.g, true);
      if (ch.length) {
        const top = ch[0].point.clone().sub(g.comp.g.position).dot(g.comp.up) > 0.9;
        if (top && g.st.p !== F.HEAD) { if (g.tapTile(F.HEAD)) return; }
        g.toggleCompanion();
        return;
      }
    }
    const hits = r.intersectObjects(g.world.solids.concat(g.world.items), true);
    for (const h of hits.slice(0, 1)) {
      const t = g.world.tileFromHit(h);
      if (t != null && g.tapTile(t)) return;
    }
    // forgiving fallback: the nearest walkable tile on screen
    const t = this.nearestTile(x, y, hits.length ? 36 : 48);
    if (t != null) g.tapTile(t);
  }
  nearestTile(x, y, max) {
    const g = this.game, Gr = F.graphOf(g.L, g.st);
    let best = null, bd = max;
    const tmp = { c: new THREE.Vector3(), n: new THREE.Vector3() };
    const cands = Gr.W.map((w, i) => (w.active ? i : -1)).filter((i) => i >= 0);
    if (F.head(Gr, g.L, g.st.c)) cands.push(F.HEAD);
    for (const t of cands) {
      g.restPos(t, tmp);
      const s = this.app.view.toScreen(tmp.c);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    this.app.audio.init();
    if (this.app.editor && this.app.editor.active) { this.app.editor.key(e); return; }
    const k = e.key.toLowerCase(), g = this.game;
    if (k === 'escape') { this.app.ui.escape(); return; }
    if (!this.enabled || !g.world) return;
    if (k === 'z' && !e.metaKey && !e.ctrlKey) g.undo();
    else if ((k === 'z' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); g.undo(); }
    else if (k === 'r') g.restart();
    else if (k === 'h') g.hint();
    else if (k === 't' || k === 'c') g.toggleCompanion();
    else if (k === 'm') this.app.ui.toggleSound();
    else if (k.startsWith('arrow')) { e.preventDefault(); this.stepKey(k); }
    else if (k === 'tab' && g.L.mechs.length) { e.preventDefault(); this.focusMech = ((this.focusMech ?? -1) + (e.shiftKey ? -1 : 1) + g.L.mechs.length) % g.L.mechs.length; this.showFocus(); }
    else if ((k === 'q' || k === 'e') && g.L.mechs.length) this.turnKey(k === 'e' ? 1 : -1);
  }
  // keyboard play for mechanisms: Tab picks a handle, Q / E turn or slide it one step
  showFocus() {
    const g = this.game, i = this.focusMech ?? 0;
    const p = g.handlePos(i);
    this.app.fx.showHint(p, new THREE.Vector3(1, 1, 1).normalize());
    const G = g.L.mechs[i];
    this.app.ui.toast(`${G.kind === 'slider' ? 'Slider' : G.kind === 'world' ? 'Great wheel' : 'Crank'} ${i + 1} of ${g.L.mechs.length}: Q / E to move it`, 1800);
  }
  async turnKey(dir) {
    const g = this.game;
    if (this.focusMech == null) { this.focusMech = 0; this.showFocus(); }
    const i = this.focusMech;
    if (!g.beginDrag(i)) return;
    const v0 = g.world.vm[i];
    for (let k = 1; k <= 5; k++) { g.dragTo(v0 + (dir * k) / 5); await new Promise((r) => setTimeout(r, 16)); }
    await g.endDrag();
    this.app.fx.clearHint();
  }
  // arrow keys follow the isometric grid (up = up-right, right = down-right, ...): step to the neighbour
  // whose on-screen direction best matches
  stepKey(k) {
    const g = this.game;
    if (!g.canAct()) return;
    const want = { arrowup: [0.866, -0.5], arrowright: [0.866, 0.5], arrowdown: [-0.866, 0.5], arrowleft: [-0.866, -0.5] }[k];
    const Gr = F.graphOf(g.L, g.st);
    const here = g.restPos(g.st.p, { c: new THREE.Vector3(), n: new THREE.Vector3() });
    const s0 = this.app.view.toScreen(here.c);
    let best = null, bd = 0.3;
    for (const t of F.nbrs(g.L, Gr, g.st, g.st.p)) {
      const p = g.restPos(t, { c: new THREE.Vector3(), n: new THREE.Vector3() });
      const s = this.app.view.toScreen(p.c);
      const dx = s.x - s0.x, dy = s.y - s0.y, l = Math.hypot(dx, dy) || 1;
      const c = (dx * want[0] + dy * want[1]) / l;
      if (c > bd) { bd = c; best = t; }
    }
    if (best != null) g.tapTile(best);
  }
}
export { RIGHT, UP };
