// Twin Gate: bootstrap, game states and menus, the fixed-step simulation, the gate device, and the debug hook.
import * as THREE from 'three';
import { G, initGfx, resize, adaptQuality, fitSun, setQualityLevel, setOutdoor, LAYER_AVATAR } from './gfx.js';
import { phys, STEP } from './physics.js';
import { world, rayBox } from './world.js';
import { gates, linked, initPortals, resizeTargets, placeGate, closeGate, resetGates, fitGate, gateUp, castThrough, updateGates, renderGateViews, beforeStep, afterStep, on as gateOn, stats as gateStats, xfMatrix, COLORS } from './portals.js';
import { player, spawnPlayer, playerPreStep, playerPostStep, playerView, CENTER_H } from './player.js';
import { props, clearProps, updateProps, propsPostStep, hold, holdStep, tryPickup, release, propTargets, buildAvatar, updateAvatar, hooks as propHooks, rayProp } from './props.js';
import { buildEnts, clearEnts, mechStep, mechFrame, useEntity, rayTargets, ev, sig, registerBuilder, root, ents } from './mech.js';
import { beamsFrame, clearBeams, lasers, bridges, laserHits } from './beams.js';
import { gelStep, gelFrame, clearGel } from './gel.js';
import { initEffects, fx, updateEffects, clearEffects } from './effects.js';
import { initAudio, sfx, loop, stopLoops, setListener, setMute, setVolume, setMusicVolume, audio, suspend } from './audio.js';
import { buildViewmodel, updateViewmodel, vmFire, vmNope, vmMode } from './viewmodel.js';
import * as hud from './hud.js';
import { tally, line } from './narrator.js';
import { save, persist, record, completedCount } from './save.js';
import { input, bindInput, bindTouch, lockPointer, unlockPointer, moveAxes } from './input.js';
import { makeBot } from './bot.js';
import { CHAMBERS, botSteps } from './levels.js';
import { signTexture } from './textures.js';

const canvas = document.getElementById('gl');
const $ = (s) => document.querySelector(s);
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const TRIALS = CHAMBERS.filter((c) => !c.escape).length;
const S = {
  mode: 'boot', idx: 0, L: null, t: 0, acc: 0, alpha: 0, manual: false, gun: 2,
  time: 0, shots: 0, clock: false, teleports: 0, bot: null, demo: false, deadT: 0, doneT: 0, saidSig: new Set(),
  sens: 1, fov: 78, invert: 0, bob: 1, failSaid: 0, hurtT: 0, idleT: 0, startT: 0, menuYaw: 0, pending: [null, null],
};

// ---------------------------------------------------------------- setup
function init() {
  initGfx(canvas);
  setQualityLevel(2);
  resize(); initPortals(); initEffects(); buildAvatar(); buildViewmodel();
  addEventListener('resize', () => { resize(); resizeTargets(); });
  G.scene.matrixWorldAutoUpdate = false;
  bindInput(canvas);
  wireHooks(); wireMenus();
  Object.assign(input.act, {
    fire: (i) => { if (S.mode === 'play' && !S.bot) fire(i); },
    use: () => { if (S.mode === 'play' && !S.bot) use(); },
    jump: () => { if (S.mode === 'play' && !S.bot) player.keys.jump = true; },
    restart: () => { if (S.mode === 'play' && !S.bot) { tally('restart', null, { now: true }); loadChamber(S.idx); } },
    pause: () => { if (S.mode === 'play') pause(); else if (S.mode === 'pause') resume(); },
    mute: () => toggleMute(),
    confirm: () => { if (S.mode === 'done' && !$('#d-next').hidden) next(); },
    unlock: (blur) => { if (S.mode === 'play' && !S.bot && !input.touch) pause(); if (blur && S.mode === 'play' && input.touch) pause(); },
  });
  canvas.addEventListener('click', () => { initAudio(); if (S.mode === 'play' && !input.locked && !S.bot) lockPointer(canvas); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (S.mode === 'play' && !S.bot) pause(); suspend(true); } else suspend(false); });
  setMute(save.settings.muted); updateMuteBtn();
  hud.bindSettings(applySettings);
  // title backdrop: the first trial's room, its two gates in view, slowly panning
  loadChamber(0, { quiet: true });
  menuPose();
  S.mode = 'menu';
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches;
  hud.showMenu(coarse ? 'notice' : 'menu'); refreshMenu();
  hud.fade(false);
  requestAnimationFrame(frame);
}

