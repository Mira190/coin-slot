// 风驰 Windrift — boot, state machine (title → setup → intro → race → results), fixed-step loop with render
// interpolation, race-event wiring (popups, sound, effects, camera), records + ghost, and window.__debug.
import * as THREE from 'three';
import { TRACKS } from './tracks.js';
import { buildTrack, F } from './track.js';
import { KARTS, PAINTS, STEP, KMH, ITEMS, MODES } from './data.js';
import { createRace, standings, COUNTDOWN } from './race.js';
import { NOIN, placeOnTrack } from './physics.js';
import { Renderer } from './render.js';
import { buildWorld, updateWorld, setStartLights, buildItemBoxes } from './world.js';
import { THEMES } from './themes.js';
import { KartView } from './kart.js';
import { FX } from './fx.js';
import { CameraRig, CAMS } from './camera.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Garage, Menus, GARAGE_LOOK } from './ui.js';
import { Input } from './input.js';
import { store, fmt, bestLap, bestRace, saveRace, saveLap, GhostRec, saveGhost, loadGhost, ghostAt } from './store.js';

const $ = (id) => document.getElementById(id);
const REDUCED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
const show = (id, on) => { $(id).hidden = !on; };

const G = {
  state: 'boot', sel: Object.assign({ mode: 'speed', track: 0, kart: 0, paint: 0 }, store.json('sel', {})),
  tracks: [], W: null, worldIdx: -1, R: null, views: [], fx: null, t: 0, acc: 0, alpha: 0, introT: 0, finishT: 0,
  shownCount: null, ghost: null, ghostView: null, rec: null, speedFx: 0, frameMs: 16
};
if (!(G.sel.track >= 0 && G.sel.track < TRACKS.length)) G.sel.track = 0;
if (!(G.sel.kart >= 0 && G.sel.kart < KARTS.length)) G.sel.kart = 0;
if (!(G.sel.paint >= 0 && G.sel.paint < PAINTS.length)) G.sel.paint = 0;
if (!MODES[G.sel.mode]) G.sel.mode = 'speed';

G.trackGeo = (i) => G.tracks[i] || (G.tracks[i] = buildTrack(TRACKS[i]));
G.saveSel = () => store.setJSON('sel', G.sel);

// ---- boot ------------------------------------------------------------------------------------------
const canvas = $('c');
G.R3 = new Renderer(canvas);
G.garage = new Garage(G.R3);
G.rig = new CameraRig();
G.rig.mode = Math.max(0, Math.min(3, +store.get('cam', 0) || 0));
G.hud = new HUD();
G.input = new Input();
G.audio = new Audio(store.get('mute') === '1');
G.sfx = (n, o) => G.audio.play(n, o);
const q = store.get('quality');
if (q != null && q !== 'auto') G.R3.setLevel(+q, 'manual');

G.showKart = () => G.garage.showKart(G.sel.kart, PAINTS[G.sel.paint].c);
G.menus = new Menus(G);

function unlockAudio() { G.audio.init(); if (!G.audio.song) G.audio.playSong(G.state === 'race' || G.state === 'intro' ? THEMES[TRACKS[G.sel.track].theme].name : 'menu'); }
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);

// touch controls
[['tL', 'left'], ['tR', 'right'], ['tBrake', 'brake'], ['tDrift', 'drift'], ['tBoost', 'boost'], ['tNitro', 'nitro'], ['tItem2', 'item2']].forEach(([id, n]) => G.input.bindTouch($(id), n));
$('hbPause').onclick = () => G.pause(G.state !== 'paused');
$('hbCam').onclick = () => G.setCam((G.rig.mode + 1) % CAMS.length);
$('hbMute').onclick = () => G.setMute(!G.audio.muted);

