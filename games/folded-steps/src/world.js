// Folded Steps: turns a compiled level into three.js nodes. One node per logic group (rigid body), all under
// a root node that carries the whole-level rotation. Matrices are driven from continuous "view values", so a
// crank being dragged, a snap overshooting or a lift rising all go through the same code path as the logic.
import * as THREE from 'three';
import * as F from './logic.js';
import * as D from './deco.js';
import { E } from './tween.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const UPV = new THREE.Vector3(0, 1, 0);
const FACES = Object.entries(F.FACE);
const lighten = (c, k) => c.clone().lerp(new THREE.Color('#ffffff'), k);
const TM = new THREE.Matrix4(), TM2 = new THREE.Matrix4(), TM3 = new THREE.Matrix4(), TM4 = new THREE.Matrix4();

function ownMatrix(G, vm, vl, out) {
  const g = G.src;
  out.identity();
  if (G.kind === 'rotor') {
    const p = V(g.pivot), a = g.axis === 'x' ? new THREE.Vector3(1, 0, 0) : g.axis === 'y' ? UPV : new THREE.Vector3(0, 0, 1);
    out.makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationAxis(a, (vm[G.mi] * Math.PI) / 2)).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  } else if (G.kind === 'slider') {
    const d = V(g.dir).multiplyScalar(vm[G.mi]);
    out.makeTranslation(d.x, d.y, d.z);
  } else if (G.kind === 'lift') {
    // lifts sit at their final pose; the blocks themselves animate the travel (staggered)
    const p = (g.poses || [])[1] || {};
    const pv = V(p.pivot || [0, 0, 0]), off = V(p.off || [0, 0, 0]);
    const axis = p.axis === 'x' ? new THREE.Vector3(1, 0, 0) : p.axis === 'z' ? new THREE.Vector3(0, 0, 1) : UPV;
    out.makeTranslation(pv.x + off.x, pv.y + off.y, pv.z + off.z).multiply(new THREE.Matrix4().makeRotationAxis(axis, ((p.q || 0) * Math.PI) / 2)).multiply(new THREE.Matrix4().makeTranslation(-pv.x, -pv.y, -pv.z));
  }
  return out;
}