function applySettings(s) {
  S.sens = s.sens; S.fov = s.fov; S.invert = s.invert; S.bob = s.bob;
  setVolume(s.vol); setMusicVolume(s.music);
  if (s.quality === 'auto') G.q.auto = true; else { G.q.auto = false; setQualityLevel(+s.quality); resizeTargets(); }
}
function toggleMute() { save.settings.muted = !save.settings.muted; persist(); setMute(save.settings.muted); updateMuteBtn(); }
function updateMuteBtn() { const b = $('#mute'); b.textContent = save.settings.muted ? 'SOUND OFF' : 'SOUND ON'; b.setAttribute('aria-pressed', String(save.settings.muted)); }

// ---------------------------------------------------------------- chambers
registerBuilder('sign', (e) => {
  const n = S.idx + 1, L = S.L, tex = signTexture(L.escape ? 'X' : n, TRIALS, L.name, L.icons);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }));
  m.position.copy(V3(e.p)); m.lookAt(m.position.clone().add(V3(e.face))); root.group.add(m);
  return { e, update() {} };
});

function loadChamber(i, opts = {}) {
  S.idx = i; const L = CHAMBERS[i]; S.L = L;
  release(); clearProps(); resetGates(); clearBeams(); clearGel(); clearEnts(); clearEffects(); stopLoops('');
  hud.clearCaptions();
  world.build(L);
  setOutdoor(!!L.sky);
  fitSun(world.bounds.min, world.bounds.max);
  buildEnts(L);
  for (const g of L.gates || []) { const n = V3(g.n); placeGate(g.i, V3(g.c), n, g.up ? V3(g.up) : gateUp(n, new THREE.Vector3(0, 0, -1)), { fixed: true, instant: true }); }
  spawnPlayer(L.spawn.p, (L.spawn.yaw || 0) * Math.PI / 180);
  S.gun = L.gun ?? 2; vmMode(S.gun);
  S.pending = [null, null];
  if (!L.escape || (L.part === 1 && !opts.keepEscape)) { S.escapeT0 = 0; S.escapeShots = 0; } // escape time adds up across its parts
  S.time = 0; S.shots = 0; S.acc = 0; S.clock = false; S.deadT = 0; S.doneT = 0; S.after = null; S.teleports = 0; S.saidSig.clear(); S.failSaid = 0; S.idleT = 0; S.startT = 0;
  player.health = 100; hud.vignette(0);
  audio.mode = L.escape ? 'tense' : 'calm';
  if (S.demo) S.bot = makeBot(botSteps(L), botApi); else S.bot = null;
  if (!opts.quiet) {
    S.mode = 'play'; G.vmScene.visible = true;
    hud.showHUD(true); hud.trialTag(L.escape ? 'UNSCHEDULED · ' + L.name.toUpperCase() : `TRIAL ${String(i + 1).padStart(2, '0')} · ${L.name.toUpperCase()}`);
    if (!L.escape || L.part === 1) hud.card(L.escape ? 'X' : i + 1, TRIALS, L.name, L.icons);
    tally('start', L, { delay: 1.2 });
    save.last = i; persist();
  }
  hud.setGates(false, false, S.gun);
}

