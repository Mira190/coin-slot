// App shell: boot, menus, settings, pause, the fixed-step loop and the __debug hook used by tests.
import * as THREE from 'three';
import { createRenderer } from './render.js';
import { buildWorld } from './world.js';
import { CollisionWorld } from './physics.js';
import { NavGraph } from './nav.js';
import { boxes, zoneAt } from './mapdata.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { ViewModel } from './viewmodel.js';
import { Input } from './input.js';
import { Hud, drawWeaponIcon } from './hud.js';
import { Game, MODES } from './game.js';
import { updatePlayer } from './player.js';
import { WEAPONS, PRIMARIES } from './weapons.js';
import { curWeapon, tryFire, eyePos } from './combat.js';
import { Brain } from './bots.js';

const $ = (id) => document.getElementById(id);
const setLoad = (p, t) => { $('loadbar').style.width = (p * 100) + '%'; if (t) $('loadtxt').textContent = t; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const Arc = window.Arcade || { best: () => 0, saveBest: () => false };

// ------------------------------------------------------------------------------------------------ settings
const SKEY = 'cargo-deck-settings';
const DEF = { sens: 1, adsSens: 0.9, fov: 78, master: 0.8, music: 0.45, sfx: 0.9, quality: 'auto', xh: '#7dffb4', invert: false, fps: false, primary: 'r4', mode: 'tdm', diff: 1 };
let S = { ...DEF };
try { S = { ...DEF, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch (e) { /* private mode */ }
const saveS = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

async function boot() {
  setLoad(0.05, 'Starting renderer');
  await tick();
  const R = createRenderer($('app'));
  setLoad(0.2, 'Painting containers and steel');
  await tick();
  const W = buildWorld(R.scene, { quality: S.quality === 'high' ? 2 : 1, renderer: R.renderer });
  R.world = W;
  setLoad(0.6, 'Charting the deck');
  await tick();
  const coll = new CollisionWorld(boxes);
  const nav = new NavGraph(coll).build();
  setLoad(0.75, 'Rigging soldiers');
  await tick();
  const audio = new Audio();
  audio.vol = { master: S.master, music: S.music, sfx: S.sfx };
  const fx = new Effects(R, coll, audio);
  const vm = new ViewModel(R);
  const input = new Input(R.renderer.domElement);
  const hud = new Hud();
  hud.xhColor = S.xh; hud.showFps = S.fps;
  const game = new Game({ R, W, coll, nav, fx, audio, hud, vm, input, settings: S });
  game.baseFov = S.fov;
  R.applyQuality(S.quality === 'auto' ? 'medium' : S.quality);
  // warm up shaders so the first fight doesn't hitch
  setLoad(0.9, 'Compiling shaders');
  await tick();
  try { R.renderer.compile(R.scene, R.camera); R.renderer.compile(R.vmScene, R.vmCamera); } catch (e) { /* optional */ }
  setLoad(1, 'Ready');
  $('loading').hidden = true;
  const showBack = () => { $('back').hidden = !location.pathname.includes('/games/'); };
  const hideBack = () => { $('back').hidden = true; };

  // ---------------------------------------------------------------------------------------------- menus
  const menu = $('menu'), pause = $('pause'), settings = $('settings'), end = $('end');
  let paused = false, boardHeld = false;
  function setPressed(seg, v) { seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }
  function seg(id, key, cb) {
    const el = $(id);
    setPressed(el, S[key]);
    el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S[key] = isNaN(+b.dataset.v) || b.dataset.v.startsWith('#') ? b.dataset.v : +b.dataset.v; setPressed(el, S[key]); saveS(); audio.ui('click'); cb && cb(); });
  }
  seg('modeSeg', 'mode', () => { $('modeDesc').textContent = MODES[S.mode].desc; });
  $('modeDesc').textContent = MODES[S.mode].desc;
  seg('diffSeg', 'diff');
  seg('qualSeg', 'quality', () => R.applyQuality(S.quality === 'auto' ? 'medium' : S.quality));
  seg('xhSeg', 'xh', () => { hud.xhColor = S.xh; });
  // loadout cards with drawn weapon silhouettes
  const lo = $('loadout');
  function loadoutCards(host, onPick, sel, keys = false) {
    host.innerHTML = '';
    for (const [i, id] of PRIMARIES.entries()) {
      const d = WEAPONS[id], b = document.createElement('button');
      b.className = 'opt'; b.type = 'button'; b.setAttribute('aria-pressed', String(sel === id));
      const c = document.createElement('canvas'); c.width = 240; c.height = 76; drawWeaponIcon(c, id, '#dfe6f0');
      const n = document.createElement('b'); n.textContent = (keys ? (i + 1) + ' · ' : '') + d.name;
      const s = document.createElement('span'); s.textContent = d.desc;
      b.append(c, n, s);
      b.addEventListener('click', () => { onPick(id); host.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); audio.ui('click'); });
      host.appendChild(b);
    }
  }
  loadoutCards(lo, (id) => { S.primary = id; saveS(); }, S.primary);
  // settings form
  const sliders = [['s_sens', 'sens', (v) => v.toFixed(2)], ['s_adss', 'adsSens', (v) => v.toFixed(2)], ['s_fov', 'fov', (v) => v + '°'], ['s_vol', 'master', (v) => Math.round(v * 100)], ['s_mus', 'music', (v) => Math.round(v * 100)], ['s_sfx', 'sfx', (v) => Math.round(v * 100)]];
  for (const [id, key, fmt] of sliders) {
    const el = $(id), out = el.nextElementSibling;
    el.value = S[key]; out.textContent = fmt(+S[key]);
    el.addEventListener('input', () => {
      S[key] = +el.value; out.textContent = fmt(S[key]); saveS();
      audio.vol = { master: S.master, music: S.music, sfx: S.sfx }; audio.applyVolume();
      game.baseFov = S.fov;
    });
  }
  $('s_inv').checked = S.invert; $('s_inv').addEventListener('change', (e) => { S.invert = e.target.checked; saveS(); });
  $('s_fpsc').checked = S.fps; $('s_fpsc').addEventListener('change', (e) => { S.fps = e.target.checked; hud.showFps = S.fps; saveS(); });
  const settingsCard = settings.querySelector('.card');
  function openSettings(from) {
    settings.hidden = false; settings.dataset.from = from;
    if (from === 'pause') { $('settingsHost').appendChild(settingsCard); settings.hidden = true; }
  }
  $('openSettings').addEventListener('click', () => { audio.init(); menu.hidden = true; openSettings('menu'); });
  $('closeSettings').addEventListener('click', () => {
    audio.ui('click');
    if (settingsCard.parentElement !== settings) { settings.appendChild(settingsCard); pause.hidden = true; resume(); return; }
    settings.hidden = true; if (settings.dataset.from === 'menu') menu.hidden = false;
  });
  document.querySelectorAll('.btn,.opt,.seg button').forEach((b) => b.addEventListener('mouseenter', () => audio.ui('hover', 0.5)));
  if (input.touch) { $('touchNote').hidden = false; }
  const bestTxt = () => { const b = Arc.best(); return b ? `Best score ${b}` : ''; };
  $('best1').textContent = bestTxt();

  function startMatch() {
    audio.init().then(() => audio.startMusic('match'));
    menu.hidden = true; end.hidden = true; settings.hidden = true; pause.hidden = true;
    hideBack();
    game.newMatch({ mode: S.mode, primary: S.primary, difficulty: S.diff });
    input.enabled = true;
    $('touch').hidden = !input.touch;
    input.requestLock();
    paused = false;
  }
  $('start').addEventListener('click', startMatch);
  $('again').addEventListener('click', startMatch);
  $('toMenu').addEventListener('click', () => { end.hidden = true; menu.hidden = false; showBack(); audio.ui('click'); });
  $('resume').addEventListener('click', () => resume());
  $('quit').addEventListener('click', () => {
    pause.hidden = true; paused = false; game.abort(); $('hud').hidden = true; $('dead').hidden = true; $('touch').hidden = true; $('board').hidden = true;
    if (settingsCard.parentElement !== settings) settings.appendChild(settingsCard);
    menu.hidden = false; showBack(); audio.setMusic('menu'); input.enabled = false;
  });
  function doPause() {
    if (game.state !== 'play' || paused) return;
    paused = true; pause.hidden = false;
    $('settingsHost').appendChild(settingsCard);
    showBack(); audio.setMusic('off');
  }
  function resume() {
    if (settingsCard.parentElement !== settings) settings.appendChild(settingsCard);
    pause.hidden = true; paused = false; hideBack(); audio.setMusic(game.tense ? 'tense' : 'match');
    input.requestLock();
  }
  input.onUnlock = () => { if (game.state === 'play' && !input.touch) doPause(); };
  addEventListener('blur', () => { if (game.state === 'play') doPause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'play') doPause(); });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && game.state === 'play' && input.touch) doPause();
    if (e.code === 'Tab') { e.preventDefault(); if (game.state === 'play') { boardHeld = true; hud.showBoard(true); } }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Tab') { boardHeld = false; hud.showBoard(false); } });
  // touch pause / board buttons
  document.querySelector('#touch .tpause').addEventListener('touchstart', () => doPause());
  document.querySelector('#touch .tboard').addEventListener('touchstart', () => hud.showBoard($('board').hidden));
  // death panel: pick the loadout for the next life
  const deadLo = document.createElement('div'); deadLo.className = 'lo';
  $('dead').appendChild(deadLo);
  let deadShown = false;
  const pickNext = (id) => {
    const P = game.player; P.pendingPrimary = id; S.primary = id; saveS();
    deadLo.querySelectorAll('.opt').forEach((o, i) => o.setAttribute('aria-pressed', String(PRIMARIES[i] === id)));
    audio.ui('click');
  };
  game.onPickNext = pickNext;
  // end screen
  hud.onEnd = (g) => {
    $('hud').hidden = true; $('dead').hidden = true; $('board').hidden = true; $('touch').hidden = true;
    input.exitLock(); input.enabled = false;
    const P = g.player, r = g.result;
    $('result').textContent = r.draw ? 'Draw' : r.win ? 'Victory' : 'Defeat';
    $('result').className = 'big ' + (r.win ? 'win' : 'lose');
    $('endline').textContent = g.mode.id === 'tdm' ? `${g.scores[0]} – ${g.scores[1]} · team deathmatch` : `${g.roundWins[0]} – ${g.roundWins[1]} rounds · elimination`;
    const acc = P.stats.shots ? Math.round(100 * P.stats.hits / P.stats.shots) : 0;
    $('endstats').innerHTML = `<div><b>${P.stats.k}</b><span>Kills</span></div><div><b>${P.stats.d}</b><span>Deaths</span></div><div><b>${P.stats.hs}</b><span>Headshots</span></div><div><b>${acc}%</b><span>Accuracy</span></div>`;
    $('endboard').innerHTML = hud.boardHTML();
    const score = P.stats.k * 100 + P.stats.hs * 50 + (r.win ? 1000 : 0);
    const rec = Arc.saveBest(score);
    $('myscore').textContent = `Score ${score}${rec ? ' · new best!' : ''}`;
    $('best2').textContent = bestTxt(); $('best1').textContent = bestTxt();
    end.hidden = false; showBack();
    game.lastScore = score;
  };

  // ---------------------------------------------------------------------------------------------- loop
  const STEP = 1 / 60;
  let camHold = null;
  let acc = 0, last = performance.now(), t = 0;
  const cam = R.camera;
  const fwd = new THREE.Vector3(), up = new THREE.Vector3();
  let view = { scoped: false, fov: S.fov, zone: '' };
  function simulate(dt) {
    view = { ...view, ...updatePlayer(game, input, dt, S) };
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) { game.step(STEP); acc -= STEP; n++; }
    if (n === 5) acc = 0;
  }
  function present(dt, draw = true) {
    t += dt;
    const P = game.player;
    const playing = game.state === 'play';
    let camHeld = false;
    if (camHold) { cam.position.set(...camHold.p); cam.lookAt(...camHold.t); cam.fov = camHold.fov; cam.updateProjectionMatrix(); camHeld = true; }
    else if (P && (playing || game.state === 'end')) game.updateCamera(dt, R);
    else { // menu flyover
      const a = t * 0.05;
      cam.position.set(Math.cos(a) * 26 - 4, 9 + Math.sin(t * 0.2) * 1.5, Math.sin(a) * 12 - 2);
      cam.lookAt(0, 1.5, 0);
      if (Math.abs(cam.fov - S.fov) > 0.01) { cam.fov = S.fov; cam.updateProjectionMatrix(); }
    }
    // field of view: ADS zoom / scope
    const w = P && curWeapon(P);
    const ads = P && P.alive ? P.ads : 0;
    const e = ads * ads * (3 - 2 * ads);
    // portrait screens: widen the vertical FOV so the horizontal view stays playable
    const aspect = innerWidth / innerHeight;
    const effFov = (f) => aspect >= 1.2 ? f : Math.min(112, Math.max(f, 2 * Math.atan(Math.tan(Math.min(100, 2 * Math.atan(Math.tan(f * Math.PI / 360) * 1.6) * 180 / Math.PI) * Math.PI / 360) / aspect) * 180 / Math.PI));
    const baseF = effFov(S.fov);
    let fov = baseF;
    if (w && P.alive && !P.nadeSel) {
      const z = w.def.ads.fov;
      fov = baseF * (1 + (z - 1) * e);
      view.scoped = w.def.ads.sight === 'scope' && ads > 0.9;
      if (view.scoped) fov = baseF * z;
    } else view.scoped = false;
    if (!(P && !P.alive && game.deathCam) && !camHeld) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 25); cam.updateProjectionMatrix(); }
    game.baseFov = baseF;
    R.showVM = !!(P && P.alive && playing && !view.scoped && !camHeld);
    R.vmCamera.fov = effFov(54) - e * 4; R.vmCamera.updateProjectionMatrix();
    if (P && playing) {
      vm.update(dt, { ads, speed: Math.hypot(P.vel.x, P.vel.z), onGround: P.onGround, crouch: P.crouching, lookDX: game.lookDelta ? game.lookDelta.dx : 0, lookDY: game.lookDelta ? game.lookDelta.dy : 0, hidden: !P.alive, empty: w && w.mag === 0 });
      // viewmodel lighting follows where you stand (dark in the pipe / cabins)
      const z = zoneAt(P.pos.x, P.pos.y + 0.5, P.pos.z);
      view.zone = z;
      const inside = /Pipe$|Cabin|Bridge/.test(z) && !/Exit/.test(z);
      const tl = inside ? 0.25 : 1;
      R.vmSun.intensity += (2.2 * tl - R.vmSun.intensity) * Math.min(1, dt * 4);
      R.vmHemi.intensity += (0.6 * (inside ? 0.45 : 1) - R.vmHemi.intensity) * Math.min(1, dt * 4);
      R.vmScene.environmentIntensity += ((inside ? 0.25 : 0.8) - R.vmScene.environmentIntensity) * Math.min(1, dt * 4);
      audio.setEnv(/Pipe$/.test(z) ? 'pipe' : /Cabin|Bridge/.test(z) ? 'cabin' : 'deck');
      // death panel loadout picker (TDM)
      if (!P.alive && game.mode.id === 'tdm' && !deadShown) { deadShown = true; loadoutCards(deadLo, pickNext, P.pendingPrimary || P.primary, true); }
      if (P.alive) deadShown = false;
      deadLo.hidden = !( !P.alive && game.mode.id === 'tdm');
    }
    W.update(t, cam);
    fx.update(dt, cam);
    cam.getWorldDirection(fwd); up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.listen(cam.position, fwd, up);
    if (game.state === 'play' && P) hud.update(game, dt, { ...view, fov: cam.fov, cam });
    R.sky.material.uniforms.uTime.value = t;
    if (!draw) return;
    R.render();
    R.adapt(dt, S.quality === 'auto' && playing);
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (game.state === 'play' && !paused) simulate(dt);
    else { if (game.state !== 'play') game.step(dt); input.consumeLook(); input.consume(); }
    present(paused ? 0 : dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  menu.hidden = false; showBack();
  // first user gesture starts audio + menu music
  const firstGesture = () => { audio.init().then(() => audio.startMusic(game.state === 'play' ? 'match' : 'menu')); removeEventListener('pointerdown', firstGesture); removeEventListener('keydown', firstGesture); };
  addEventListener('pointerdown', firstGesture); addEventListener('keydown', firstGesture);

  // ---------------------------------------------------------------------------------------------- debug / test hook
  window.__W = WEAPONS;
  window.__debug = {
    R, W, coll, nav, fx, vm, audio, hud, game,
    get G() { return game; },
    get P() { return game.player; },
    get bots() { return game.actors.filter((a) => a.isBot); },
    start(opts = {}) { Object.assign(S, opts); startMatch(); return game.state; },
    // advance the simulation n fixed steps (and draw once)
    step(n = 1) { for (let i = 0; i < n; i++) game.step(STEP); present(0.016); return game.state; },
    aim(yaw, pitch = 0) { const P = game.player; P.yaw = yaw; P.pitch = pitch; P.recoil.p = P.recoil.y = 0; },
    fire() { return tryFire(game, game.player); },
    view(x, y, z, yaw, pitch = 0) { cam.position.set(x, y, z); cam.rotation.set(pitch, yaw, 0, 'YXZ'); R.render(); },
    quality(q) { S.quality = q; R.applyQuality(q === 'auto' ? 'medium' : q); },
    god(on = true) { game.player.spawnProt = on ? 1e9 : 0; },
    render() { present(0.016); },
    // run the whole frame loop (input, sim, viewmodel, hud) for `sec` seconds at 60 Hz, draw once at the end
    advance(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (game.state === 'play') simulate(STEP); else game.step(STEP); present(STEP, i === n - 1); } return game.state; },
    // inspect the viewmodel from another angle: vmCam([x,y,z],[tx,ty,tz]) / vmCam(null) to restore
    vmCam(p, t) { const c = R.vmCamera; if (!p) { c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); } else { c.position.set(...p); c.lookAt(...t); } R.render(); },
    camHold(p, t, fov = 50) { camHold = p ? { p, t, fov } : null; present(0); },
    autopilot(on = true, role = 'rush') { const P = game.player; P.brain = on ? new Brain(game, P, role, 1) : null; P.isBot = on; },
    hold(o) { input.debugAds = !!o.ads; input.debugFire = !!o.fire; },
    press(code) { input.pressed.add(code); },
    key(code, down) { if (down) { input.keys.add(code); input.pressed.add(code); } else input.keys.delete(code); },
    place(x, y, z, yaw, pitch = 0) { const P = game.player; P.pos.set(x, y, z); P.vel.set(0, 0, 0); P.yaw = yaw; P.pitch = pitch; P.onGround = true; },
    pause: () => doPause(), resume: () => resume(),
  };
}
boot().catch((e) => { console.error(e); $('loadtxt').textContent = 'Error: ' + e.message; });
