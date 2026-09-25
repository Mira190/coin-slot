// Folded Steps: the Workshop, an in-game level editor. Build with blocks, stairs and gravity walls; add a
// rotor, slider or lift; place the start, gate, glimmer, Lintel, plates and warden rails; prove the level
// with the solver (in a worker), play it, and keep it in localStorage.
import * as THREE from 'three';
import * as F from './logic.js';
import { World } from './world.js';
import { Cartographer, Lintel, Warden } from './actors.js';
import { PALETTES } from './palettes.js';
import { clearMats } from './deco.js';
import { FXU } from './render.js';
import * as S from './save.js';

const DRAFT = 'folded-steps.draft';
const TOOLS = [
  ['block', 'Block', '1'], ['stair', 'Stair', '2'], ['erase', 'Erase', '3'],
  ['wall', 'Wall', '4'], ['start', 'Start', '5'], ['goal', 'Gate', '6'],
  ['glim', 'Glimmer', '7'], ['comp', 'Lintel', '8'], ['plate', 'Plate', '9'],
  ['warden', 'Warden', 'w'], ['pivot', 'Pivot', 'p'], ['deco', 'Tree/Lamp', 'd'],
];
const SLIDE_DIRS = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1], '+y': [0, 1, 0], '-y': [0, -1, 0] };
const key3 = (c) => c.join(',');
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

function starter() {
  const blocks = [];
  for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) blocks.push([x, 0, z]);
  for (let y = -4; y < 0; y++) blocks.push([0, y, 0, 'b'], [2, y, 2, 'b'], [2, y, 0, 'b'], [0, y, 2, 'b']);
  return { id: 'custom-' + Date.now().toString(36), title: 'Untitled fold', zh: '', chapter: 0, pal: 'dawn', water: -4, groups: [{ id: 'a', blocks, stairs: [], walls: [], deco: [] }], player: 'a:0,0,0', goal: 'a:2,0,2', plates: [], sentinels: [] };
}