export class World {
  constructor(scene, P) { this.scene = scene; this.P = P; }
  build(L) {
    this.L = L;
    const P = this.P, def = L.def;
    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);
    this.nodes = [];
    this.solids = []; // raycast targets
    this.items = []; // animated props
    this.plates = [];
    this.lamps = [];
    this.handles = [];
    this.liftBlocks = L.lifts.map(() => []);
    this.vm = L.mechs.map((G) => G.start);
    this.vl = L.lifts.map(() => 0);
    this.stoneMat = D.stoneMat();
    const C = (h) => new THREE.Color(h);
    const pal = { stone: C(P.stone), col: C(P.col), acc: C(P.acc), mech: C(P.mech), wall: C(P.wall) };
    const walkFace = new Map(); // "g:x,y,z:F" -> tile id
    L.tiles.forEach((t) => { if (t.kind === 'face') walkFace.set(t.g + ':' + t.cell.join(',') + ':' + t.face, t); });
    for (const G of L.groups) {
      const node = new THREE.Group();
      node.matrixAutoUpdate = false;
      node.userData.g = G.i;
      this.root.add(node);
      this.nodes.push(node);
      const g = G.src;
      const own = new Set([...(g.blocks || []), ...(g.stairs || [])].map((b) => b.slice(0, 3).join(',')));
      // only a full cube hides the face next to it (domes, turrets, archways and stairs leave it open to the eye)
      const full = new Set((g.blocks || []).filter((b) => !/[dtrq]/.test(b[3] || '')).map((b) => b.slice(0, 3).join(',')));
      const stairCells = new Set((g.stairs || []).map((s) => s.slice(0, 3).join(',')));
      const isLift = G.kind === 'lift';
      const mechCol = (G.kind === 'rotor' || G.kind === 'slider') && !g.plain;
      const blocks = g.blocks || [];
      const geoOf = (list, cull) => {
        const pos = [], nor = [], col = [], af = [];
        for (const b of list) {
          const cell = b.slice(0, 3), fl = b[3] || '';
          if (fl.includes('d') || fl.includes('t') || fl.includes('r') || fl.includes('q')) continue;
          let base = fl.includes('a') ? pal.acc : fl.includes('b') || fl.includes('n') ? pal.col : pal.stone;
          if (mechCol && !fl.includes('a')) base = fl.includes('b') ? pal.mech.clone().lerp(pal.col, 0.45) : pal.mech;
          for (const [F0, n] of FACES) {
            const nb = [cell[0] + n[0], cell[1] + n[1], cell[2] + n[2]].join(',');
            if (cull && full.has(nb)) continue;
            const t = walkFace.get(G.i + ':' + cell.join(',') + ':' + F0);
            let c = base, kind = 0;
            if (t && t.grav) { c = pal.wall; kind = 3; }
            else if (n[1] === 1) { c = t ? lighten(base, 0.07) : base.clone().multiplyScalar(0.96); kind = t ? 1 : 0; }
            else if (n[1] === 0) kind = full.has([cell[0], cell[1] + 1, cell[2]].join(',')) ? 4 : 2;
            if (stairCells.has(nb)) { c = c.clone().multiplyScalar(0.84); kind = 0; } // the wall a flight stands against sits in its shade, so the steps read
            quad(pos, nor, col, af, cell, n, c, kind);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setAttribute('aF', new THREE.Float32BufferAttribute(af, 3));
        return geo;
      };
      const addSolid = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.g = G.i; this.solids.push(mesh); return mesh; };
      if (isLift) {
        // one mesh per block so the reveal can cascade
        for (const b of blocks) {
          const fl = b[3] || '';
          const m = fl.includes('d') || fl.includes('t') ? null : addSolid(new THREE.Mesh(geoOf([b], false), this.stoneMat));
          const holder = new THREE.Group();
          holder.userData.cell = b.slice(0, 3);
          if (m) holder.add(m);
          this.decoCell(holder, b, P, G);
          node.add(holder);
          this.liftBlocks[G.li].push(holder);
        }
      } else {
        const geo = geoOf(blocks, true);
        if (geo.attributes.position.count) node.add(addSolid(new THREE.Mesh(geo, this.stoneMat)));
        for (const b of blocks) this.decoCell(node, b, P, G);
        this.windows(node, G, own, blocks, P);
      }
      // stairs
      for (const s of g.stairs || []) {
        const t = L.tiles[L.key.get(g.id + ':' + s.slice(0, 3).join(','))];
        const m = addSolid(new THREE.Mesh(stairGeo(s, mechCol ? pal.mech : pal.stone), this.stoneMat));
        m.userData.tile = t.id;
        if (isLift) { const h = new THREE.Group(); h.userData.cell = s.slice(0, 3); h.add(m); node.add(h); this.liftBlocks[G.li].push(h); }
        else node.add(m);
      }
      for (const d of g.deco || []) this.decoItem(isLift ? this.liftBlocks[G.li].find((h) => h.userData.cell.join(',') === d.slice(1, 4).join(',')) || node : node, d, P);
    }
    // plates, the goal, the glimmer ride on their tiles
    L.plates.forEach((pl, i) => {
      const o = D.plate(P);
      this.attach(o, pl.tile);
      o.userData.i = i;
      this.plates.push(o);
    });
    this.goal = D.goalGate(P);
    this.attach(this.goal, L.goal);
    if (L.glim >= 0) { this.glim = D.glimmer(P); this.attach(this.glim, L.glim, 0); }
    // handles
    L.mechs.forEach((G, i) => {
      const g = G.src;
      let h;
      if (G.kind === 'slider') h = D.sliderKnob(P, g.dir);
      else {
        h = D.crank(P, G.kind === 'world' ? 0.62 : g.axis === 'y' ? 0.66 : 0.4);
        if (g.axis === 'x') h.rotation.z = Math.PI / 2;
        if (g.axis === 'z') h.rotation.x = Math.PI / 2;
      }
      const at = g.handle || g.pivot || [0, 0, 0];
      h.position.set(at[0], at[1], at[2]);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.mech = i;
      h.add(hit);
      h.userData = { mech: i, hit, base: h.quaternion.clone() };
      if (G.kind === 'world') {
        // a spindle down to the tower top so the wheel does not float
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8), D.mat(P.handle));
        sp.position.y = -0.6; h.add(sp);
        this.root.add(h);
      } else this.nodes[G.i].add(h);
      this.handles.push(h);
    });
    this.sync();
    return this;
  }
  // put an object on a tile, oriented to its local normal
  attach(o, t, lift = 0.001) {
    const tile = this.L.tiles[t];
    o.position.copy(V(tile.c)).addScaledVector(V(tile.n), lift);
    o.quaternion.setFromUnitVectors(UPV, V(tile.n));
    o.userData.tile = t;
    o.userData.base = o.position.clone();
    o.userData.up = V(tile.n);
    const holder = this.holderOf(tile);
    holder.add(o);
    o.traverse((m) => { if (m.isMesh) m.userData.tileHit = t; });
    this.items.push(o);
  }
  holderOf(tile) {
    const G = this.L.groups[tile.g];
    if (G.kind !== 'lift') return this.nodes[tile.g];
    const k = tile.cell.join(',');
    return this.liftBlocks[G.li].find((h) => h.userData.cell.join(',') === k) || this.nodes[tile.g];
  }
  decoCell(parent, b, P, G) {
    const fl = b[3] || '', c = V(b);
    let o = null;
    if (fl.includes('d')) { o = D.dome(P); o.position.copy(c); }
    else if (fl.includes('t')) { o = D.turret(P); o.position.copy(c); }
    else if (fl.includes('r') || fl.includes('q')) {
      // an archway block: solid for the logic, open to the eye
      o = new THREE.Mesh(D.archGeo(fl.includes('q') ? 'x' : 'z'), D.mat(fl.includes('a') ? P.acc : P.col, { rough: 0.85 }));
      o.position.copy(c);
      o.castShadow = o.receiveShadow = true;
      o.userData.g = G.i;
      this.solids.push(o);
    }
    if (o) { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData.g = G.i; } }); parent.add(o); }
  }
  decoItem(node, d, P) {
    const [type, x, y, z, arg] = d;
    const k = x * 7 + y * 13 + z * 29;
    const o = type === 'tree' ? D.tree(P, k) : type === 'hedge' ? D.hedge(P) : type === 'lamp' ? D.lamp(P) : type === 'flag' ? D.flag(P) : type === 'dome' ? D.dome(P, arg === 'big') : type === 'turret' ? D.turret(P) : null;
    if (!o) return;
    o.position.set(x, y + 0.5, z);
    if (type === 'dome' || type === 'turret') o.position.y += 0.5;
    const cn = { nw: [-0.4, -0.4], ne: [0.4, -0.4], sw: [-0.4, 0.4], se: [0.4, 0.4] }[arg];
    if (cn) { o.position.x += cn[0]; o.position.z += cn[1]; o.scale.setScalar(0.85); }
    if (type === 'lamp') this.lamps.push(o);
    node.add(o);
  }
  // arched windows on tall exposed faces (deterministic scatter)
  windows(node, G, own, blocks, P) {
    const geo = D.windowPane();
    const wm = D.mat('#40385a', { rough: 1, env: 0.2 });
    const glowm = D.mat(P.glow, { emit: P.glow, ei: 0.9 });
    const occ = (x, y, z) => own.has(x + ',' + y + ',' + z);
    for (const b of blocks) {
      const [x, y, z] = b;
      if (!occ(x, y + 1, z) || !occ(x, y - 1, z)) continue; // mid-column cells only
      for (const [n, ry] of [[[1, 0, 0], Math.PI / 2], [[0, 0, 1], 0]]) {
        if (occ(x + n[0], y, z + n[2])) continue;
        const r = D.hash(x, y, z + n[0] * 5);
        if (r > 0.2) continue;
        const w = new THREE.Mesh(geo, r < 0.05 ? glowm : wm);
        w.position.set(x + n[0] * 0.502, y, z + n[2] * 0.502);
        w.rotation.y = ry;
        node.add(w);
      }
    }
  }
  // ---------- view values -> matrices ----------
  sync() {
    const L = this.L;
    if (L.world) {
      const p = V(L.world.src.pivot);
      this.root.matrix.makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationY((this.vm[L.world.mi] * Math.PI) / 2)).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    } else this.root.matrix.identity();
    this.root.matrixWorldNeedsUpdate = true;
    L.groups.forEach((G, i) => { ownMatrix(G, this.vm, this.vl, this.nodes[i].matrix); this.nodes[i].matrixWorldNeedsUpdate = true; });
    // lift blocks travel from pose 0 to pose 1 in a cascade (lowest first)
    L.lifts.forEach((G, j) => {
      const p0 = (G.src.poses || [])[0] || {}, p1 = (G.src.poses || [])[1] || {};
      const d = V(p0.off || [0, 0, 0]).sub(V(p1.off || [0, 0, 0]));
      const hs = this.liftBlocks[j];
      const ys = hs.map((h) => h.userData.cell[1]);
      const lo = Math.min(...ys), hi = Math.max(...ys), span = Math.max(1, hi - lo);
      const v = this.vl[j];
      const unfold = G.src.style === 'unfold';
      hs.forEach((h, k) => {
        const c = h.userData.cell;
        const delay = ((c[1] - lo) / span) * 0.45 + D.hash(c[0], c[2], k) * 0.08;
        const e = E.out(Math.min(1, Math.max(0, (v - delay) / (1 - delay * 0.9))));
        h.matrixAutoUpdate = false;
        if (unfold) {
          // each block unfolds about its own centre: turning, growing and settling the last step
          const cv = V(c), a = (1 - e) * (k % 2 ? 1.5 : -1.5);
          h.matrix.makeTranslation(cv.x, cv.y - 1.4 * (1 - e), cv.z)
            .multiply(TM.makeRotationY(a)).multiply(TM2.makeRotationX(a * 0.5))
            .multiply(TM3.makeScale(Math.max(0.001, e), Math.max(0.001, e), Math.max(0.001, e)))
            .multiply(TM4.makeTranslation(-cv.x, -cv.y, -cv.z));
        } else {
          h.matrix.makeTranslation(d.x * (1 - e), d.y * (1 - e), d.z * (1 - e));
          // lower blocks overtake the ones above mid-cascade; a hair of shrink that differs per height (gone at
          // rest) keeps the faces of one column off a shared plane so they don't flicker
          if (e < 1) { const s = 1 - 0.002 * (1 + c[1] - lo), cv = V(c); h.matrix.multiply(TM.makeTranslation(cv.x, cv.y, cv.z)).multiply(TM2.makeScale(s, s, s)).multiply(TM3.makeTranslation(-cv.x, -cv.y, -cv.z)); }
        }
        h.matrixWorldNeedsUpdate = true;
        h.visible = e > 0.001 || v > 0.999;
      });
    });
    this.root.updateMatrixWorld(true);
  }
  setView(vm, vl) { this.vm = vm.slice(); this.vl = vl.slice(); this.sync(); }
  // current world position & normal of a tile (follows animated matrices)
  tileWorld(t, out = { c: new THREE.Vector3(), n: new THREE.Vector3() }) {
    const tile = this.L.tiles[t];
    const holder = this.holderOf(tile);
    out.c.copy(V(tile.c)).applyMatrix4(holder.matrixWorld);
    out.n.copy(V(tile.n)).transformDirection(holder.matrixWorld).round();
    return out;
  }
  // tile under a ray hit (or null)
  tileFromHit(hit) {
    if (hit.object.userData.tileHit != null) return hit.object.userData.tileHit;
    if (hit.object.userData.tile != null) return hit.object.userData.tile;
    const gi = hit.object.userData.g;
    if (gi == null || !hit.face) return null;
    const node = hit.object.parent;
    const lp = node.worldToLocal(hit.point.clone());
    const n = hit.face.normal.clone().round();
    const cell = lp.clone().addScaledVector(n, -0.5).round();
    const G = this.L.groups[gi];
    const F0 = F.faceName([n.x, n.y, n.z]);
    const k = G.id + ':' + [cell.x, cell.y, cell.z].join(',') + (F0 === '+y' ? '' : ':' + F0);
    const id = this.L.key.get(k);
    return id == null ? null : id;
  }
  // water foam + reflections: every column crossing the water, with how tall it stands above it
  pillars(Gr, waterY) {
    const top = new Map();
    for (const G of this.L.groups) for (const c of G.cells) {
      const w = F.xp(Gr.P[G.i], c);
      const k = Math.round(w[0]) + ',' + Math.round(w[2]);
      const e = top.get(k) || { lo: Infinity, hi: -Infinity, x: w[0], z: w[2] };
      e.lo = Math.min(e.lo, w[1]); e.hi = Math.max(e.hi, w[1]);
      top.set(k, e);
    }
    const out = [];
    for (const e of top.values()) if (e.lo <= waterY + 0.5 && e.hi >= waterY) out.push([e.x, e.z, Math.min(6, e.hi - waterY + 0.5), 1]);
    return out.sort((a, b) => b[2] - a[2]);
  }
  // screen box of every walkable tile over each mechanism position (so the camera stays put); columns may
  // run off the bottom of the frame into the mist and the lake
  // (for whole-level rotation only the given world orientation counts, and the camera re-frames on a turn)
  bounds(waterY, worldV) {
    const L = this.L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, ylo = Infinity;
    const base = L.mechs.map((G) => G.start), lift = L.lifts.map(() => 1);
    if (L.world && worldV != null) base[L.world.mi] = worldV;
    const combos = [base];
    L.mechs.forEach((G, i) => { if (G === L.world && worldV != null) return; G.dom.forEach((v) => { const m = base.slice(); m[i] = v; combos.push(m); }); });
    for (const m of combos) {
      const Gr = F.graph(L, m, lift);
      Gr.W.forEach((w, i) => {
        if (!w.active) return;
        const s = F.scr(w.c);
        u0 = Math.min(u0, s[0] - 0.9); u1 = Math.max(u1, s[0] + 0.9); v0 = Math.min(v0, s[1] - 0.7); v1 = Math.max(v1, s[1] + 1.1);
        x0 = Math.min(x0, w.c[0]); x1 = Math.max(x1, w.c[0]); z0 = Math.min(z0, w.c[2]); z1 = Math.max(z1, w.c[2]); ylo = Math.min(ylo, w.c[1]);
      });
    }
    return { u0, u1, v0, v1, ylo, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rad: Math.hypot(x1 - x0, z1 - z0) / 2 + 7 };
  }
  animate(dt, t, st) {
    if (this.goal) { const u = this.goal.userData; u.glyph.rotation.y += dt * 1.3; u.glyph.position.y = 0.95 + Math.sin(t * 2) * 0.05; u.halo.rotation.x = Math.PI / 2 + Math.sin(t * 0.8) * 0.3; u.halo.rotation.y = t * 0.6; }
    if (this.glim && this.glim.visible) { const u = this.glim.userData; this.glim.children.forEach((c, i) => (c.rotation.y += dt * (2 + i))); this.glim.position.copy(u.base).addScaledVector(u.up, 0.4 + Math.sin(t * 2.6) * 0.06); }
    this.lamps.forEach((l, i) => { l.userData.orb.material.emissiveIntensity = 1.4 + Math.sin(t * 3 + i * 1.7) * 0.25; });
    if (st) {
      const pr = F.pressed(this.L, st);
      this.plates.forEach((o) => {
        const on = pr[o.userData.i];
        const u = o.userData;
        const k = on ? 1 : 0;
        u.p = (u.p ?? 0) + (k - (u.p ?? 0)) * Math.min(1, dt * 10);
        u.slab.position.y = 0.03 - u.p * 0.025;
        u.ring.position.y = 0.065 - u.p * 0.025;
        u.ring.material = D.mat(this.P.glow, { emit: this.P.glow, ei: u.p * 1.8 });
      });
    }
  }
  dispose() {
    this.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.scene.remove(this.root);
    this.stoneMat.dispose();
  }
}