// ---- screens -----------------------------------------------------------------------------------------
G.toTitle = () => {
  G.state = 'title'; setRacing(false);
  show('title', true); show('setup', false); show('results', false); show('hud', false); show('touch', false); show('pause', false);
  G.showKart();
  if (G.audio.ctx) G.audio.playSong('menu');
  $('bPlay').focus();
};
G.toSetup = () => {
  G.state = 'setup';
  // quitting a race lands here too, so clear every in-race layer (toTitle does the same)
  show('title', false); show('setup', true); show('results', false); show('hud', false); show('touch', false); show('pause', false);
  G.menus.sync(); G.showKart();
  $('bGo').focus();
};
function setRacing(on) {
  G.input.racing = on;
  show('allGames', !on && location.pathname.includes('/games/'));
}
G.setCam = (i) => { G.rig.mode = i; store.set('cam', i); G.rig.snap(); G.hud.toast(`视角 ${CAMS[i].zh} · ${CAMS[i].en} camera`); };
G.setMute = (m) => { G.audio.setMuted(m); store.set('mute', m ? '1' : '0'); G.hud.toast(m ? '静音 Muted' : '声音 Sound on'); };
G.setQuality = (v) => { store.set('quality', v); if (v === 'auto') { G.R3.auto = true; } else G.R3.setLevel(+v, 'manual'); if (G.W) G.W.sun.shadow.mapSize.set(G.R3.shadowSize, G.R3.shadowSize); if (G.W && G.W.sun.shadow.map) { G.W.sun.shadow.map.dispose(); G.W.sun.shadow.map = null; } };

function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture) u.value.dispose(); m.dispose(); }
  });
  if (scene.environment) scene.environment.dispose();
}

function ensureWorld() {
  const i = G.sel.track;
  if (G.worldIdx === i && G.W) return;
  if (G.W) { disposeScene(G.W.scene); G.W = null; }
  const T = G.trackGeo(i);
  G.W = buildWorld(T, G.R3);
  G.worldIdx = i;
  G.fx = new FX(G.W.scene, G.W.th.name);
  G.fx.setScale(innerHeight * Math.min(2, G.R3.r.getPixelRatio()));
}

function clearRace() {
  for (const v of G.views) v.dispose();
  G.views = [];
  if (G.ghostView) { G.ghostView.dispose(); G.ghostView = null; }
  if (G.fx) G.fx.clear();
  G.R = null;
}

G.startRace = (o = {}) => {
  G.audio.init();
  show('loading', true);
  // let the loading screen paint before the (synchronous) world build
  const go = () => {
    clearRace();
    ensureWorld();
    const T = G.trackGeo(G.sel.track), th = G.W.th;
    const difficulty = { easy: 0.86, normal: 1, hard: 1.07 }[G.sel.diff] || 1;
    const R = G.R = createRace({ T, mode: G.sel.mode, kartIdx: G.sel.kart, paint: G.sel.paint, seed: o.seed || (Date.now() % 99991), laps: o.laps, difficulty });
    buildItemBoxes(G.W, R.items);
    G.views = R.karts.map((k) => new KartView(k, G.W.scene, { night: th.night, tag: !k.isPlayer, helmet: k.isPlayer ? 0xffd21f : 0xffffff }));
    G.pv = G.views[R.karts.indexOf(R.player)];
    // time trial ghost
    G.ghost = G.sel.mode === 'tt' ? loadGhost(T.def.id) : null;
    G.ghostK = null;
    if (G.ghost) ensureGhostView();
    G.rec = new GhostRec();
    G.hud.setup(R, T, bestLap(T.def.id));
    $('tItem2').hidden = G.sel.mode !== 'item';
    $('tNitro').innerHTML = G.sel.mode === 'item' ? '道具1<small>ITEM 1</small>' : '氮气<small>NITRO</small>';
    show('title', false); show('setup', false); show('results', false); show('pause', false); show('hud', true);
    show('touch', G.input.isTouch || matchMedia('(pointer: coarse)').matches);
    if (!$('touch').hidden) G.input.setTouch(true);
    setRacing(true);
    G.acc = 0; G.introT = o.skipIntro ? 99 : 0; G.shownCount = null; G.finishT = 0; G.speedFx = 0;
    G.state = 'intro';
    G.rig.snap();
    setStartLights(G.W, 0, false);
    G.audio.intense = 0;
    G.audio.playSong(th.name);
    G.input.flush();
    show('loading', false);
    canvas.focus();
  };
  if (o.sync) go(); else requestAnimationFrame(() => setTimeout(go, 0));
};
// a translucent replay kart for the time-trial ghost
function ensureGhostView() {
  if (!G.ghostK) G.ghostK = { x: 0, y: 0, z: 0, h: 0, vh: 0, spd: 0, name: { zh: '幽灵', en: 'GHOST' }, drift: { on: false, dir: 0 }, b: {}, prevX: 0, prevY: 0, prevZ: 0, prevH: 0, grounded: true, prevSdir: 0, stunKind: '', stun: 0, shield: 0, turtle: 0, spinA: 0, vy: 0 };
  G.ghostK.kartIdx = G.ghost.kart ?? 0; G.ghostK.paint = G.ghost.paint || '#9fe8ff';
  if (!G.ghostView) G.ghostView = new KartView(G.ghostK, G.W.scene, { ghost: true, tag: true });
}
G.restart = () => { show('pause', false); G.startRace({ skipIntro: true }); };
G.quit = () => { clearRace(); show('pause', false); G.toSetup(); setRacing(false); G.audio.quiet(); G.audio.playSong('menu'); };
G.pause = (on) => {
  if (on && (G.state === 'race' || G.state === 'intro')) {
    G.prevState = G.state; G.state = 'paused'; show('pause', true); G.menus.pauseOpts(); G.audio.suspend(true); $('pResume').focus();
  } else if (!on && G.state === 'paused') {
    G.state = G.prevState; show('pause', false); show('help', false); G.audio.suspend(false); G.input.flush(); canvas.focus();
  }
};
addEventListener('blur', () => G.pause(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) G.pause(true); });