function startChamber(i, demo = false) {
  initAudio();
  S.demo = demo;
  hud.hideMenus(); hud.fade(true);
  setTimeout(() => { loadChamber(i); hud.fade(false); if (!demo) lockPointer(canvas); }, 350);
}
function next() {
  const n = S.idx + 1;
  if (n >= CHAMBERS.length) { toMenu(); return; }
  startChamber(n, S.demo);
}
function toMenu() {
  S.mode = 'menu'; S.demo = false; S.bot = null; hud.showHUD(false); unlockPointer();
  loadChamber(0, { quiet: true }); menuPose(); S.mode = 'menu';
  hud.showMenu('menu'); refreshMenu(); $('#credits').hidden = true;
}
function menuPose() {
  const b = player.body; b.position.set(3.2, 0.9, 3.4); b.velocity.set(0, 0, 0);
  player.prev.set(3.2, 0.9, 3.4); player.cur.copy(player.prev);
  player.yaw = 0.62; player.pitch = -0.04; player.residual.identity();
  G.vmScene.visible = false; S.menuYaw = 0;
}
function pause() { if (S.mode !== 'play') return; S.mode = 'pause'; unlockPointer(); $('#pause-sub').textContent = S.L.name; hud.showMenu('pause'); }
function resume() { hud.hideMenus(); S.mode = 'play'; if (!S.demo) lockPointer(canvas); }
function refreshMenu() {
  const n = completedCount(), nextIdx = CHAMBERS.findIndex((c) => !(c.part > 1) && !save.done[c.id]);
  const idx = nextIdx < 0 ? 0 : nextIdx;
  $('#b-continue').firstChild.textContent = n ? 'Continue ' : 'Begin testing ';
  $('#b-continue-sub').textContent = nextIdx < 0 ? 'all trials complete' : `trial ${idx + 1}: ${CHAMBERS[idx].name}`;
  $('#b-trials-sub').textContent = `${n} / ${CHAMBERS.filter((c) => !(c.part > 1)).length} complete`;
  S.contIdx = idx;
}

function wireMenus() {
  $('#b-continue').onclick = () => startChamber(S.contIdx || 0);
  $('#b-trials').onclick = () => { hud.buildSelect(CHAMBERS, (i) => startChamber(i)); hud.showMenu('select'); };
  $('#b-settings').onclick = () => hud.showMenu('settings');
  $('#b-demo').onclick = () => startChamber(S.contIdx && S.contIdx < CHAMBERS.length ? S.contIdx : 0, true);
  $('#p-resume').onclick = () => resume();
  $('#p-restart').onclick = () => { hud.hideMenus(); loadChamber(S.idx); if (!S.demo) lockPointer(canvas); };
  $('#p-trials').onclick = () => { hud.buildSelect(CHAMBERS, (i) => startChamber(i)); hud.showMenu('select'); };
  $('#p-settings').onclick = () => hud.showMenu('settings');
  $('#p-menu').onclick = () => toMenu();
  $('#d-next').onclick = () => next();
  $('#d-retry').onclick = () => startChamber(S.idx);
  $('#d-trials').onclick = () => { hud.buildSelect(CHAMBERS, (i) => startChamber(i)); hud.showMenu('select'); };
  $('#n-demo').onclick = () => startChamber(0, true);
  $('#n-touch').onclick = () => { bindTouch($('#touch')); startChamber(S.contIdx || 0); };
  $('#mute').onclick = () => { initAudio(); toggleMute(); };
  for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => { const p = hud.menuBack(); if (!p) { if (S.mode === 'pause') hud.showMenu('pause'); else if (S.mode === 'done') hud.showMenu('done'); else hud.showMenu('menu'); } };
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && S.demo && S.mode === 'play') toMenu(); });
  canvas.addEventListener('mousedown', () => { if (S.demo && S.mode === 'play') toMenu(); });
}