export class Editor {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.tool = 'block';
    this.layer = 0;
    this.gridY = 0;
    this.autoCols = true;
    this.hist = [];
    this.railI = -1;
    this.zoom = 1;
    this.pan = new THREE.Vector2();
    this.worker = null;
    this.proof = null;
    this.el = document.getElementById('ed');
    this.app.view.canvas.addEventListener('wheel', (e) => { if (!this.active) return; e.preventDefault(); this.zoomBy(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
  }
  // ---------- open / close ----------
  open() {
    this.active = true;
    this.app.game.unload();
    this.app.game.def = null;
    try { this.def = JSON.parse(localStorage.getItem(DRAFT)) || starter(); } catch (e) { this.def = starter(); }
    this.normalize();
    this.ui();
    this.rebuild(true);
    this.app.input.enabled = true;
  }
  close(silent) {
    if (!this.active) return;
    this.active = false;
    this.teardown();
    this.el.innerHTML = '';
    if (!silent) this.app.ui.show('#title', true);
  }
  teardown() {
    const sc = this.app.view.scene;
    if (this.world) { this.world.dispose(); this.world = null; }
    for (const a of this.actors || []) a.dispose(sc);
    this.actors = [];
    if (this.ghost) { sc.remove(this.ghost); this.ghost = null; }
    if (this.grid) { sc.remove(this.grid); this.grid = null; }
    if (this.dots) { sc.remove(this.dots); this.dots = null; }
    clearMats();
  }
  normalize() {
    const d = this.def;
    d.groups = d.groups || [{ id: 'a', blocks: [] }];
    for (const g of d.groups) { g.blocks = g.blocks || []; g.stairs = g.stairs || []; g.walls = g.walls || []; g.deco = g.deco || []; }
    d.plates = d.plates || []; d.sentinels = d.sentinels || [];
    if (this.layer >= d.groups.length) this.layer = 0;
  }
  save() { try { localStorage.setItem(DRAFT, JSON.stringify(this.def)); } catch (e) { /* ignore */ } }
  push() { this.hist.push(JSON.stringify(this.def)); if (this.hist.length > 120) this.hist.shift(); this.proof = null; }
  undo() { const s = this.hist.pop(); if (!s) return; this.def = JSON.parse(s); this.normalize(); this.rebuild(); this.ui(); }
  // ---------- building the preview ----------
  // a def that always compiles: stale references are dropped, missing ones get placeholders
  playable(strict) {
    const d = JSON.parse(JSON.stringify(this.def));
    const L0 = this.keys(d);
    const ok = (r) => r && L0.has(r);
    const any = [...L0][0];
    if (strict) {
      if (!ok(d.player)) throw new Error('Place a start tile.');
      if (!ok(d.goal)) throw new Error('Place the gate.');
    }
    d.player = ok(d.player) ? d.player : any;
    d.goal = ok(d.goal) ? d.goal : any;
    if (!ok(d.glimmer)) delete d.glimmer;
    if (!ok(d.companion)) delete d.companion;
    const lifts = d.groups.filter((g) => g.kind === 'lift').map((g) => g.id);
    d.plates = d.plates.filter((p) => ok(p.tile)).map((p) => ({ ...p, lifts }));
    if (!lifts.length) d.plates = strict ? [] : d.plates.map((p) => ({ ...p, lifts: [] }));
    d.sentinels = d.sentinels.map((s) => ({ ...s, rail: s.rail.filter(ok) })).filter((s) => s.rail.length >= 2);
    for (const g of d.groups) {
      if (g.kind === 'rotor') { g.pivot = g.pivot || this.centre(g); g.handle = this.rotorHandle(g); }
      if (g.kind === 'slider') { g.dir = g.dir || [1, 0, 0]; g.n = g.n || 3; g.handle = this.sliderHandle(g); }
      if (g.kind === 'lift') { g.poses = [{ off: [0, -(g.depth || 8), 0] }, {}]; g.style = g.style || 'rise'; }
    }
    if (d.worldOn) { const c = this.centreAll(d); d.world = { pivot: [c[0], 0, c[2]], handle: [c[0], c[1] + 1.6, c[2]], start: 0 }; } else delete d.world;
    return d;
  }
  keys(d) {
    const out = new Set();
    for (const g of d.groups) {
      const own = new Set([...g.blocks, ...g.stairs].map((b) => key3(b.slice(0, 3))));
      for (const b of g.blocks) {
        if ((b[3] || '').includes('n')) continue;
        for (const [F0, n] of Object.entries(F.FACE)) {
          if (own.has(key3([b[0] + n[0], b[1] + n[1], b[2] + n[2]]))) continue;
          out.add(g.id + ':' + key3(b.slice(0, 3)) + (F0 === '+y' ? '' : ':' + F0));
        }
      }
      for (const s of g.stairs) out.add(g.id + ':' + key3(s.slice(0, 3)));
    }
    return out;
  }
  centre(g) {
    const cs = [...g.blocks, ...g.stairs];
    if (!cs.length) return [0, 0, 0];
    const c = cs.reduce((s, b) => [s[0] + b[0], s[1] + b[1], s[2] + b[2]], [0, 0, 0]).map((v) => Math.round(v / cs.length));
    return c;
  }
  centreAll(d) {
    const cs = d.groups.flatMap((g) => [...g.blocks, ...g.stairs]);
    if (!cs.length) return [0, 0, 0];
    const lo = [0, 1, 2].map((i) => Math.min(...cs.map((b) => b[i]))), hi = [0, 1, 2].map((i) => Math.max(...cs.map((b) => b[i])));
    return [Math.round((lo[0] + hi[0]) / 2), hi[1], Math.round((lo[2] + hi[2]) / 2)];
  }
  rotorHandle(g) {
    const p = g.pivot;
    return g.axis === 'x' ? [p[0] + 0.62, p[1], p[2]] : g.axis === 'z' ? [p[0], p[1], p[2] + 0.62] : [p[0], p[1] - 1, p[2]];
  }
  sliderHandle(g) {
    const b = g.blocks[0] || g.stairs[0] || [0, 0, 0];
    const d = g.dir || [1, 0, 0];
    return d[0] ? [b[0], b[1] - 0.2, b[2] + 0.62] : [b[0] + 0.62, b[1] - 0.2, b[2]];
  }
  rebuild(fit) {
    const app = this.app, sc = app.view.scene;
    this.teardown();
    const d = this.playable(false);
    const P = PALETTES[d.pal] || PALETTES.dawn;
    app.view.setPalette(P);
    app.fx.setPalette(P);
    app.fx.path([]);
    let L = null;
    try { L = d.groups.some((g) => g.blocks.length || g.stairs.length) ? F.compile(d) : null; } catch (e) { this.msg(e.message); }
    this.L = L;
    // the editing grid
    this.grid = new THREE.GridHelper(40, 40, 0x8a7fa0, 0xb9b0c8);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.35;
    this.grid.position.set(0.5, this.gridY - 0.5, 0.5);
    sc.add(this.grid);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: P.glow, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03)), new THREE.LineBasicMaterial({ color: '#ffffff' })));
    this.ghost.visible = false;
    sc.add(this.ghost);
    this.actors = [];
    if (L) {
      this.world = new World(sc, P).build(L);
      // mechanisms shown at rest (value 0), lifts raised, so what you see is what you edit
      this.world.setView(L.mechs.map(() => 0), L.lifts.map(() => 1));
      const put = (A, t) => { const a = new A(sc, P); const w = this.world.tileWorld(t); a.place(w.c, w.n); a.face(new THREE.Vector3(1, 0, 1)); a.orient(0, true); this.actors.push(a); return a; };
      if (this.def.player && L.key.has(this.def.player)) put(Cartographer, L.player);
      if (L.comp >= 0) put(Lintel, L.comp);
      L.sentinels.forEach((S0) => put(Warden, S0.rail[0]));
      // rail waypoints
      const pts = [];
      for (const s of this.def.sentinels) for (const r of s.rail) if (L.key.has(r)) { const w = this.world.tileWorld(L.key.get(r)); pts.push(w.c.x, w.c.y + 0.05, w.c.z); }
      if (pts.length) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        this.dots = new THREE.Points(g, new THREE.PointsMaterial({ color: '#4b4478', size: 9, sizeAttenuation: false }));
        sc.add(this.dots);
      }
      const b = this.world.bounds(-99);
      const wy = Math.floor(b.ylo - 2.2) + 0.42;
      app.water.set(P, wy, b.cx, b.cz, b.rad);
      app.water.pillars(this.world.pillars(F.graph(L, L.mechs.map(() => 0), L.lifts.map(() => 1)), Math.round(wy - 0.42)));
      FXU.uMistTop.value = b.v0 - 3; FXU.uMistBot.value = b.v0 - 12;
      if (fit || !this.home) { const f = app.view.fit(b, 3); this.home = f; this.zoom = 1; this.pan.set(0, 0); }
    } else if (!this.home) this.home = { center: new THREE.Vector3(), half: 8 };
    this.applyCam();
    this.save();
    this.status();
  }
  applyCam() {
    const cam = this.app.view.cam, h = this.home;
    cam.target.copy(h.center).addScaledVector(new THREE.Vector3(1, 0, -1).normalize(), this.pan.x).addScaledVector(new THREE.Vector3(-1, 2, -1).normalize(), this.pan.y);
    cam.half = h.half * this.zoom;
  }
  zoomBy(k) { this.zoom = Math.min(3, Math.max(0.3, this.zoom * k)); this.applyCam(); }
  update(dt, t) {
    if (!this.active) return;
    if (this.world) this.world.animate(dt, t, null);
    for (const a of this.actors || []) a.update?.(dt, t);
  }
  // ---------- picking ----------
  pick(x, y) {
    const v = this.app.view;
    ndc.set((x / v.w) * 2 - 1, -(y / v.h) * 2 + 1);
    ray.setFromCamera(ndc, v.camera);
    if (this.world) {
      const hits = ray.intersectObjects(this.world.solids, false);
      if (hits.length) {
        const h = hits[0], gi = h.object.userData.g, G = this.def.groups[gi];
        const lp = h.object.parent.worldToLocal(h.point.clone());
        let n = h.face.normal.clone().round();
        let cell;
        if (h.object.userData.tile != null) { const t = this.L.tiles[h.object.userData.tile]; cell = t.cell.slice(); n = new THREE.Vector3(0, 1, 0); return { gi, cell, n: [0, 1, 0], stair: true, G }; }
        cell = lp.clone().addScaledVector(n, -0.5).round();
        return { gi, cell: [cell.x, cell.y, cell.z], n: [n.x, n.y, n.z], G };
      }
    }
    // the grid plane
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.gridY - 0.5)), p)) return { ground: true, cell: [Math.round(p.x), this.gridY - 1, Math.round(p.z)], n: [0, 1, 0] };
    return null;
  }
  owner(cell) {
    const k = key3(cell);
    for (let i = 0; i < this.def.groups.length; i++) {
      const g = this.def.groups[i];
      if (g.blocks.some((b) => key3(b.slice(0, 3)) === k)) return { gi: i, kind: 'block' };
      if (g.stairs.some((b) => key3(b.slice(0, 3)) === k)) return { gi: i, kind: 'stair' };
    }
    return null;
  }
  refOf(h) {
    const g = this.def.groups[h.gi];
    const F0 = F.faceName(h.n);
    return g.id + ':' + key3(h.cell) + (F0 === '+y' || h.stair ? '' : ':' + F0);
  }
  pointer(type, e) {
    if (type === 'down') {
      this.app.audio.init();
      this.down = { x: e.clientX, y: e.clientY, pan: this.pan.clone(), btn: e.button, moved: false };
      try { this.app.view.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      return;
    }
    if (type === 'move') {
      const d = this.down;
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.hypot(dx, dy) > 7 || d.btn !== 0) d.moved = true;
        if (d.moved) {
          const s = (this.app.view.cam.half * 2) / this.app.view.h;
          this.pan.set(d.pan.x - dx * s, d.pan.y + dy * s);
          this.applyCam();
          this.ghost.visible = false;
          return;
        }
      }
      this.hover(e.clientX, e.clientY);
      return;
    }
    if (type === 'up') {
      const d = this.down; this.down = null;
      if (d && !d.moved && d.btn === 0) this.apply(e.clientX, e.clientY);
    }
  }
  hover(x, y) {
    const h = this.pick(x, y);
    const g = this.ghost;
    if (!h || !g) { if (g) g.visible = false; return; }
    const addTools = this.tool === 'block' || (this.tool === 'stair' && !h.stair);
    const c = addTools ? (this.tool === 'stair' ? [h.cell[0], h.cell[1] + 1, h.cell[2]] : [h.cell[0] + h.n[0], h.cell[1] + h.n[1], h.cell[2] + h.n[2]]) : h.cell;
    g.visible = !h.ground || addTools;
    g.position.set(c[0], c[1], c[2]);
    if (this.world && !h.ground) { const node = this.world.nodes[h.gi]; if (node && !addTools) g.position.applyMatrix4(node.matrixWorld); }
    g.material.color.set(this.tool === 'erase' ? '#e8837a' : (PALETTES[this.def.pal] || PALETTES.dawn).glow);
    g.scale.setScalar(addTools || this.tool === 'erase' ? 1 : 0.4);
    if (!addTools && this.tool !== 'erase') g.position.add(new THREE.Vector3(...h.n).multiplyScalar(0.5));
  }
  // ---------- tools ----------
  apply(x, y) {
    const h = this.pick(x, y);
    if (!h) return;
    const d = this.def, grp = d.groups[this.layer];
    const t = this.tool;
    const say = (m) => this.msg(m);
    if (t === 'block') {
      const c = h.ground ? [h.cell[0], this.gridY, h.cell[2]] : [h.cell[0] + h.n[0], h.cell[1] + h.n[1], h.cell[2] + h.n[2]];
      if (this.owner(c)) return;
      this.push();
      grp.blocks.push(c);
      if (this.autoCols && grp.kind !== 'rotor' && grp.kind !== 'slider') for (let y = c[1] - 1; y >= -4; y--) { if (this.owner([c[0], y, c[2]])) break; grp.blocks.push([c[0], y, c[2], 'b']); }
      this.app.audio.step(c[1], 0);
    } else if (t === 'stair') {
      if (h.stair) {
        // clicking a stair turns it
        this.push();
        const o = this.owner(h.cell), g = d.groups[o.gi], s = g.stairs.find((b) => key3(b.slice(0, 3)) === key3(h.cell));
        const order = ['-x', '-z', '+x', '+z'];
        s[3] = order[(order.indexOf(s[3]) + 1) % 4];
      } else {
        const c = [h.cell[0], h.cell[1] + 1, h.cell[2]];
        if (h.ground || h.n[1] !== 1 || this.owner(c)) { say('Place stairs on top of a block.'); return; }
        this.push();
        grp.stairs.push([...c, '-x']);
      }
      this.app.audio.tick(3, 0);
    } else if (t === 'erase') {
      if (h.ground) return;
      const o = this.owner(h.cell);
      if (!o) return;
      this.push();
      const g = d.groups[o.gi], k = key3(h.cell);
      g.blocks = g.blocks.filter((b) => key3(b.slice(0, 3)) !== k);
      g.stairs = g.stairs.filter((b) => key3(b.slice(0, 3)) !== k);
      g.walls = g.walls.filter((w) => key3(w.slice(0, 3)) !== k);
      g.deco = g.deco.filter((w) => key3(w.slice(1, 4)) !== k);
      this.app.audio.no(0);
    } else if (h.ground) {
      return;
    } else if (t === 'wall') {
      if (h.n[1] !== 0) { say('Walls are the sides of blocks.'); return; }
      this.push();
      const g = d.groups[h.gi], F0 = F.faceName(h.n), k = key3(h.cell) + F0;
      const i = g.walls.findIndex((w) => key3(w.slice(0, 3)) + w[3] === k);
      if (i >= 0) g.walls.splice(i, 1); else g.walls.push([...h.cell, F0]);
    } else if (t === 'start' || t === 'goal' || t === 'glim' || t === 'comp') {
      this.push();
      const r = this.refOf(h);
      const f = { start: 'player', goal: 'goal', glim: 'glimmer', comp: 'companion' }[t];
      if ((t === 'glim' || t === 'comp') && d[f] === r) delete d[f]; else d[f] = r;
    } else if (t === 'plate') {
      this.push();
      const r = this.refOf(h);
      const i = d.plates.findIndex((p) => p.tile === r);
      if (i < 0) d.plates.push({ tile: r, lifts: [], latch: false });
      else if (!d.plates[i].latch) d.plates[i].latch = true;
      else d.plates.splice(i, 1);
      if (!d.groups.some((g) => g.kind === 'lift')) say('Plates raise lift groups: add one under Groups.');
    } else if (t === 'warden') {
      this.push();
      if (this.railI < 0 || !d.sentinels[this.railI]) { d.sentinels.push({ rail: [], loop: false }); this.railI = d.sentinels.length - 1; }
      d.sentinels[this.railI].rail.push(this.refOf(h));
      say(`Warden ${this.railI + 1}: ${d.sentinels[this.railI].rail.length} waypoint(s). Use "New warden" to start another.`);
    } else if (t === 'pivot') {
      const g = d.groups[this.layer];
      if (g.kind !== 'rotor') { say('Choose a rotor group first.'); return; }
      this.push();
      g.pivot = h.cell.slice();
    } else if (t === 'deco') {
      this.push();
      const g = d.groups[h.gi];
      const k = key3(h.cell);
      const i = g.deco.findIndex((x) => key3(x.slice(1, 4)) === k);
      const cycle = ['tree', 'lamp', 'flag', 'dome', 'turret'];
      if (i < 0) g.deco.push(['tree', ...h.cell]);
      else { const n = cycle.indexOf(g.deco[i][0]) + 1; if (n >= cycle.length) g.deco.splice(i, 1); else g.deco[i][0] = cycle[n]; }
    }
    this.rebuild();
    this.ui();
  }
  msg(m) { const el = this.el.querySelector('#edMsg'); if (el) el.textContent = m || ''; }
  status() {
    const el = this.el.querySelector('#edStat');
    if (!el) return;
    const d = this.def;
    const n = d.groups.reduce((s, g) => s + g.blocks.length + g.stairs.length, 0);
    el.textContent = `${n} cells · ${d.groups.length - 1} mechanism group(s) · ${d.sentinels.length} warden(s)` + (this.proof ? `\n${this.proof}` : '');
  }
  // ---------- UI ----------
  ui() {
    const d = this.def, g = d.groups[this.layer];
    const pals = Object.keys(PALETTES).map((p) => `<option ${p === d.pal ? 'selected' : ''}>${p}</option>`).join('');
    const groups = d.groups.map((x, i) => `<button data-layer="${i}" class="${i === this.layer ? 'on' : ''}">${i ? x.kind : 'static'}${i ? ' ' + i : ''}</button>`).join('');
    let gset = '';
    if (g.kind === 'rotor') gset = `<div class="ed-row"><label>axis</label>${['x', 'y', 'z'].map((a) => `<button data-axis="${a}" class="${(g.axis || 'y') === a ? 'on' : ''}">${a}</button>`).join('')}<label><input type="checkbox" id="edCyc" ${g.cyc !== false ? 'checked' : ''}> full turn</label></div><div class="ed-row"><label>start</label><select id="edStart">${[0, 1, 2, 3].map((v) => `<option ${v === (g.start || 0) ? 'selected' : ''}>${v}</option>`).join('')}</select><label>pivot ${g.pivot ? g.pivot.join(',') : 'auto'}</label></div>`;
    if (g.kind === 'slider') gset = `<div class="ed-row"><label>dir</label><select id="edDir">${Object.keys(SLIDE_DIRS).map((k) => `<option ${key3(SLIDE_DIRS[k]) === key3(g.dir || [1, 0, 0]) ? 'selected' : ''}>${k}</option>`).join('')}</select><label>stops</label><select id="edN">${[2, 3, 4, 5].map((v) => `<option ${v === (g.n || 3) ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`;
    if (g.kind === 'lift') gset = `<div class="ed-row"><label>rises from</label><select id="edDepth">${[3, 5, 8, 11].map((v) => `<option ${v === (g.depth || 8) ? 'selected' : ''}>${v}</option>`).join('')}</select><select id="edStyle">${['rise', 'unfold'].map((v) => `<option ${v === (g.style || 'rise') ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`;
    const saved = (this.app.save.custom || []).map((c, i) => `<div><span title="${c.title}">${c.title}${c.proof ? ' ✓' : ''}</span><button data-load="${i}">Load</button><button data-play="${i}">Play</button><button data-del="${i}">✕</button></div>`).join('') || '<div><span style="opacity:.6">Nothing saved yet</span></div>';
    this.el.innerHTML = `
      <div class="ed-bar">
        <h3>Workshop</h3>
        <div class="ed-row"><input type="text" id="edTitle" value="${escapeAttr(d.title)}" maxlength="40" aria-label="Level title"></div>
        <div class="ed-row"><label>palette</label><select id="edPal">${pals}</select></div>
        <h4>Tool</h4>
        <div class="ed-grid">${TOOLS.map(([k, n, s]) => `<button data-tool="${k}" class="${k === this.tool ? 'on' : ''}" title="${n} (${s})">${n}</button>`).join('')}</div>
        <div class="ed-row"><label><input type="checkbox" id="edCols" ${this.autoCols ? 'checked' : ''}> columns under new blocks</label></div>
        <div class="ed-row"><label>grid height</label><button id="edGDn">−</button><b>${this.gridY}</b><button id="edGUp">+</button></div>
        <h4>Groups</h4>
        <div class="ed-grid">${groups}</div>
        <div class="ed-row"><button id="edAddRot">+ rotor</button><button id="edAddSl">+ slider</button><button id="edAddLift">+ lift</button>${this.layer ? '<button id="edDelG">delete group</button>' : ''}</div>
        ${gset}
        <div class="ed-row"><label><input type="checkbox" id="edWorld" ${d.worldOn ? 'checked' : ''}> whole-level crank</label></div>
        <div class="ed-row"><button id="edNewW">New warden</button><button id="edLoopW">${(d.sentinels[this.railI] || {}).loop ? 'loop ✓' : 'loop'}</button><button id="edClrW">Clear wardens</button></div>
        <h4>Level</h4>
        <div class="ed-row"><button id="edProve">Prove it</button><button id="edPlay">Play</button><button id="edSave">Save</button><button id="edNew">New</button><button id="edUndo">Undo</button></div>
        <div class="ed-row"><button id="edExport">Export</button><button id="edImport">Import</button></div>
        <textarea id="edText" hidden style="width:100%;height:90px;margin-top:4px;font:11px ui-monospace,monospace;border-radius:10px;border:1px solid var(--line)"></textarea>
        <div class="ed-msg" id="edStat"></div>
        <div class="ed-msg" id="edMsg"></div>
        <h4>Saved</h4>
        <div class="ed-list">${saved}</div>
      </div>
      <div class="ed-top"><button class="btn" id="edZoomIn">＋</button><button class="btn" id="edZoomOut">－</button><button class="btn" id="edExit">Leave</button></div>
      <div class="ed-help">Click a face to place · drag to pan · wheel to zoom · Z undo. Stairs: click the block to stand them on, click again to turn. Plates cycle plate → latching → off. Tree/Lamp cycles decorations.</div>`;
    const $ = (s) => this.el.querySelector(s);
    const on = (s, ev, fn) => { const x = $(s); if (x) x.addEventListener(ev, (e) => { e.stopPropagation(); this.app.audio.ui(); fn(e); }); };
    this.el.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { this.tool = b.dataset.tool; this.ui(); }));
    this.el.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { this.layer = +b.dataset.layer; this.ui(); }));
    this.el.querySelectorAll('[data-axis]').forEach((b) => b.addEventListener('click', () => { this.push(); g.axis = b.dataset.axis; this.rebuild(); this.ui(); }));
    on('#edTitle', 'change', (e) => { this.def.title = e.target.value.trim() || 'Untitled fold'; this.save(); });
    on('#edPal', 'change', (e) => { this.push(); this.def.pal = e.target.value; this.rebuild(); });
    on('#edCols', 'change', (e) => { this.autoCols = e.target.checked; });
    on('#edGDn', 'click', () => { this.gridY--; this.rebuild(); this.ui(); });
    on('#edGUp', 'click', () => { this.gridY++; this.rebuild(); this.ui(); });
    const addG = (kind, extra) => { this.push(); const id = 'm' + (Math.max(0, ...d.groups.map((x) => +(x.id.slice(1)) || 0)) + 1); d.groups.push({ id, kind, blocks: [], stairs: [], walls: [], deco: [], ...extra }); this.layer = d.groups.length - 1; this.tool = 'block'; this.ui(); this.msg(kind === 'rotor' ? 'Add blocks to the rotor, then set its pivot.' : kind === 'slider' ? 'Add the blocks that slide.' : 'Add the blocks that rise when a plate is pressed.'); };
    on('#edAddRot', 'click', () => addG('rotor', { axis: 'y', cyc: true, start: 0 }));
    on('#edAddSl', 'click', () => addG('slider', { dir: [1, 0, 0], n: 3, start: 0 }));
    on('#edAddLift', 'click', () => addG('lift', { depth: 8, style: 'rise' }));
    on('#edDelG', 'click', () => { this.push(); d.groups.splice(this.layer, 1); this.layer = 0; this.rebuild(); this.ui(); });
    on('#edCyc', 'change', (e) => { this.push(); g.cyc = e.target.checked; if (!g.cyc) { g.min = 0; g.max = 1; } this.rebuild(); });
    on('#edStart', 'change', (e) => { this.push(); g.start = +e.target.value; });
    on('#edDir', 'change', (e) => { this.push(); g.dir = SLIDE_DIRS[e.target.value]; this.rebuild(); });
    on('#edN', 'change', (e) => { this.push(); g.n = +e.target.value; });
    on('#edDepth', 'change', (e) => { this.push(); g.depth = +e.target.value; });
    on('#edStyle', 'change', (e) => { this.push(); g.style = e.target.value; });
    on('#edWorld', 'change', (e) => { this.push(); d.worldOn = e.target.checked; this.rebuild(); });
    on('#edNewW', 'click', () => { this.railI = -1; this.tool = 'warden'; this.ui(); this.msg('Click tiles to lay the new warden’s patrol.'); });
    on('#edLoopW', 'click', () => { const s = d.sentinels[this.railI]; if (!s) return; this.push(); s.loop = !s.loop; this.ui(); });
    on('#edClrW', 'click', () => { this.push(); d.sentinels = []; this.railI = -1; this.rebuild(); this.ui(); });
    on('#edProve', 'click', () => this.prove());
    on('#edPlay', 'click', () => this.playTest());
    on('#edSave', 'click', () => this.store());
    on('#edNew', 'click', () => { this.push(); this.def = starter(); this.layer = 0; this.rebuild(true); this.ui(); });
    on('#edUndo', 'click', () => this.undo());
    on('#edExport', 'click', () => { const t = $('#edText'); t.hidden = false; t.value = JSON.stringify(this.def); t.select(); try { navigator.clipboard && navigator.clipboard.writeText(t.value); } catch (e) { /* ignore */ } this.msg('Level JSON below (copied if allowed).'); });
    on('#edImport', 'click', () => {
      const t = $('#edText');
      if (t.hidden) { t.hidden = false; t.value = ''; t.focus(); this.msg('Paste level JSON, then press Import again.'); return; }
      try { const nd = JSON.parse(t.value); if (!nd.groups) throw new Error('no groups'); this.push(); this.def = nd; this.normalize(); this.rebuild(true); this.ui(); this.msg('Imported.'); } catch (e) { this.msg('That is not a level: ' + e.message); }
    });
    on('#edZoomIn', 'click', () => this.zoomBy(0.8));
    on('#edZoomOut', 'click', () => this.zoomBy(1.25));
    on('#edExit', 'click', () => { this.close(); this.app.leaveEditor(); });
    this.el.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => { const c = this.app.save.custom[+b.dataset.load]; this.push(); this.def = JSON.parse(JSON.stringify(c.def)); this.normalize(); this.rebuild(true); this.ui(); }));
    this.el.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => { const c = this.app.save.custom[+b.dataset.play]; this.def = JSON.parse(JSON.stringify(c.def)); this.normalize(); this.playTest(); }));
    this.el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { this.app.save.custom.splice(+b.dataset.del, 1); S.save(this.app.save); this.ui(); }));
    this.status();
  }
  key(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape') { this.close(); this.app.leaveEditor(); return; }
    if (k === 'z') { this.undo(); return; }
    const t = TOOLS.find((x) => x[2] === k);
    if (t) { this.tool = t[0]; this.ui(); return; }
    const step = 0.6 * this.zoom;
    if (k === 'arrowleft' || k === 'a') this.pan.x -= step;
    else if (k === 'arrowright' || k === 'd') this.pan.x += step;
    else if (k === 'arrowup' || k === 'w') this.pan.y += step;
    else if (k === 'arrowdown' || k === 's') this.pan.y -= step;
    else if (k === '=' || k === '+') this.zoomBy(0.85);
    else if (k === '-') this.zoomBy(1.18);
    else return;
    e.preventDefault();
    this.applyCam();
  }
  // ---------- prove / play / store ----------
  prove() {
    let d;
    try { d = this.playable(true); F.compile(d); } catch (e) { this.msg(e.message); return; }
    this.msg('Proving… (searching every state)');
    if (!this.worker) {
      try { this.worker = new Worker(new URL('./hint-worker.js', import.meta.url), { type: 'module' }); } catch (e) { this.worker = null; }
    }
    const id = (this.proveId = (this.proveId || 0) + 1);
    const done = (r) => {
      if (id !== this.proveId) return;
      if (r.error) this.msg('Cannot compile: ' + r.error);
      else if (r.none) this.msg(r.capped ? `Too big to finish proving (${r.explored} states searched).` : 'No solution: the gate cannot be reached.');
      else { this.proof = `Proven: ${r.turns} snap(s), ${r.steps} step(s), ${r.explored} states searched.`; this.msg('Solvable.'); this.def.proof = { turns: r.turns, steps: r.steps }; this.status(); }
    };
    if (this.worker) { this.worker.onmessage = (e) => done(e.data.r); this.worker.postMessage({ id, def: d }); }
    else setTimeout(() => { const L = F.compile(d); const r = F.solve(L, F.init(L), F.won, 300000); done(r && r.actions ? { turns: r.turns, steps: r.steps, explored: r.explored } : { none: true, capped: r && r.capped, explored: r ? r.explored : 0 }); }, 20);
  }
  playTest() {
    let d;
    try { d = this.playable(true); F.compile(d); } catch (e) { this.msg(e.message); return; }
    d.par = this.def.proof ? this.def.proof.turns + 1 : undefined;
    this.close(true);
    this.app.playCustom(d);
  }
  store() {
    const s = this.app.save;
    s.custom = s.custom || [];
    const i = s.custom.findIndex((c) => c.id === this.def.id);
    const rec = { id: this.def.id, title: this.def.title, def: JSON.parse(JSON.stringify(this.def)), proof: !!this.def.proof, t: Date.now() };
    if (i >= 0) s.custom[i] = rec; else s.custom.unshift(rec);
    S.save(s);
    this.msg('Saved to this browser.');
    this.ui();
  }
}
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