G.input.onKey = (e) => {
  const c = e.code;
  if (c === 'Escape') {
    if (!$('help').hidden) { G.menus.help(false); return; }
    if (G.state === 'paused') G.pause(false); else if (G.state === 'race' || G.state === 'intro') G.pause(true);
    else if (G.state === 'setup') G.toTitle();
    return;
  }
  if (c === 'KeyM') { G.setMute(!G.audio.muted); return; }
  if ((G.state === 'race' || G.state === 'intro') && c === 'KeyC') { G.setCam((G.rig.mode + 1) % CAMS.length); return; }
  if (G.state === 'intro' && G.introT > 0.4 && (c === 'Enter' || c === 'Space' || c === 'ArrowUp')) { G.introT = 99; return; }
  if (G.state === 'title' && (c === 'Enter')) { G.toSetup(); return; }
  if (G.state === 'setup' && c === 'Enter' && document.activeElement === document.body) { G.startRace(); return; }
  if (G.state === 'results' && c === 'Enter') { G.restart(); return; }
};

// ---- race events → feedback --------------------------------------------------------------------------
const TECH = {
  snap: ['断位漂移', 'BROKEN DRIFT', ''], chain: ['连续漂移', 'CHAIN DRIFT', 's'], tap: ['点漂', 'TAP DRIFT', 's'], whip: ['甩尾漂移', 'TAIL WHIP', 'pink'],
  airBoost: ['空喷', 'AIR BOOST', ''], landBoost: ['落地喷', 'LANDING BOOST', 'gold'], early: ['起步过早', 'TOO EARLY', 'red s'], tooEarly: ['太早了', 'TOO EARLY — WAIT FOR THE LIGHT', 'red s']
};
function onEvent(ev) {
  const { k, type, data } = ev, R = G.R, P = R.player, me = k === P;
  const near = Math.hypot(k.x - P.x, k.z - P.z);
  const view = G.views[R.karts.indexOf(k)];
  switch (type) {
    case 'micro':
      if (me) {
        const zh = data.perfect ? (data.dbl ? '完美双喷' : '完美小喷') : data.dbl ? (data.chain ? '断位双喷' : '双喷') : '小喷';
        const en = data.perfect ? (data.dbl ? 'PERFECT DOUBLE' : 'PERFECT BOOST') : data.dbl ? 'DOUBLE BOOST' : 'MICRO BOOST';
        G.hud.pop(zh, en, data.perfect ? 'gold' : data.dbl ? 'pink' : '');
        G.sfx('micro', data); G.rig.shake(0.15);
      }
      if (view) G.fx.ring(view.pos.x, view.pos.y, view.pos.z, data.perfect ? 0xffd21f : 0x29d3ff, 3, 0.3);
      break;
    case 'light': if (me) G.sfx('light'); break;
    case 'nitro': if (me) { G.hud.pop('氮气', 'NITRO', ''); G.sfx('nitro'); G.rig.shake(0.3); } if (view) G.fx.ring(view.pos.x, view.pos.y, view.pos.z, 0x4a7bff, 5, 0.4); break;
    case 'combo': if (me) { G.hud.pop(data.combo + '喷', data.combo + ' COMBO', 'pink'); G.sfx('combo'); } break;
    case 'bottle': if (me) { G.hud.bottlePop(data.n); G.hud.pop('氮气 +1', 'NITRO READY', 'gold s'); G.sfx('bottle'); } break;
    case 'start': if (me) { G.hud.pop(data.perfect ? '完美起步' : '起步喷', data.perfect ? 'PERFECT START' : 'ROCKET START', 'gold'); G.sfx('start'); G.rig.shake(0.3); } break;
    case 'pad': if (me) G.sfx('pad'); if (view) G.fx.ring(view.pos.x, view.pos.y, view.pos.z, 0x29e3ff, 4, 0.3); break;
    case 'tier': if (me && data.tier >= 2) G.sfx('tech', { f: 600 + data.tier * 220 }); break;
    case 'wall':
      if (me || near < 40) G.sfx('wall', { impact: data.impact * (me ? 1 : 0.4) });
      G.fx.burst(data.x, k.y + 0.5, data.z, 0xffc070, Math.round(6 + data.impact * 16), 7, 0.22);
      if (me) G.rig.shake(0.2 + data.impact * 0.6);
      break;
    case 'bump': if (me || data.other === P) { G.sfx('bump'); G.rig.shake(0.35); } if (view) G.fx.burst((k.x + data.other.x) / 2, k.y + 0.6, (k.z + data.other.z) / 2, 0xffe0a0, 10, 6, 0.2); break;
    case 'land': if (view) G.fx.puff(view.pos.x, view.pos.y, view.pos.z, 10); if (me) { G.sfx('land'); G.rig.shake(Math.min(0.6, data.air * 0.4)); } break;
    case 'lap': if (me) onLap(data); break;
    case 'finalLap': if (me) { G.hud.banner('最后一圈', 'FINAL LAP'); G.sfx('final'); G.audio.intense = 1; } break;
    case 'finish':
      if (me) {
        const pl = data.place, suf = ['ST', 'ND', 'RD'][pl - 1] || 'TH';
        if (R.mode === 'tt') G.hud.banner('完成', 'FINISHED ' + fmt(data.time)); else G.hud.banner(`第 ${pl} 名`, `${pl}${suf} PLACE`);
        G.sfx(pl === 1 || R.mode === 'tt' ? 'win' : 'finish');
        G.fx.confetti(k.x, k.y + 2, k.z, 90);
      }
      break;
    case 'go':
      G.hud.count('GO!', true); G.sfx('count', { go: true }); setStartLights(G.W, 5, true);
      if (!store.get('hinted') && !R.autopilot) { store.set('hinted', 1); setTimeout(() => G.hud.toast('按住 Shift 漂移 → 松开，「喷」灯亮时点 ↑ · Hold Shift to drift, release, tap ↑ when 喷 lights'), 900); }
      break;
    case 'reset': if (me) { G.hud.pop('复位', 'RESET', 's'); G.sfx('reset'); G.rig.snap(); } break;
    case 'box': if (me) { G.sfx('box'); } G.fx.burst(data.x, data.y, data.z, 0xffffff, 14, 6, 0.3); break;
    case 'itemReady': if (me) G.sfx('ready'); break;
    case 'use':
      if (me) { const it = ITEMS[data.item]; G.hud.pop(it.zh, it.en.toUpperCase(), 's'); }
      if (me || near < 60) G.sfx({ missile: 'missile', banana: 'banana', fog: 'fog', magnet: 'magnet', angel: 'shield', turbo: 'turbo', bubble: 'bubble', turtle: 'turtle', devil: 'devil', tornado: 'tornado' }[data.item]);
      break;
    case 'locked': if (me) { G.sfx('lock'); const L = { turtle: ['乌龟来袭', 'TURTLE INCOMING'], devil: ['恶魔来袭', 'DEVIL INCOMING'], tornado: ['龙卷风来袭', 'TORNADO INCOMING'] }[data.kind] || ['被锁定', 'LOCKED ON']; G.hud.pop(L[0], L[1], 'red s'); } break;
    case 'boom':
      if (data.kind === 'missile') { G.fx.explosion(data.x, data.y, data.z); if (me || near < 70) { G.sfx('boom'); G.rig.shake(me ? 0.9 : 0.25); } }
      else { G.fx.burst(data.x, data.y, data.z, ITEMS[data.kind] ? ITEMS[data.kind].color : 0xffffff, 40, 10, 0.5); G.fx.ring(data.x, data.y, data.z, 0xffffff, 8, 0.4); if (me || near < 60) G.sfx(data.kind === 'bubble' ? 'bubble' : data.kind === 'devil' ? 'devil' : 'tornado'); if (me) G.rig.shake(0.5); }
      break;
    case 'slip': if (me || near < 50) G.sfx('slip'); break;
    case 'hit':
      if (me && data.kind !== 'fog' && data.kind !== 'magnet') { G.hud.pop('中招', 'HIT!', 'red'); G.sfx('hit'); G.R3.speed.uniforms.uHit.value = 1; }
      if (me && data.kind === 'fog') G.hud.pop('云雾遮眼', 'INK FOG', 'red s');
      if (me && data.kind === 'devil') G.hud.pop('方向颠倒', 'CONTROLS REVERSED', 'red s');
      if (me && data.kind === 'tornado') G.hud.pop('龙卷风', 'TORNADO', 'red s');
      if (data.from === P && !me) G.hud.pop('命中', 'DIRECT HIT', 'gold s');
      break;
    case 'blocked': if (me) { G.hud.pop('天使护体', 'BLOCKED', 'gold'); G.sfx('blocked'); } break;
    case 'magnetized': if (me) G.hud.pop('被磁铁吸住', 'MAGNETIZED', 'red s'); break;
    case 'turbo': if (me) { G.hud.pop('加速', 'TURBO', ''); G.rig.shake(0.25); } break;
    default: if (me && TECH[type]) { const [zh, en, cls] = TECH[type]; G.hud.pop(zh, en, cls); if (type === 'early' || type === 'tooEarly') G.sfx('early'); else G.sfx('tech', { f: type === 'whip' ? 1175 : type === 'snap' ? 988 : 880 }); }
  }
}
function onLap(data) {
  const R = G.R, T = G.trackGeo(G.sel.track), P = R.player;
  G.sfx('lap');
  const prevBest = bestLap(T.def.id);
  const rec = saveLap(T.def.id, data.time);
  if (R.mode === 'tt') {
    const g = G.ghost;
    if (!g || data.time < g.lap) {
      saveGhost(T.def.id, data.time, G.rec.f, G.sel.kart, PAINTS[G.sel.paint].c);
      G.hud.pop('新幽灵', 'NEW GHOST SAVED', 'gold s');
    }
    G.ghost = loadGhost(T.def.id) || G.ghost;
    if (G.ghost) ensureGhostView();
  }
  if (P.lap < R.laps) G.hud.toast(`第 ${data.lap} 圈 ${fmt(data.time)}${rec && prevBest != null ? ' · 新纪录 NEW BEST LAP' : ''}`);
  G.rec.start(R.time);
}