// ---------------------------------------------------------------- hooks: gates, props, mechanisms -> sound/fx/captions
function wireHooks() {
  gateOn.open = (g) => { fx('gateOpen', g.c, g.n, { ...g, color: COLORS[g.i].getHex() }); sfx('open', g.c, { i: g.i }); };
  gateOn.close = (g, moved) => { fx('gateClose', g.c, g.n, { ...g, color: COLORS[g.i].getHex() }); sfx('close', g.c); };
  gateOn.fail = (p, n, i) => { if (p) fx('fail', p, n, COLORS[i].getHex()); sfx('fail', p); vmNope(); if (S.failSaid++ === 0) tally('fail', S.L); };
  gateOn.teleport = (t, i) => {
    if (t.isPlayer) { S.teleports++; sfx('teleport'); } else sfx('teleport', t.body.position, { vol: 0.5 });
  };
  propHooks.pickup = (pr) => sfx('pickup', pr.body.position);
  propHooks.drop = (pr, thrown) => sfx(thrown ? 'throw' : 'drop', pr.body.position);
  propHooks.impact = (pr, v) => sfx('impact', pr.body.position, { v });
  propHooks.fizzle = (pr) => { fx('fizzle', new THREE.Vector3().copy(pr.body.position)); sfx('fizzle', pr.body.position); if (!S.fizzleSaid) { S.fizzleSaid = 1; tally('fizzleBlock', S.L, { delay: 0.5 }); } };
  ev.say = (k, now) => tally(k, S.L, now ? { now: true } : undefined);
  ev.sfx = (n, p) => sfx(n, p);
  ev.fx = (k, p, n, x) => fx(k, p, n, x);
  ev.die = (kind) => die(kind);
  ev.goal = () => complete();
  ev.checkpoint = (c) => { S.checkpoint = c; };
  ev.burn = (dt, dir) => {
    if (!player.alive) return;
    player.health -= 70 * dt; S.hurtT = 1.0;
    if (dir) { const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize(); const pb = player.body.position; const pv = player.body.velocity; pv.x += side.x * 40 * dt * Math.sign(side.x * pv.x + side.z * pv.z || 1); pv.z += side.z * 40 * dt * Math.sign(side.x * pv.x + side.z * pv.z || 1); }
    if (Math.random() < 0.3) sfx('burn');
    if (!S.burnSaid) { S.burnSaid = 1; tally('burn', S.L); }
    if (player.health <= 0) die('laser');
  };
  player.onFootstep = (v) => { const m = player.groundBody && player.groundBody.box && player.groundBody.box.s === 'M'; sfx('step', null, { metal: m, vol: Math.min(1, v / 4.6) }); };
  player.onLand = (v) => { sfx('land', null, { v }); if (v > 6) fx('land', new THREE.Vector3(player.body.position.x, player.body.position.y - CENTER_H, player.body.position.z)); };
  player.onJump = () => sfx('jump');
  hud.hud.onCaption = (t) => sfx('blip', null, { len: t.length });
}

function die(kind) {
  if (!player.alive || S.mode !== 'play') return;
  player.alive = false; S.deadT = 1.4; release();
  sfx('die'); hud.vignette(1);
  tally(kind === 'acid' ? 'acid' : kind === 'laser' ? 'laser' : 'die', null, { now: true, delay: 0.3 });
}
function complete() {
  if (S.mode !== 'play' || S.doneT) return;
  S.doneT = 0.001; S.clock = false;
  const L = S.L;
  // follow-ups run on the simulation clock (S.after, counted down in step): pausing delays them instead of losing them
  if (L.escape && L.next) { S.escapeT0 += S.time; S.escapeShots += S.shots; hud.fade(true); S.after = { t: 0.6, fn: () => { loadChamber(S.idx + 1); hud.fade(false); } }; return; }
  const rid = L.recordAs || L.id; // the escape's record lives on its first part
  const flags = S.demo ? { first: !save.done[rid] } : record(rid, S.escapeT0 !== undefined && L.escape ? S.time + S.escapeT0 : S.time, S.shots + (L.escape ? S.escapeShots || 0 : 0));
  if (!S.demo) { try { window.Arcade && Arcade.saveBest(completedCount()); } catch (e) { /* lobby helper missing */ } }
  sfx('complete');
  tally('done', L, L.escape ? { now: true } : undefined); // the sign-off on the roof cuts in over any queued lines
  if (L.escape) { S.after = { t: 8, fn: credits }; return; } // time on the roof while TALLY signs off
  if (S.demo) { S.after = { t: 2.6, fn: next }; return; }
  S.after = { t: 1.5, fn: () => {
    S.mode = 'done'; unlockPointer();
    hud.fillDone(L, S.idx, CHAMBERS.filter((c) => !(c.part > 1)).length, S.time, S.shots, flags, line(flags.newTime && !flags.first ? 'record' : 'quips'), S.idx + 1 < CHAMBERS.length);
    hud.showMenu('done');
  } };
}
function credits() {
  S.mode = 'credits'; unlockPointer(); hud.showHUD(false);
  hud.rollCredits(CREDITS, () => toMenu());
}
const CREDITS = `<h3>双门 TWIN GATE</h3><p>An original game for Coin Slot Arcade.</p>
<h3>EVALUATION</h3><p>TALLY, evaluation system<br>Hinge Laboratories (defunct, as of now)</p>
<h3>THANKS</h3><p>The Weighted Test Blocks, all of them<br>The light panels, for their patience<br>You, for leaving</p>
<h3>TALLY'S FINAL NOTE</h3><p>"Candidate departed without completing the exit survey.<br>Recommendation: none. Status: outside.<br>I will keep the light on. It is on a timer anyway."</p>
<h3>MADE WITH</h3><p>three.js · cannon-es · WebAudio<br>every texture, sound and line generated in code</p><p style="margin-top:40px;opacity:.6">click to return</p>`;

