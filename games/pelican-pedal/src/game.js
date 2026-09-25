// Game layer: schools of flying fish that leap from the surf and glide over the road in lines and
// arcs (runner-game style: ride through them and the pouch scoops them up), crabs to hop, combos,
// a score for Arcade.saveBest, 16 achievements, and an autopilot that rides the lines and shows off
// whenever nobody is at the controls.
import { THREE, V3, clamp, lerp, smooth, rng, scene, store, bus, TAU, noReflect, bakeStatic } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOOP_LEN, ROAD_W } from './layout.js';
import { roadFrame, roadHeightAt } from './world.js';
import { LANE } from './rider.js';

export const ACH = [
  { id: 'first', name: 'First Bite', desc: 'Scoop your first fish', icon: '🐟' },
  { id: 'ten', name: 'Pouch Full', desc: 'Catch 50 fish in one ride', icon: '🧺' },
  { id: 'golden', name: 'Gold Leaf', desc: 'Catch a golden fish', icon: '✨' },
  { id: 'combo5', name: 'Hot Streak', desc: 'Catch 30 fish in a row', icon: '🔥' },
  { id: 'wheelie3', name: 'Wing and a Prayer', desc: 'Hold a wing-lift wheelie for 3 s', icon: '🪽' },
  { id: 'wheelie8', name: 'Kite Mode', desc: 'Hold a wing-lift wheelie for 8 s', icon: '🪁' },
  { id: 'crab', name: 'Crab Hopper', desc: 'Hop clean over a crab', icon: '🦀' },
  { id: 'bell', name: 'Ding Ding', desc: 'Ring the bell 10 times', icon: '🔔' },
  { id: 'lap', name: 'Round the Island', desc: 'Ride a full lap of the island', icon: '🏝️' },
  { id: 'boardwalk', name: 'Planked', desc: 'Ride the whole boardwalk', icon: '🪵' },
  { id: 'keeper', name: 'Keeper of the Light', desc: 'Pass the lighthouse at night', icon: '🗼' },
  { id: 'golden-hour', name: 'Golden Hour', desc: 'Ride for 30 s in golden light', icon: '🌅' },
  { id: 'night', name: 'Night Rider', desc: 'Ride for 60 s after dark', icon: '🌙' },
  { id: 'dawn', name: 'Dawn Patrol', desc: 'Be riding when the sun rises', icon: '🌄' },
  { id: 'speed', name: 'Downhill Dive', desc: 'Reach 40 km/h', icon: '💨' },
  { id: 'photo', name: 'Shutterbug', desc: 'Take a photo in photo mode', icon: '📷' },
];
// fish lines: three lanes, glided at pouch height; the pouch pulls in anything inside the magnet radius
export const LANES = [-1.7, 0, 1.7];
const FISH_H = 1.35, GLIDE = 1.0, MAGNET = 0.8, SCOOP_MAGNET = 1.45, PULL = 0.16, AHEAD = 58, ARC_H = 1.0, NFISH = 24;
export const ZONE_NAMES = { beach: 'Sunset Beach', boardwalk: 'The Boardwalk', town: 'Harbour Town', climb: 'Headland Climb', lighthouse: 'Lighthouse Point', cliffs: 'The Cliffs', pines: 'Pine Dunes', south: 'South Strand' };

function fishGeometry(golden) {
  const prof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.028 * (1 - t * 0.3) + 0.001, (t - 0.5) * 0.26)); }
  const body = new THREE.LatheGeometry(prof, 12).rotateX(Math.PI / 2).scale(1, 0.85, 1);
  const p = body.attributes.position, c = new Float32Array(p.count * 3), top = new THREE.Color(golden ? 0xd88a10 : 0x1d4a8c), belly = new THREE.Color(golden ? 0xffe27a : 0xe8eef4), cc = new THREE.Color();
  for (let i = 0; i < p.count; i++) { cc.copy(belly).lerp(top, smooth(-0.01, 0.015, p.getY(i))); c.set([cc.r, cc.g, cc.b], i * 3); }
  body.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return body;
}