// ---- results -----------------------------------------------------------------------------------------
function toResults() {
  const R = G.R, T = G.trackGeo(G.sel.track), P = R.player, mode = R.mode;
  const st = standings(R);
  const me = st.find((s) => s.k === P);
  const recs = [];
  if (P.finished) {
    if (saveRace(T.def.id, mode, P.finishTime)) recs.push('新纪录 NEW RECORD');
  }
  const bl = P.lapTimes.length ? Math.min(...P.lapTimes) : null;
  if (bl != null && bl <= (bestLap(T.def.id) ?? Infinity) + 1e-6 && P.lapTimes.length) recs.push('最佳圈 BEST LAP');
  G.state = 'results'; setRacing(false);
  show('hud', false); show('touch', false); show('results', true);
  const pl = me.place, suf = ['st', 'nd', 'rd'][pl - 1] || 'th';
  $('rHead').innerHTML = `${mode === 'tt' ? '计时赛完成' : '比赛结束'}<small>${T.def.zh} · ${T.def.en.toUpperCase()} · ${MODES[mode].en.toUpperCase()}</small>`;
  $('rPlace').textContent = mode === 'tt' ? fmt(P.finishTime) : pl + suf;
  $('rRecs').innerHTML = recs.map((r) => `<span class="rec">${r}</span>`).join('');
  if (mode === 'tt') {
    $('rTable').innerHTML = P.lapTimes.map((t, i) => `<tr class="${t === bl ? 'me' : ''}"><td>${i + 1}</td><td>第 ${i + 1} 圈 LAP</td><td class="t">${fmt(t)}</td></tr>`).join('');
  } else {
    $('rTable').innerHTML = st.map((s) => `<tr class="${s.k === P ? 'me' : ''}"><td>${s.place}</td><td><i style="background:${s.k.paint}"></i>${s.k.name.zh} <small>${s.k.name.en}</small> · <small>${KARTS[s.k.kartIdx].zh}</small></td><td class="t">${s.est ? '~' : ''}${fmt(s.time)}</td><td class="t">${fmt(s.best)}</td></tr>`).join('');
  }
  const bestEver = bestRace(T.def.id, mode);
  $('rStats').innerHTML = `最佳圈 BEST LAP <b>${fmt(bl)}</b> · 纪录 RECORD <b>${fmt(bestEver)}</b> · 赛车 KART <b>${KARTS[G.sel.kart].zh}</b>`;
  G.garage.showPodium(mode === 'tt' ? [{ k: P }] : st);
  G.audio.quiet();
  G.audio.playSong('menu');
  if (pl === 1 || mode === 'tt') G.sfx('win');
  $('rAgain').focus();
  G.lastResult = { place: pl, time: P.finishTime, laps: P.lapTimes.slice(), standings: st.map((s) => ({ name: s.k.name.en, time: s.time, est: s.est })) };
}