// ---------------------------------------------------------------- the device
const _dir = new THREE.Vector3(), _mz = new THREE.Vector3();
function eye() { return playerView(S.alpha, 0, false); }
function fire(i) {
  if (S.mode !== 'play' || !player.alive) return false;
  if (hold.prop) { if (i === 0) { const v = eye(); release(_dir.set(0, 0, -1).applyQuaternion(v.quat).clone()); } else release(); return false; }
  if (S.gun === 0 || (S.gun === 1 && i === 1) || gates[i].fixed) { vmNope(); sfx('nope'); return false; }
  const v = eye(); const o = v.pos.clone(), d = _dir.set(0, 0, -1).applyQuaternion(v.quat).clone();
  vmFire(i); sfx('fire', null, { i });
  const ok = shoot(i, o, d, v.quat);
  if (ok) S.shots++;
  return ok;
}
// Gate shot: instant ray, through linked gates; grids stop it; props and bridges don't.
function shoot(i, o, d, q) {
  // the other gate's shot still in flight lands now, so this gate's fit keeps clear of it (two quick shots at one
  // spot used to open two overlapping gates)
  const po = S.pending[1 - i]; if (po) { S.pending[1 - i] = null; placeGate(1 - i, po.c, po.n, po.u); }
  const gridT = gridTargets();
  // hops: 0 — a shot that meets a linked gate fizzles there instead of passing through
  const segs = castThrough(o, d, 250, { targets: [...rayTargets(), ...gridT], hops: 0 });
  const last = segs[segs.length - 1], h = last.hit;
  const muzzle = _mz.set(0.22, -0.2, -0.7).applyQuaternion(q || new THREE.Quaternion()).add(o).clone();
  fx('tracer', segs.length > 1 ? muzzle : muzzle, null, { to: segs[0].b, color: COLORS[i].getHex() });
  if (!h || !h.box || h.box.s !== 'W') { gateOn.fail(last.b, h && h.normal, i); return false; }
  const up = gateUp(h.normal, last.b.clone().sub(last.a).normalize());
  const fit = fitGate(i, h.point, h.normal, up);
  if (!fit) { gateOn.fail(h.point, h.normal, i); return false; }
  // the hit is decided now; the gate opens when the shot "arrives" (distance / 57 m/s, at most 0.5 s)
  S.pending[i] = { t: Math.min(0.5, h.t / 57), c: fit.c, n: h.normal.clone(), u: fit.u };
  return true;
}
function pendingStep(dt) {
  for (let i = 0; i < 2; i++) { const p = S.pending[i]; if (!p) continue; p.t -= dt; if (p.t <= 0) { S.pending[i] = null; placeGate(i, p.c, p.n, p.u); } }
}
function gridTargets() {
  return ents.filter((o) => o.type === 'grid' && o.on).map((g) => ({ hit(o, d, m) {
    const c = (g.thin === 'x' ? (g.mn.x + g.mx.x) : (g.mn.z + g.mx.z)) / 2, oa = g.thin === 'x' ? o.x : o.z, da = g.thin === 'x' ? d.x : d.z;
    if (Math.abs(da) < 1e-6) return null; const t = (c - oa) / da; if (t < 0 || t > m) return null;
    const p = o.clone().addScaledVector(d, t); if (!g.inSpan(p, 0)) return null;
    return { t, point: p, normal: new THREE.Vector3(), grid: true };
  } }));
}
function use() {
  if (S.mode !== 'play' || !player.alive) return;
  if (hold.prop) { release(); return; }
  const v = eye(), d = _dir.set(0, 0, -1).applyQuaternion(v.quat).clone();
  if (useEntity(v.pos, d)) return;
  if (!tryPickup(v.pos, d)) sfx('nope');
}