export class Game {
  constructor(rider, pel, fx, sky, director) {
    this.rider = rider; this.pel = pel; this.fx = fx; this.sky = sky; this.director = director;
    this.playing = false; this.autopilot = true; this.idle = 0;
    this.unlocked = new Set(JSON.parse(store.get('ach') || '[]'));
    this.resetRide();
    // fish pool
    const finTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); g.fillStyle = 'rgba(120,170,230,0.75)'; g.beginPath(); g.moveTo(2, 32); g.quadraticCurveTo(40, -6, 62, 10); g.lineTo(62, 54); g.quadraticCurveTo(40, 70, 2, 32); g.fill(); g.strokeStyle = 'rgba(30,50,90,0.6)'; g.lineWidth = 1.2; for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(2, 32); g.lineTo(62, 12 + i * 7); g.stroke(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const finM = new THREE.MeshStandardMaterial({ map: finTex, transparent: true, side: THREE.DoubleSide, roughness: 0.3, depthWrite: false });
    const bodyM = [false, true].map((g) => new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.22, iridescence: 0.6, iridescenceIOR: 1.6, clearcoat: 0.8, emissive: g ? 0x553300 : 0x000000 }));
    // gliding pose: pectoral fins spread like wings, tail fin upright. One instanced draw per part.
    const o = new THREE.Object3D(), fins = [1, -1].map((sd) => { o.position.set(sd * 0.02, 0.005, 0.03); o.rotation.set(-Math.PI / 2, 0, sd > 0 ? 0.2 : Math.PI - 0.2); o.updateMatrix(); return new THREE.PlaneGeometry(0.16, 0.08).translate(0.08, 0, 0).applyMatrix4(o.matrix); });
    fins.push(new THREE.PlaneGeometry(0.07, 0.08).rotateY(Math.PI / 2).translate(0, 0, -0.16));
    const inst = (g, m, cast) => { const im = new THREE.InstancedMesh(g, m, NFISH); im.count = 0; im.frustumCulled = false; im.castShadow = cast; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(noReflect(im)); return im; };
    this.fishMesh = [inst(fishGeometry(false), bodyM[0], true), inst(fishGeometry(true), bodyM[1], true), inst(mergeGeometries(fins), finM, false)];
    // a soft glint behind each fish, so a line reads from far down the road like runner-game coins
    const glintTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NFISH * 3), 3).setUsage(THREE.DynamicDrawUsage)); gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NFISH * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const glintM = new THREE.PointsMaterial({ map: glintTex, size: 0.95, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    // like runner coins, a line stays readable far down the road: glints never shrink below ~2.6% of the screen height
    glintM.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', 'gl_PointSize = max(gl_PointSize, scale * 0.052);\n#include <fog_vertex>'); };
    this.glint = new THREE.Points(gg, glintM);
    this.glint.frustumCulled = false; scene.add(noReflect(this.glint));
    this.fish = [];
    for (let i = 0; i < NFISH; i++) this.fish.push({ g: new THREE.Object3D(), on: false, state: 'off', spawnId: -1 });
    this.lines = []; this.spawnN = 0; this.lineN = 0;
    // crabs
    const shell = new THREE.MeshPhysicalMaterial({ color: 0xd8482a, roughness: 0.35, clearcoat: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1010 });
    this.crabs = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group(); g.visible = false; scene.add(g);
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 8).scale(1.3, 0.45, 1), shell); body.position.y = 0.07; body.castShadow = true; g.add(body);
      const legs = [];
      for (const sd of [1, -1]) {
        // three legs per side on one pivot, so they can scuttle as a unit
        const side = new THREE.Group(); side.position.set(sd * 0.1, 0.07, 0); g.add(side); legs.push(side);
        for (let k = 0; k < 3; k++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.12, 5).translate(0, -0.06, 0), shell); l.position.set(0, 0, (k - 1) * 0.045); l.rotation.z = sd * 0.9; side.add(l); }
        const claw = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6).scale(1.3, 0.8, 1), shell); claw.position.set(sd * 0.09, 0.08, 0.11); claw.castShadow = true; g.add(claw);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), dark); eye.position.set(sd * 0.03, 0.13, 0.08); g.add(eye);
      }
      bakeStatic(g, (o) => legs.includes(o)); legs.forEach((L) => bakeStatic(L));
      noReflect(g); this.crabs.push({ g, legs, on: false });
    }
    this.nextLineS = 0; this.nextCrab = 9; this.R = rng(Date.now() & 0xffff);
  }
  resetRide() {
    this.score = 0; this.combo = 0; this.fishRide = 0; this.dist = 0; this.wheelieT = 0; this.bells = 0; this.crabHops = 0;
    this.goldenT = 0; this.nightT = 0; this.boardwalkRun = 0; this.lastZone = null; this.laps = 0; this.lapStart = this.rider.s; this.lastEl = null; this.rideT = 0;
    this.saveT = 0;
  }
  start() { this.playing = true; this.autopilot = false; this.idle = 0; this.resetRide(); bus.emit('score', this.score); }
  stop() { this.playing = false; this.autopilot = true; this.save(); }
  save() { if (window.Arcade && Arcade.saveBest) Arcade.saveBest(this.score); }
  best() { return window.Arcade && Arcade.best ? Arcade.best() : 0; }
  unlock(id) {
    if (this.unlocked.has(id)) return;
    if (id !== 'photo' && (!this.playing || this.autopilot)) return;
    this.unlocked.add(id); store.set('ach', JSON.stringify([...this.unlocked]));
    bus.emit('ach', ACH.find((a) => a.id === id));
  }
  add(pts) { if (!this.playing || this.autopilot) return; this.score += Math.round(pts); bus.emit('score', this.score); }

  // a school: 5-8 fish in a lane, a lane change, a slalom, or a high arc that needs a hop
  spawnLine() {
    const R = this.R, rd = this.rider, s0 = rd.s + AHEAD;
    const r = R(), kind = r < 0.34 ? 'straight' : r < 0.62 ? 'change' : r < 0.8 ? 'slalom' : 'arc';
    const n = kind === 'arc' ? 7 : 5 + Math.floor(R() * 4), gap = kind === 'arc' ? 0.8 : 2.2;
    for (let i = 0; i < n; i += 2) if (roadFrame(s0 + i * gap, 0).p.y > 6.5) return false; // no leaping up the cliffs
    const free = this.fish.filter((f) => !f.on); if (free.length < n) return false;
    const a = Math.floor(R() * 3), b = a === 1 ? (R() < 0.5 ? 0 : 2) : 1;
    const gold = R() < 0.3 ? (kind === 'arc' ? 3 : n - 1) : -1;
    const line = { id: this.lineN++, n, caught: 0, missed: 0, kind, golden: false, peak: null };
    this.lines.push(line);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), f = free[i];
      f.lat = kind === 'straight' || kind === 'arc' ? LANES[a] : kind === 'change' ? lerp(LANES[a], LANES[b], smooth(0.2, 0.8, u)) : lerp(LANES[a], LANES[b], 0.5 - 0.5 * Math.cos(u * TAU));
      f.h = FISH_H + (kind === 'arc' ? ARC_H * Math.sin(Math.PI * u) : 0);
      f.s = s0 + i * gap; f.line = line; f.i = i; f.golden = i === gold; f.t = 0; f.delay = i * 0.07;
      f.L = roadFrame(f.s - 6 + R() * 4, ROAD_W / 2 + 16 + R() * 8).p.clone(); f.L.y = -0.2;
      f.on = true; f.state = 'leap'; f.vis = false; f.spawnId = this.spawnN++; f.scale = 2.2;
      if (kind === 'arc' && i === 3) line.peak = f;
    }
    this.fx.splash(free[0].L.clone().setY(0.05), 16, 0.6);
    bus.emit('fish-leap', free[0].L);
    return true;
  }
  spawnCrab() {
    const R = this.R, rd = this.rider, c = this.crabs.find((x) => !x.on); if (!c) return;
    const zn = rd.R.zone; if (!(zn === 'beach' || zn === 'south' || zn === 'boardwalk' || zn === 'pines')) return;
    c.s = rd.s + 26 + R() * 12; c.dir = R() < 0.5 ? 1 : -1; c.lat = -c.dir * (LANE + 0.4); c.speed = 0.55 + R() * 0.3; c.on = true; c.g.visible = true; c.hit = false; c.t = 0;
  }
  // returns autopilot input (if driving) for the rider
  update(dt, t, inp) {
    const rd = this.rider, pel = this.pel, R = rd.R;
    this.rideT += dt;
    if (this.playing) { this.idle = inp.any ? 0 : this.idle + dt; this.autopilot = this.idle > 15; }
    // --- fish lines, spaced by distance so a faster ride meets more of them
    if (this.nextLineS < rd.s + AHEAD - 200) this.nextLineS = rd.s + AHEAD; // teleports and restarts
    // only during a ride: the unattended film stays a clean portrait of the pelican
    if (this.playing && rd.s + AHEAD >= this.nextLineS && rd.v > 2.5) this.nextLineS = this.spawnLine() ? rd.s + AHEAD + 30 + this.R() * 22 : this.nextLineS + 15;
    const pouch = pel.pouchWorld(new V3()), radius = rd.scoop ? SCOOP_MAGNET : MAGNET;
    const F = this._F || (this._F = roadFrame(0)), p = new V3(), dir = new V3();
    let next = null, mouth = 0;
    for (const f of this.fish) {
      if (!f.on) continue;
      f.t += dt;
      if (f.state !== 'pull') f.s += GLIDE * dt;
      const Fr = roadFrame(f.s, f.lat, F);
      if (f.state === 'pull') {
        // the magnet: a quick curl into the pouch, shrinking as it goes down the hatch
        const u = smooth(0, 1, Math.min(1, f.t / PULL));
        p.lerpVectors(f.from, pouch, u); p.y += Math.sin(u * Math.PI) * 0.15; f.scale = 2.2 * (1 - 0.6 * u);
        dir.subVectors(pouch, f.from);
        if (f.t >= PULL) { this.catch(f); continue; }
      } else {
        // hovering broadside, still heading inland from the leap (and a touch towards the rider), so the
        // chase camera sees each fish's full profile rather than a tail-on dot
        p.copy(Fr.p); p.y += f.h + Math.sin(t * 3.1 + f.i * 0.7) * 0.05; dir.copy(Fr.n).multiplyScalar(-1).addScaledVector(Fr.t, -0.4);
        if (f.state === 'leap') {
          const u = (f.t - f.delay) / 0.9;
          if (u < 0) { f.vis = false; continue; }
          f.vis = true;
          if (u < 1) { const e = smooth(0, 1, u), q = p.clone(); p.lerpVectors(f.L, q, e); p.y += Math.sin(u * Math.PI) * 3; dir.subVectors(q, f.L); dir.y = Math.cos(u * Math.PI) * 6; }
          else f.state = 'fly';
        }
      }
      f.g.position.copy(p); f.g.lookAt(p.clone().add(dir)); f.g.rotateZ(Math.sin(t * 2.3 + f.i) * 0.15); f.g.scale.setScalar(f.scale);
      if (f.golden && Math.random() < 0.3) this.fx.sparkle(p, 1);
      if (f.state === 'fly') {
        const ahead = new V3().subVectors(p, R.pos), fw = ahead.dot(R.fwd);
        if (p.distanceTo(pouch) < radius) { f.state = 'pull'; f.t = 0; f.from = p.clone(); continue; }
        if (fw > -0.5 && (!next || f.s < next.s)) next = f;
        if (fw > 0 && fw < 4.5 && Math.abs(ahead.dot(R.right)) < 1.6) mouth = Math.max(mouth, 0.75); // the bill opens as fish come in reach
        if (fw < -1.2) { f.state = 'miss'; this.miss(f); }
      } else if (f.state === 'pull') mouth = 1;
      if (f.state === 'miss' && f.s < rd.s - 12) { f.on = false; f.state = 'off'; }
    }
    rd.mouth = mouth;
    this.nextTarget = next;
    // instancing: one draw for silver bodies, one for golden, one for all the fins
    const [B0, B1, FN] = this.fishMesh, gp = this.glint.geometry.attributes.position, gc = this.glint.geometry.attributes.color, dusk = 0.8 + 0.2 * this.sky.night;
    let n0 = 0, n1 = 0, nf = 0;
    for (const f of this.fish) {
      if (!f.on || !f.vis) continue;
      f.g.updateMatrix();
      if (f.golden) B1.setMatrixAt(n1++, f.g.matrix); else B0.setMatrixAt(n0++, f.g.matrix);
      if (f.state !== 'miss') {
        // (faded out near the lens, where the fish itself is plain to see and a glint would just blur)
        const tw = (0.75 + 0.25 * Math.sin(t * 7 + f.spawnId * 2.1)) * dusk * (f.state === 'pull' ? 1 - f.t / PULL : 1) * smooth(6, 16, f.g.position.distanceTo(this.director.camPos));
        gp.setXYZ(nf, f.g.position.x, f.g.position.y, f.g.position.z);
        if (f.golden) gc.setXYZ(nf, 1.5 * tw, 1.1 * tw, 0.45 * tw); else gc.setXYZ(nf, 1.2 * tw, 1.35 * tw, 1.5 * tw);
      } else { gp.setXYZ(nf, 0, -1e4, 0); }
      FN.setMatrixAt(nf++, f.g.matrix);
    }
    B0.count = n0; B1.count = n1; FN.count = nf; this.glint.geometry.setDrawRange(0, nf);
    gp.needsUpdate = gc.needsUpdate = true;
    for (const m of this.fishMesh) m.instanceMatrix.needsUpdate = true;
    // --- crabs
    this.nextCrab -= dt;
    if (this.nextCrab <= 0) { this.spawnCrab(); this.nextCrab = 7 + this.R() * 8; }
    for (const c of this.crabs) {
      if (!c.on) continue;
      c.t += dt; c.lat += c.dir * c.speed * dt;
      const F = roadFrame(c.s, c.lat);
      c.g.position.copy(F.p); c.g.position.y += 0.02 + Math.abs(Math.sin(t * 14)) * 0.01;
      c.g.lookAt(c.g.position.clone().add(F.t));
      c.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 22 + i * 1.7) * 0.4; });
      const ds = c.s - rd.s;
      if (!c.hit && Math.abs(ds) < 0.35 && Math.abs(c.lat - rd.lat) < 0.4) {
        c.hit = true;
        if (rd.h > 0.18) { this.crabHops++; this.add(150 * Math.max(1, this.combo)); this.unlock('crab'); bus.emit('crab-hop', c.g.position); }
        else { this.combo = 0; this.fx.puff(pel.worldOf(new V3(0, 0.35, 0.05))); rd.v *= 0.7; rd.bump = -12; bus.emit('crab-hit', c.g.position); c.dir *= -3; }
      }
      if (ds < -6 || Math.abs(c.lat) > LANE + 3) { c.on = false; c.g.visible = false; }
    }
    // --- trackers
    const el = this.sky.el, moving = rd.v > 1;
    if (moving) this.dist += rd.v * dt;
    if (this.playing && !this.autopilot) {
      this.distPts = (this.distPts || 0) + rd.v * dt; while (this.distPts > 10) { this.distPts -= 10; this.add(1); }
      if (rd.trick > 0.8) { this.wheelieT += dt; this.add(40 * dt); if (this.wheelieT > 3) this.unlock('wheelie3'); if (this.wheelieT > 8) this.unlock('wheelie8'); } else this.wheelieT = 0;
      if (rd.v >= 40 / 3.6) this.unlock('speed');
      if (moving && this.sky.isGolden()) { this.goldenT += dt; if (this.goldenT > 30) this.unlock('golden-hour'); }
      if (moving && this.sky.night > 0.8) { this.nightT += dt; if (this.nightT > 60) this.unlock('night'); }
      if (this.lastEl !== null && this.lastEl < 0 && el >= 0 && moving) this.unlock('dawn');
      if (R.zone === 'lighthouse' && this.sky.night > 0.7) this.unlock('keeper');
      if (R.zone === 'boardwalk' && moving) this.boardwalkRun += rd.v * dt; else if (R.zone !== 'boardwalk') { if (this.boardwalkRun > 200) this.unlock('boardwalk'); this.boardwalkRun = 0; }
      if (rd.s - this.lapStart >= LOOP_LEN) { this.lapStart += LOOP_LEN; this.laps++; this.unlock('lap'); bus.emit('lap', this.laps); this.add(500); }
      this.saveT -= dt; if (this.saveT <= 0) { this.saveT = 2; this.save(); }
    }
    this.lastEl = el;
    if (R.zone !== this.lastZone) { if (this.lastZone) bus.emit('zone', ZONE_NAMES[R.zone]); this.lastZone = R.zone; }
    // --- what the pelican looks at: the incoming fish, else the road ahead
    const nd = next ? next.s - rd.s : 99;
    if (nd < 9) { rd.look = next.g.position; rd.lookW = smooth(9, 4, nd) * 0.6; rd.eyeLook = next.g.position; }
    else { rd.look = null; rd.lookW = 0; rd.eyeLook = null; }
    // --- autopilot
    if (!this.autopilot) return null;
    const ai = { pedal: 0, brake: 0, steer: 0, hop: false, trick: false, scoop: false, any: false };
    const cruise = 7.2 + Math.sin(t * 0.07) * 1.2;
    ai.pedal = rd.v < cruise ? clamp((cruise - rd.v) * 0.8 + 0.35, 0.2, 1) : 0;
    // some freewheeling on the descents
    if (roadHeightAt(rd.s + 10) < roadHeightAt(rd.s) - 0.4) ai.pedal *= 0.2;
    let tgtLat = Math.sin(t * 0.05) * 1.2;
    if (next && nd < 30) {
      tgtLat = next.lat;
      // arcs: hop so the top of the hop meets the top of the arc
      const pk = next.line.peak;
      if (pk && pk.state === 'fly') { const eta = (pk.s - rd.s - 0.33) / Math.max(rd.v - GLIDE, 1); if (eta > 0.27 && eta < 0.34) ai.hop = true; }
    }
    for (const c of this.crabs) if (c.on && !c.hit) { const ds = c.s - rd.s; if (ds > 0 && ds < rd.v * 0.32 + 0.4 && Math.abs(c.lat - rd.lat) < 0.8) ai.hop = true; }
    ai.steer = clamp(-(tgtLat - rd.lat) * 1.1, -1, 1);
    // show off on quiet straights
    this.showT = (this.showT || 0) + dt;
    if (nd > 30 && this.showT > 26 && Math.abs(rd.F.k) < 0.004 && rd.v > 5) { this.trickT = 3 + Math.random() * 2; this.showT = 0; }
    if (this.trickT > 0) { this.trickT -= dt; ai.trick = true; }
    this.bellT = (this.bellT || 12) - dt; if (this.bellT <= 0) { this.bellT = 18 + Math.random() * 20; rd.ring(); }
    return ai;
  }
  catch(f) {
    const L = f.line;
    f.on = false; f.state = 'caught';
    this.combo++; this.fishRide++; L.caught++; L.golden = L.golden || f.golden;
    const mult = this.mult(), pts = (f.golden ? 250 : 25) * mult;
    this.add(pts);
    this.pel.catchFish(f.golden);
    this.fx.sparkle(f.g.position, f.golden ? 36 : 7);
    this.unlock('first'); if (this.fishRide >= 50) this.unlock('ten'); if (f.golden) this.unlock('golden'); if (this.combo >= 30) this.unlock('combo5');
    bus.emit('catch', { golden: f.golden, combo: this.combo, pts, n: L.caught, pos: f.g.position.clone() });
    this.lineStep(L);
  }
  mult() { return 1 + Math.min(4, Math.floor(this.combo / 10)); }
  miss(f) { if (this.combo >= 5) bus.emit('combo-lost', this.combo); this.combo = 0; f.line.missed++; this.lineStep(f.line); }
  // a school is done once every fish is caught or behind: swallow the lot, bonus for a clean sweep
  lineStep(L) {
    if (L.caught + L.missed < L.n) return;
    this.lines.splice(this.lines.indexOf(L), 1);
    if (!L.caught) return;
    const perfect = !L.missed, bonus = perfect ? 100 * this.mult() : 0;
    this.add(bonus);
    this.pel.gulp();
    bus.emit('line', { n: L.n, caught: L.caught, perfect, golden: L.golden, bonus, combo: this.combo });
    if (perfect) this.director.event('catch');
  }
  bell() { this.bells++; if (this.bells >= 10) this.unlock('bell'); }
}