// ---- main loop -----------------------------------------------------------------------------------------
let last = performance.now();
const tmpV = new THREE.Vector3();
function stepRace(pin) {
  const R = G.R;
  R.step(pin);
  for (const ev of R.events) onEvent(ev);
  R.events.length = 0;
  if (G.sel.mode === 'tt' && R.state !== 'countdown' && !R.player.finished) G.rec.sample(R.player, R.time);
}
function countdownUI() {
  const R = G.R;
  if (R.state !== 'countdown') return;
  const n = Math.ceil(R.cd);
  if (n !== G.shownCount && n <= 3 && n >= 1) {
    G.shownCount = n; G.hud.count(String(n)); G.sfx('count'); setStartLights(G.W, 4 - n, false);
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  const ms = Math.min(250, now - last); last = now;
  const dt = Math.min(0.1, ms / 1000);
  G.frameMs = ms;
  const st = G.state;
  if (st === 'title' || st === 'setup' || st === 'results' || st === 'boot') {
    G.garage.update(dt, innerWidth > 900 && st !== 'results');
    G.R3.speed.uniforms.uSpeed.value = 0; G.R3.speed.uniforms.uBoost.value = 0; G.R3.speed.uniforms.uLock.value = 0; G.R3.speed.uniforms.uHit.value = 0;
    G.R3.look(GARAGE_LOOK);
    G.R3.render(G.garage.scene, G.garage.cam);
    return;
  }
  if (!G.R || !G.W) return;
  const R = G.R, P = R.player, W = G.W;
  if (st === 'intro') {
    G.introT += dt;
    for (const v of G.views) v.update(dt, 1);
    G.rig.intro(G.pv, P, G.introT / 3.2, W);
    G.hud.update(dt, R, { top: P.st.top });
    if (G.introT >= 3.2) { G.state = 'race'; G.rig.snap(); G.input.flush(); }
  } else if (st === 'race') {
    G.acc += dt;
    let n = 0;
    if (G.frozen) G.acc = 0; // debug freeze: keep rendering the current moment
    while (G.acc >= STEP && n < 6) { stepRace(G.input.read()); G.acc -= STEP; n++; }
    if (n === 6) G.acc = 0;
    G.alpha = G.acc / STEP;
    countdownUI();
    if (R.state === 'race' && R.sinceGo > 0.9 && G.shownCount !== 0) { G.shownCount = 0; G.hud.count(''); }
    for (let i = 0; i < G.views.length; i++) {
      const v = G.views[i], k = R.karts[i];
      v.update(dt, G.alpha);
      const P0 = G.trackGeo(G.sel.track).paths[k.path];
      if (Math.hypot(k.x - P.x, k.z - P.z) < 140) G.fx.kart(k, v, dt, (P0.fl[k.idx] & F.ICE) !== 0);
    }
    // ghost playback (time trial): replays the best lap from each lap start
    let gd = null;
    if (G.ghostView && G.ghost && R.state === 'race' && !P.finished) {
      const lt = R.time - P.lapStart, gk = G.ghostK;
      gk.prevX = gk.x; gk.prevY = gk.y; gk.prevZ = gk.z; gk.prevH = gk.h;
      ghostAt(G.ghost, lt, gk);
      G.ghostView.root.visible = P.lap >= 1 && !gk.done;
      G.ghostView.update(dt, 1);
      if (P.lap >= 1) gd = estimateDelta(lt);
    }
    G.fx.syncItems(R.items, W.time);
    G.fx.update(dt, G.rig.cam.position);
    W.inTunnel = (G.trackGeo(G.sel.track).paths[P.path].fl[P.idx] & F.TUN) !== 0;
    const boost = P.b.nitro > 0 || P.b.turbo > 0;
    if (R.state === 'done') {
      G.finishT += dt;
      if (G.finishT < 1.2) G.rig.follow(G.pv, P, dt, W, boost); else G.rig.orbit(G.pv.pos, dt, 8.5, 2.6);
      if (G.finishT > 6.5 || R.over) toResults();
    } else G.rig.follow(G.pv, P, dt, W, boost);
    updateWorld(W, dt, G.pv.pos, G.rig.cam.position);
    G.hud.update(dt, R, { top: P.st.top, ghost: G.ghostView && G.ghostView.root.visible ? G.ghostK : null, ghostDelta: gd });
    // audio: nearest rival engine, panned
    let rival = null;
    for (const k of R.karts) if (k !== P) { const d = Math.hypot(k.x - P.x, k.z - P.z); if (!rival || d < rival.d) { const cam = G.rig.cam; tmpV.set(k.x, k.y, k.z).project(cam); rival = { k, d, pan: tmpV.x }; } }
    k0Slip(P);
    G.audio.drive(P, P.st.top, rival, dt);
    // screen FX
    const top = P.st.top;
    const sp = Math.max(0, (Math.abs(P.spd) - top * 0.85) / (top * 0.45)) + (boost ? 0.55 : P.b.micro > 0 ? 0.25 : 0);
    G.speedFx += (Math.min(1, sp) - G.speedFx) * Math.min(1, dt * 5);
    const u = G.R3.speed.uniforms;
    u.uSpeed.value = (G.rig.mode === 3 ? 0.4 : 1) * (REDUCED ? 0.35 : 1) * G.speedFx; u.uBoost.value += ((boost ? 1 : 0) - u.uBoost.value) * Math.min(1, dt * 6);
    u.uTime.value = W.time; u.uLock.value = P.lock > 0 ? 0.5 + 0.5 * Math.sin(W.time * 18) : 0;
    u.uHit.value = Math.max(0, u.uHit.value - dt * 3);
  } else if (st === 'paused') {
    G.input.pad(); // lets a gamepad's Start button resume
  }
  G.R3.look(W.th);
  G.R3.render(W.scene, G.rig.cam);
  G.R3.adapt(ms);
}
function k0Slip(k) { k.slipA = Math.abs(((k.h - k.vh + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI); }
// ghost delta: time the ghost took to reach the player's current lap progress minus the player's lap time
function estimateDelta(lt) {
  const g = G.ghost, P = G.R.player, T = G.trackGeo(G.sel.track);
  if (!g) return null;
  const n = g.f.length / 4;
  // find the ghost frame nearest the player (search a window around the same time)
  let best = -1, bd = Infinity;
  const c = Math.round(lt / 0.05);
  for (let i = Math.max(0, c - 120); i < Math.min(n, c + 120); i++) {
    const dx = g.f[i * 4] / 100 - P.x, dz = g.f[i * 4 + 2] / 100 - P.z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best < 0 ? null : lt - best * 0.05;
}
addEventListener('resize', () => { G.rig.resize(innerWidth / innerHeight); if (G.fx) G.fx.setScale(innerHeight * Math.min(2, G.R3.r.getPixelRatio())); });
G.R3.onQuality = () => { if (G.fx) G.fx.setScale(innerHeight * Math.min(2, G.R3.r.getPixelRatio())); };

// ---- start ----------------------------------------------------------------------------------------------
(async () => {
  try {
    await Promise.race([
      Promise.all(['40px "ZCOOL QingKe HuangYou"', '40px "Russo One"', '700 16px "Noto Sans SC"'].map((f) => document.fonts.load(f, '风驰漂移WINDRIFT0123'))),
      new Promise((r) => setTimeout(r, 2500))
    ]);
  } catch (e) { /* fonts are optional */ }
  show('loading', false);
  G.toTitle();
  requestAnimationFrame(frame);
})();

// ---- debug / test hook ------------------------------------------------------------------------------------
window.__debug = {
  G,
  start(o = {}) { Object.assign(G.sel, o.sel || {}); G.startRace({ skipIntro: o.intro !== true, sync: true, seed: o.seed || 7, laps: o.laps }); if (o.auto) G.R.autopilot = true; return this.state(); },
  auto(on = true) { if (G.R) G.R.autopilot = on; },
  // advance the simulation n fixed steps without rendering (uses the autopilot or a fixed input)
  step(n = 60, inp) {
    if (G.state === 'intro') { G.state = 'race'; }
    for (let i = 0; i < n && G.R; i++) { stepRace(inp || NOIN); if (G.R.state === 'done' && (G.R.over || G.R.doneT > 6)) break; }
    return this.state();
  },
  until(fn, max = 60 * 400) { let i = 0; while (i < max && G.R && !fn(G.R)) { stepRace(NOIN); i++; } return this.state(); },
  results() { if (G.R) toResults(); return G.lastResult; },
  state() {
    const R = G.R; if (!R) return { state: G.state };
    const P = R.player;
    return { state: G.state, race: R.state, time: +R.time.toFixed(2), lap: P.lap, laps: R.laps, rank: R.ranks.indexOf(P) + 1, finished: P.finished, finishTime: P.finishTime, lapTimes: P.lapTimes.map((t) => +t.toFixed(2)), x: +P.x.toFixed(1), y: +P.y.toFixed(1), z: +P.z.toFixed(1), spd: +(P.spd * KMH).toFixed(0), path: P.path, bottles: P.bottles, gauge: +P.gauge.toFixed(2), items: P.items.slice(), q: G.R3.level, frameMs: +G.frameMs.toFixed(1) };
  },
  render() { G.R3.render(G.W.scene, G.rig.cam); },
  // teleport the player to a fraction of a path (for screenshots): settles camera + views, then renders
  tp(pathId, frac, lat = 0, cam) {
    const R = G.R, P = G.trackGeo(G.sel.track).paths[pathId], k = R.player;
    placeOnTrack(G.trackGeo(G.sel.track), k, pathId, Math.floor(frac * (P.n - 1)), lat);
    k.spd = 30; k.drift.on = false;
    if (cam != null) G.rig.mode = cam;
    G.rig.snap(); G.state = 'race'; R.state = R.state === 'countdown' ? 'race' : R.state;
    for (let i = 0; i < 40; i++) { for (const v of G.views) v.update(1 / 60, 1); G.rig.follow(G.pv, k, 1 / 60, G.W, false); updateWorld(G.W, 1 / 60, G.pv.pos, G.rig.cam.position); }
    G.fx.update(1 / 60, G.rig.cam.position);
    G.hud.update(1 / 60, R, { top: k.st.top });
    G.R3.look(G.W.th);
    G.R3.speed.uniforms.uSpeed.value = 0;
    G.R3.render(G.W.scene, G.rig.cam);
    return { x: k.x, y: k.y, z: k.z };
  },
  cam(i) { G.setCam(i); },
  freeze(on = true) { G.frozen = on; if (G.state === 'intro') G.state = 'race'; },
  events: [],
  pause(on) { G.pause(on); }
};