// ---------------------------------------------------------------- simulation
const botApi = {
  eye: () => eye().pos.clone(), fire: (i) => fire(i), use: () => use(), jump: () => { player.keys.jump = true; },
  teleports: () => S.teleports, gate: (i) => gates[i],
  num: (expr) => { try { return +new Function('d', 'S', 'sig', 'player', 'return ' + expr)(window.__debug, S, sig, player); } catch (e) { return NaN; } },
  test: (expr) => { try { return !!new Function('d', 'S', 'sig', 'player', 'return ' + expr)(window.__debug, S, sig, player); } catch (e) { return false; } },
};
function step(dt) {
  if (S.bot) { S.bot.step(dt); Object.assign(player.keys, player.botKeys || { f: 0, b: 0, l: 0, r: 0 }); }
  else Object.assign(player.keys, S.mode === 'play' ? moveAxes() : { f: 0, b: 0, l: 0, r: 0 });
  // the entry door opens after the title card; the clock starts with it
  S.startT += dt; if (S.startT > 1.1 && !sig.get('start')) { sig.set('start', true); S.clock = true; }
  pendingStep(dt);
  beforeStep();
  playerPreStep(dt);
  if (hold.prop) { const v = eye(); holdStep(dt, v.pos, _dir.set(0, 0, -1).applyQuaternion(v.quat), player.yaw + Math.PI); }
  mechStep(dt);
  phys.world.step(dt);
  afterStep();
  playerPostStep(dt);
  propsPostStep();
  mechFrame(dt, S.t);
  beamsFrame(dt, S.t);
  gelStep(dt);
  // lines tied to signals turning on for the first time
  // ('start' is also the entry door's signal; its line is queued by loadChamber, not here)
  for (const [k, v] of sig) if (v && !S.saidSig.has(k)) { S.saidSig.add(k); if (S.L.say[k] && k !== 'start') tally(k, S.L); }
  // health regenerates after a moment out of the beam
  S.hurtT = Math.max(0, S.hurtT - dt); if (S.hurtT <= 0 && player.alive) player.health = Math.min(100, player.health + 40 * dt);
  if (player.alive && player.body.position.y < world.bounds.min.y - 5) die('fall');
  if (S.clock && !S.doneT) S.time += dt;
  if (S.deadT > 0) { S.deadT -= dt; if (S.deadT <= 0) { loadChamber(S.idx); } }
  if (S.after && (S.after.t -= dt) <= 0) { const f = S.after.fn; S.after = null; f(); }
}

function look() {
  if (S.bot) { input.lookX = input.lookY = 0; return; }
  const k = 0.0022 * S.sens;
  player.yaw -= input.lookX * k; player.pitch -= input.lookY * k * (S.invert ? -1 : 1);
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
}