// one cube face as two triangles; aF = (u, v, kind) with v running "up" the face
function quad(pos, nor, col, af, cell, n, c, kind) {
  const [x, y, z] = cell;
  const nx = n[0], ny = n[1], nz = n[2];
  // tangent (u) and bitangent (v) for this face
  let u, v;
  if (ny) { u = [1, 0, 0]; v = [0, 0, -ny]; }
  else if (nx) { u = [0, 0, -nx]; v = [0, 1, 0]; }
  else { u = [nz, 0, 0]; v = [0, 1, 0]; }
  const cx = x + nx * 0.5, cy = y + ny * 0.5, cz = z + nz * 0.5;
  const P = (a, b) => [cx + (u[0] * a + v[0] * b), cy + (u[1] * a + v[1] * b), cz + (u[2] * a + v[2] * b)];
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const vs = corners.map(([a, b]) => P(a, b));
  // winding: make sure the triangle faces along n
  const e1 = [vs[1][0] - vs[0][0], vs[1][1] - vs[0][1], vs[1][2] - vs[0][2]], e2 = [vs[2][0] - vs[0][0], vs[2][1] - vs[0][1], vs[2][2] - vs[0][2]];
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const flip = cr[0] * nx + cr[1] * ny + cr[2] * nz < 0;
  const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  for (const i of order) {
    pos.push(...vs[i]); nor.push(nx, ny, nz); col.push(c.r, c.g, c.b);
    af.push(corners[i][0] + 0.5, corners[i][1] + 0.5, kind);
  }
}
// a flight of four solid steps filling one cell, rising along d
function stairGeo(s, base) {
  const d = F.FACE[s[3]];
  const geos = [];
  const tread = base.clone().lerp(new THREE.Color('#ffffff'), 0.1);
  for (let k = 0; k < 4; k++) {
    const h = (k + 1) / 4;
    const g = new THREE.BoxGeometry(d[0] ? 0.25 : 1, h, d[2] ? 0.25 : 1);
    const along = -0.5 + (k + 0.5) / 4;
    g.translate(d[0] * along, -0.5 + h / 2, d[2] * along);
    const n = g.attributes.normal, cols = [], af = [];
    for (let i = 0; i < n.count; i++) {
      const top = n.getY(i) > 0.5;
      const c = top ? tread : base;
      cols.push(c.r, c.g, c.b);
      af.push(0.5, 0.5, 0);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(af, 3));
    g.deleteAttribute('uv');
    geos.push(g);
  }
  const m = D.mergeGeometries(geos);
  m.translate(s[0], s[1], s[2]);
  return m;
}