const _cq = new THREE.Quaternion();
function visuals(dt) {
  updateGates(dt, S.t);
  updateProps(dt, S.alpha);
  updateAvatar(S.alpha);
  gelFrame();
  // camera
  const v = playerView(S.alpha, dt, S.bob && S.mode === 'play');
  if (S.mode === 'menu') { S.menuYaw += dt * 0.12; v.quat.premultiply(_cq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(S.menuYaw) * 0.1)); }
  G.camera.position.copy(v.pos); G.camera.quaternion.copy(v.quat);
  if (S.freeCam) { G.camera.position.fromArray(S.freeCam[0]); G.camera.lookAt(...S.freeCam[1]); } // debug close-ups
  const kick = Math.max(0, Math.min(14, (v.speed - 9) * 0.8));
  const fov = S.fov + kick;
  if (Math.abs(G.camera.fov - fov) > 0.01) { G.camera.fov += (fov - G.camera.fov) * Math.min(1, dt * 5); G.camera.updateProjectionMatrix(); }
  G.camera.updateMatrixWorld(true);
  setListener(v.pos, v.quat);
  updateEffects(dt, G.camera);
  // gate motes drifting out of open gates, laser sparks
  for (const g of gates) if (g.open && Math.random() < dt * 14) { const a = Math.random() * 6.283; fx('mote', g.c.clone().addScaledVector(g.r, Math.cos(a) * g.a * 0.95).addScaledVector(g.u, Math.sin(a) * g.b * 0.95), g.n, COLORS[g.i].getHex()); }
  for (const h of laserHits) if (Math.random() < 0.6) fx('spark', h.p, h.n);
  // looping sounds
  lasers.forEach((L, k) => loop('laser' + k, 'laser', L.p, L.on ? 0.55 : 0));
  bridges.forEach((b, k) => loop('bridge' + k, 'bridge', b.p, b.on ? 0.5 : 0));
  loop('wind', 'wind', null, Math.max(0, Math.min(0.5, (v.speed - 8) / 30)));
  // hud
  if (S.mode === 'play' || S.mode === 'pause') {
    hud.setGates(gates[0].open, gates[1].open, S.gun); hud.setHolding(!!hold.prop);
    hud.stats(S.time + (S.L.escape ? S.escapeT0 : 0), S.shots + (S.L.escape ? S.escapeShots : 0));
    hud.vignette(player.alive ? (1 - player.health / 100) * 0.9 : 1);
    hud.speedFx((v.speed - 10) / 14);
    hud.prompt(S.bot ? '' : promptText());
  }
  hud.updateHUD(dt);
  updateViewmodel(dt, input.lookX, input.lookY, player.bobT, player.bobAmt, !!hold.prop, S.t, player.land);
}
let promptCache = { t: 0, txt: '' };
function promptText() {
  const E = input.touch ? 'USE' : 'E'; // name the control the player actually has
  if (hold.prop) return `<kbd>${E}</kbd>drop &nbsp; <kbd>${input.touch ? 'JADE' : 'click'}</kbd>throw`;
  promptCache.t -= 1; if (promptCache.t > 0) return promptCache.txt;
  promptCache.t = 6;
  const v = eye(), d = _dir.set(0, 0, -1).applyQuaternion(v.quat).clone();
  let txt = '';
  for (const pr of props) { if (pr.fizzleT) continue; const h = rayProp(pr, v.pos, d, 2.4); if (h) { txt = `<kbd>${E}</kbd>pick up`; break; } }
  if (!txt) for (const o of ents) if (o.usable && o.rec && rayBox(v.pos, d, o.rec, 2.4)) { txt = `<kbd>${E}</kbd>press`; break; }
  promptCache.txt = txt; return txt;
}

function render() {
  G.scene.updateMatrixWorld();
  G.renderer.shadowMap.needsUpdate = true;
  renderGateViews(G.camera);
  G.composer.render();
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (S.manual) return;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  tick(dt);
  adaptQuality(dt * 1000);
}
function tick(dt) {
  S.t += dt;
  if (S.mode === 'play') {
    look();
    S.acc += dt;
    let n = 0; while (S.acc >= STEP && n < 12) { step(STEP); S.acc -= STEP; n++; }
    if (n === 12) S.acc = 0;
    S.alpha = S.acc / STEP;
  }
  visuals(dt);
  input.lookX = input.lookY = 0;
  render();
}

// ---------------------------------------------------------------- debug hook (verification harness)
window.__debug = {
  S, G, player, gates, props, world, phys, hold, sig, ents, CHAMBERS, THREE, lasers, bridges,
  manual(on = true) { S.manual = on; },
  load(i, demo = false) { S.demo = demo; hud.hideMenus(); loadChamber(i); S.mode = 'play'; },
  // advance the simulation by `sec` of fixed steps (and draw one frame at the end if `draw`)
  step(sec = 1 / 60, draw = true) { const n = Math.max(1, Math.round(sec / STEP)); for (let k = 0; k < n; k++) { S.t += STEP; if (S.mode === 'play') step(STEP); } S.alpha = 0; if (draw) { visuals(sec); render(); } },
  render(dt = 1 / 60) { visuals(dt); render(); },
  // run the chamber's scripted solution; resolves to { ok, time, log }
  solve(i, maxSec = 180) { return this.solveSteps(i, botSteps(CHAMBERS[i]), maxSec); },
  solveSteps(i, steps, maxSec = 180, trace = null) {
    this.load(i); S.bot = makeBot(steps, botApi);
    let sim = 0, k = 0;
    while (sim < maxSec) {
      S.t += STEP; step(STEP); sim += STEP;
      if (trace && k++ % 6 === 0 && S.bot.i >= trace.from) (trace.rows = trace.rows || []).push([S.bot.i, ...this.body().p.map((v) => +v.toFixed(2)), ...this.body().v.map((v) => +v.toFixed(1))].join(' '));
      if (S.doneT) return { ok: true, sim: +sim.toFixed(2), time: +S.time.toFixed(2), shots: S.shots, log: S.bot.log };
      if (S.bot.failed) return { ok: false, sim: +sim.toFixed(2), why: S.bot.failed, log: S.bot.log, pos: this.body().p };
      if (!player.alive && S.deadT > 1.3) return { ok: false, sim, why: 'died', log: S.bot.log, pos: this.body().p };
    }
    return { ok: false, sim, why: 'timeout', log: S.bot.log, pos: this.body().p };
  },
  bot(i) { this.load(i); S.bot = makeBot(botSteps(CHAMBERS[i]), botApi); return S.bot; },
  pose(p, yawDeg = null, pitchDeg = 0) {
    const b = player.body; b.position.set(p[0], p[1] + CENTER_H, p[2]); b.velocity.set(0, 0, 0);
    player.prev.set(b.position.x, b.position.y, b.position.z); player.cur.copy(player.prev);
    if (yawDeg !== null) player.yaw = yawDeg * Math.PI / 180; player.pitch = pitchDeg * Math.PI / 180; player.residual.identity(); player.up.set(0, 1, 0);
  },
  lookAt(x, y, z) { const e = eye().pos; const dx = x - e.x, dy = y - e.y, dz = z - e.z; player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); player.residual.identity(); },
  fire: (i) => fire(i),
  shootAt(i, x, y, z) { this.lookAt(x, y, z); return fire(i); },
  place(i, c, n, up) { const N = V3(n); placeGate(i, V3(c), N, up ? V3(up) : gateUp(N, new THREE.Vector3(0, 0, -1)), { instant: true }); },
  close: (i) => closeGate(i),
  use: () => use(),
  keys(k) { input.keys.clear(); for (const c of k) input.keys.add(c); },
  jump() { player.keys.jump = true; },
  view() { const v = eye(); return { pos: v.pos.toArray(), quat: v.quat.toArray() }; },
  // detached camera for close-ups (also shows the player's avatar); cam(null) restores the eye
  cam(pos, target) { S.freeCam = pos ? [pos, target] : null; G.camera.layers[pos ? 'enable' : 'disable'](LAYER_AVATAR); },
  body() { const b = player.body; return { p: [b.position.x, b.position.y, b.position.z], v: [b.velocity.x, b.velocity.y, b.velocity.z], yaw: player.yaw, pitch: player.pitch, grounded: player.grounded, alive: player.alive }; },
  gateInfo() { return gates.map((g) => ({ open: g.open, c: g.c.toArray(), n: g.n.toArray(), u: g.u.toArray(), depth: g.depth })); },
  xf: (i) => xfMatrix(i).elements.slice(),
  stats: () => ({ ...gateStats, levels: gateStats.levels.slice(), q: { ...G.q }, calls: G.renderer.info.render.calls }),
  signals: () => Object.fromEntries(sig),
  linked,
};

init();
